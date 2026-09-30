module NightcordWeb
  # The page security headers that used to live in frontend/vercel.json.
  # Because the API is now on this same domain, connect-src no longer has to
  # name the Railway backend -- which also means a beta deploy pointing at a
  # different backend isn't blocked by a hardcoded production URL.
  class SecurityHeaders
    SENTRY_INGEST = "https://o4511895052156928.ingest.us.sentry.io".freeze
    # Clerk's bot protection (Cloudflare Turnstile and Clerk's own hosts,
    # which serve on non-443 ports -- hence the :* on connect-src).
    CLOUDFLARE_CHALLENGES = "https://challenges.cloudflare.com".freeze
    CLERK_PROTECT = "https://*.protect.clerk.com".freeze
    CLERK_IMAGES = "https://img.clerk.com".freeze

    # clerk_frontend_api: the Clerk instance's Frontend API host, which serves
    # Clerk's script and handles sign-in (e.g. "*.clerk.accounts.dev" for a
    # development instance, "clerk.<your-domain>" in production).
    def initialize(app, public_host:, hsts:, clerk_frontend_api:)
      @app = app
      clerk = "https://#{clerk_frontend_api}"

      connect_src = ["'self'", clerk, "#{CLERK_PROTECT}:*", SENTRY_INGEST]
      # Older Safari doesn't count wss: on the same host as 'self'.
      connect_src << "wss://#{public_host}" if public_host

      policy = [
        "default-src 'self'",
        "script-src 'self' #{clerk} #{CLOUDFLARE_CHALLENGES} #{CLERK_PROTECT}",
        "style-src 'self' 'unsafe-inline'", # Clerk styles its screens at runtime
        "img-src 'self' data: #{CLERK_IMAGES}",
        "font-src 'self'",
        "connect-src #{connect_src.join(" ")}",
        "worker-src 'self' blob:",
        "frame-src #{CLOUDFLARE_CHALLENGES} #{CLERK_PROTECT}",
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
