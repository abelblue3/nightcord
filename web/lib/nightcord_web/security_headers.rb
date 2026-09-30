module NightcordWeb
  # The page security headers that used to live in frontend/vercel.json.
  # Because the API is now on this same domain, connect-src no longer has to
  # name the Railway backend -- which also means a beta deploy pointing at a
  # different backend isn't blocked by a hardcoded production URL.
  class SecurityHeaders
    SENTRY_INGEST = "https://o4511895052156928.ingest.us.sentry.io".freeze
    GOOGLE = "https://accounts.google.com".freeze

    def initialize(app, public_host:, hsts:)
      @app = app

      connect_src = ["'self'", GOOGLE, SENTRY_INGEST]
      # Older Safari doesn't count wss: on the same host as 'self'.
      connect_src << "wss://#{public_host}" if public_host

      policy = [
        "default-src 'self'",
        "script-src 'self' #{GOOGLE}",
        "style-src 'self' 'unsafe-inline' #{GOOGLE}",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src #{connect_src.join(" ")}",
        "frame-src #{GOOGLE}",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ]

      @headers = {
        "content-security-policy" => policy.join("; "),
        "x-content-type-options" => "nosniff",
        "x-frame-options" => "DENY",
        "referrer-policy" => "strict-origin-when-cross-origin",
      }
      @headers["strict-transport-security"] = "max-age=63072000; includeSubDomains; preload" if hsts
    end

    def call(env)
      status, headers, body = @app.call(env)
      # A WebSocket upgrade (101) isn't a page; leave its handshake alone.
      @headers.each { |name, value| headers[name] = value } unless status == 101
      [status, headers, body]
    end
  end
end
