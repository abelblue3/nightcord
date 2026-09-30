require "async"
require "async/http/endpoint"
require "async/websocket/adapters/rack"
require "async/websocket/client"
require_relative "client_ip"

module NightcordWeb
  # Carries chat WebSockets (/api/ws/...) through to FastAPI (/ws/...),
  # frame for frame in both directions.
  #
  # The upstream connection is opened *before* the browser's handshake is
  # answered, so when FastAPI refuses (bad session, missing room, gate
  # closed) the browser is refused the same way instead of seeing a socket
  # that opens and immediately dies.
  class SocketRelay
    PATH_PREFIX = "/api/ws/".freeze
    UPSTREAM_CONNECT_TIMEOUT_SECONDS = 5

    def initialize(app, backend_url:, allowed_origins:)
      @app = app
      @backend_ws_url = backend_url.sub(/\Ahttp/, "ws")
      @allowed_origins = allowed_origins
    end

    def call(env)
      unless env["PATH_INFO"].start_with?(PATH_PREFIX) && Async::WebSocket::Adapters::Rack.websocket?(env)
        return @app.call(env)
      end

      # CORS doesn't cover WebSockets: without this, any other website could
      # open a chat socket riding a visitor's session cookie. Browsers always
      # send Origin here; a missing one means a non-browser client (e.g. the
      # canary), which has no visitor's cookie to ride.
      origin = env["HTTP_ORIGIN"]
      return refuse(403, "Origin not allowed.") if origin && !@allowed_origins.include?(origin)

      upstream = connect_upstream(env)
      Async::WebSocket::Adapters::Rack.open(env) { |browser| relay(browser, upstream) }
    rescue Async::WebSocket::ConnectionError => error
      # FastAPI refused the handshake (it answers 403 for every refusal).
      error.response.status == 403 ? refuse(403, "Forbidden.") : refuse(502, "Service unavailable.")
    rescue SystemCallError, IOError, SocketError, Async::TimeoutError
      refuse(502, "Service unavailable.")
    end

    private

    def connect_upstream(env)
      query = env["QUERY_STRING"].to_s
      url = "#{@backend_ws_url}#{env["PATH_INFO"].delete_prefix("/api")}#{query.empty? ? "" : "?#{query}"}"

      # Origin is checked above and deliberately not forwarded -- FastAPI
      # treats a missing Origin as a trusted non-browser caller, which this is.
      headers = [["x-forwarded-for", ClientIp.from_env(env)]]
      headers << ["cookie", env["HTTP_COOKIE"]] if env["HTTP_COOKIE"]
      # The canary's gate bypass travels as a header, never in the URL.
      headers << ["x-canary-token", env["HTTP_X_CANARY_TOKEN"]] if env["HTTP_X_CANARY_TOKEN"]

      Async::Task.current.with_timeout(UPSTREAM_CONNECT_TIMEOUT_SECONDS) do
        Async::WebSocket::Client.connect(Async::HTTP::Endpoint.parse(url), headers: headers)
      end
    end

    def relay(browser, upstream)
      to_browser = Async::Task.current.async do
        pump(from: upstream, to: browser)
      end
      pump(from: browser, to: upstream)
    ensure
      to_browser&.stop
      upstream.close unless upstream.closed?
    end

    # Copies messages until `from` closes, then closes `to` with the same code
    # and reason -- so FastAPI's close reasons (e.g. "gate-closed:<tz>") reach
    # the browser unchanged.
    def pump(from:, to:)
      while (message = from.read)
        to.write(message)
        to.flush
      end
      to.close unless to.closed?
    rescue Protocol::WebSocket::ClosedError => closed
      to.close(closed.code, closed.message) unless to.closed?
    rescue IOError, EOFError, SystemCallError, Protocol::WebSocket::ProtocolError
      to.close unless to.closed?
    end

    def refuse(status, message)
      [status, { "content-type" => "text/plain" }, [message]]
    end
  end
end
