require "json"
require "net/http"
require "openssl"
require "rack/request"

require_relative "client_ip"

module NightcordWeb
  # Forwards /api/* to FastAPI (with the /api prefix removed) and returns its
  # answer. Only the headers FastAPI actually reads are passed along, and only
  # the ones the browser needs come back.
  #
  # Net::HTTP is fine here: under Falcon, Ruby's fiber scheduler makes its
  # socket reads non-blocking, so one slow upstream call doesn't stall others.
  class Proxy
    METHODS = {
      "GET" => Net::HTTP::Get,
      "HEAD" => Net::HTTP::Head,
      "POST" => Net::HTTP::Post,
      "PUT" => Net::HTTP::Put,
      "PATCH" => Net::HTTP::Patch,
      "DELETE" => Net::HTTP::Delete,
      "OPTIONS" => Net::HTTP::Options,
    }.freeze

    # Session cookie, the CSRF header, and the two gate-bypass headers
    # (dev-only and canary) FastAPI checks itself.
    FORWARDED_REQUEST_HEADERS = %w[Content-Type Accept Cookie X-Requested-With X-Dev-Skip-Gate X-Canary-Token].freeze
    RETURNED_RESPONSE_HEADERS = %w[content-type set-cookie retry-after cache-control].freeze

    # Net::OpenTimeout and Net::ReadTimeout are Timeout::Errors; connection
    # refused/reset are SystemCallErrors.
    UPSTREAM_ERRORS = [SystemCallError, IOError, SocketError, Timeout::Error, OpenSSL::SSL::SSLError].freeze

    def initialize(backend_url:, open_timeout: 5, read_timeout: 30)
      @backend = URI(backend_url)
      @open_timeout = open_timeout
      @read_timeout = read_timeout
    end

    def call(env)
      request = Rack::Request.new(env)
      request_class = METHODS[request.request_method]
      return error(405, "Method not allowed.") unless request_class

      upstream_request = request_class.new(upstream_path(request))
      FORWARDED_REQUEST_HEADERS.each do |name|
        value = header_value(env, name)
        upstream_request[name] = value if value
      end
      # FastAPI rate-limits per client IP. Without this, every user would
      # look like this one server and share a single limit.
      upstream_request["X-Forwarded-For"] = ClientIp.from_env(env)

      body = request.body&.read
      upstream_request.body = body if body && !body.empty?

      response = Net::HTTP.start(
        @backend.host, @backend.port,
        use_ssl: @backend.scheme == "https", open_timeout: @open_timeout, read_timeout: @read_timeout,
      ) { |http| http.request(upstream_request) }

      rack_response(response)
    rescue *UPSTREAM_ERRORS
      # Same `detail` shape FastAPI errors use, so the frontend's error
      # handling shows this message as-is.
      error(502, "Service unavailable.")
    end

    private

    def upstream_path(request)
      path = request.path_info.empty? ? "/" : request.path_info
      query = request.query_string
      "#{@backend.path.chomp("/")}#{path}#{query.empty? ? "" : "?#{query}"}"
    end

    def header_value(env, name)
      key = name == "Content-Type" ? "CONTENT_TYPE" : "HTTP_#{name.upcase.tr("-", "_")}"
      value = env[key]
      value unless value.nil? || value.empty?
    end

    def rack_response(response)
      headers = {}
      RETURNED_RESPONSE_HEADERS.each do |name|
        values = response.get_fields(name)
        next unless values

        # Each cookie must stay its own Set-Cookie header.
        headers[name] = name == "set-cookie" ? values : values.join(", ")
      end
      [response.code.to_i, headers, [response.body.to_s]]
    end

    def error(status, detail)
      [status, { "content-type" => "application/json" }, [JSON.generate(detail: detail)]]
    end
  end
end
