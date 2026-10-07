require "test_helper"
require "async"
require "async/http/endpoint"
require "async/queue"
require "async/websocket/adapters/rack"
require "async/websocket/client"
require "falcon/server"
require "socket"

# Runs the relay for real: a stand-in FastAPI and the web app each listen on
# a local port, and a WebSocket client connects through the app.
class SocketRelayTest < Minitest::Test
  ALLOWED_ORIGIN = "http://localhost:5173".freeze

  def setup
    @dist_dir = Dir.mktmpdir
    @backend_events = Async::Queue.new
  end

  def teardown
    FileUtils.remove_entry(@dist_dir)
  end

  # Stand-in for FastAPI's /ws/rooms/{id}.
  def fake_backend
    events = @backend_events
    lambda do |env|
      return [403, {}, ["refused"]] if env["PATH_INFO"] == "/ws/rooms/refused"

      Async::WebSocket::Adapters::Rack.open(env) do |connection|
        case env["PATH_INFO"]
        when "/ws/rooms/gate"
          connection.close(1008, "gate-closed:America/Chicago")
        else
          # First tell the test what arrived, then echo until the relay closes.
          connection.write(Protocol::WebSocket::TextMessage.generate(
            cookie: env["HTTP_COOKIE"], origin: env["HTTP_ORIGIN"], canary_token: env["HTTP_X_CANARY_TOKEN"],
            forwarded_for: env["HTTP_X_FORWARDED_FOR"], path: env["PATH_INFO"], query: env["QUERY_STRING"],
          ))
          connection.flush
          while (message = connection.read)
            connection.write(message)
            connection.flush
          end
          events.enqueue(:browser_closed)
        end
      end || [404, {}, []]
    end
  end

  def free_port
    TCPServer.open("127.0.0.1", 0) { |server| server.addr[1] }
  end

  def serve(app, port)
    endpoint = Async::HTTP::Endpoint.parse("http://127.0.0.1:#{port}")
    Falcon::Server.new(Falcon::Server.rack_middleware(app, cache: false), endpoint).run
  end

  # Starts the fake backend (unless backend_port is given) and the web app,
  # yields the web app's base URL, and shuts both down afterwards.
  def with_servers(backend_port: nil)
    Sync do |task|
      servers = []
      unless backend_port
        backend_port = free_port
        servers << serve(fake_backend, backend_port)
      end
      web_port = free_port
      settings = NightcordWeb::Settings.from_env(
        "DIST_DIR" => @dist_dir, "BACKEND_URL" => "http://127.0.0.1:#{backend_port}", "ALLOWED_ORIGINS" => ALLOWED_ORIGIN,
      )
      servers << serve(NightcordWeb.app(settings, log: StringIO.new), web_port)

      task.with_timeout(10) { yield "http://127.0.0.1:#{web_port}" }
    ensure
      servers.each(&:stop)
    end
  end

  def connect(url, headers = [])
    Async::WebSocket::Client.connect(Async::HTTP::Endpoint.parse(url), headers: headers)
  end

  def test_relays_messages_both_ways
    with_servers do |base|
      socket = connect(
        "#{base}/api/ws/rooms/1?skip_gate=1",
        [["cookie", "access_token=abc"], ["origin", ALLOWED_ORIGIN], ["x-canary-token", "tok"]],
      )

      arrived = socket.read.parse
      # Chat signs in with its first message (a Clerk token), not a cookie,
      # so cookies stay on this side.
      assert_nil arrived[:cookie]
      assert_equal "tok", arrived[:canary_token]
      assert_equal "/ws/rooms/1", arrived[:path]
      assert_equal "skip_gate=1", arrived[:query]
      assert_equal "127.0.0.1", arrived[:forwarded_for]
      assert_nil arrived[:origin], "Origin is checked by the relay, not forwarded"

      socket.write(Protocol::WebSocket::TextMessage.generate(content: "hello"))
      socket.flush
      assert_equal({ content: "hello" }, socket.read.parse)

      socket.close
      assert_equal :browser_closed, @backend_events.dequeue
    end
  end

  def test_backend_close_code_and_reason_reach_the_browser
    with_servers do |base|
      socket = connect("#{base}/api/ws/rooms/gate")

      error = assert_raises(Protocol::WebSocket::ClosedError) { socket.read }
      assert_equal 1008, error.code
      assert_equal "gate-closed:America/Chicago", error.message
    end
  end

  def test_refuses_other_websites
    with_servers do |base|
      error = assert_raises(Async::WebSocket::ConnectionError) do
        connect("#{base}/api/ws/rooms/1", [["origin", "https://evil.example"]])
      end
      assert_equal 403, error.response.status
    end
  end

  def test_a_backend_refusal_is_passed_on
    with_servers do |base|
      error = assert_raises(Async::WebSocket::ConnectionError) { connect("#{base}/api/ws/rooms/refused") }
      assert_equal 403, error.response.status
    end
  end

  def test_backend_down_is_a_502
    with_servers(backend_port: free_port) do |base|
      error = assert_raises(Async::WebSocket::ConnectionError) { connect("#{base}/api/ws/rooms/1") }
      assert_equal 502, error.response.status
    end
  end
end
