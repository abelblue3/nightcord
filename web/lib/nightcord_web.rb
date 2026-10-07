require "rack"

require_relative "nightcord_web/pages"
require_relative "nightcord_web/proxy"
require_relative "nightcord_web/request_log"
require_relative "nightcord_web/security_headers"
require_relative "nightcord_web/socket_relay"

# The browser-facing layer in front of the FastAPI backend: serves the built
# frontend pages and carries every API request and chat WebSocket through to
# FastAPI on the same domain, so the session cookie is first-party. It holds
# no business logic of its own -- auth, the night gate, and all data stay in
# FastAPI.
module NightcordWeb
  Settings = Data.define(:backend_url, :dist_dir, :allowed_origins, :public_host, :environment, :clerk_frontend_api) do
    def self.from_env(env = ENV)
      public_host = env["PUBLIC_HOST"]&.strip
      public_host = nil if public_host&.empty?
      origins = env.fetch("ALLOWED_ORIGINS", "http://localhost:4567,http://localhost:5173").split(",").map(&:strip)
      origins << "https://#{public_host}" if public_host

      new(
        backend_url: env.fetch("BACKEND_URL", "http://localhost:8000").chomp("/"),
        dist_dir: env.fetch("DIST_DIR", File.expand_path("../../frontend/dist", __dir__)),
        allowed_origins: origins.reject(&:empty?).uniq,
        public_host: public_host,
        # Secure by default: a deploy that forgets ENVIRONMENT still gets HSTS.
        environment: env.fetch("ENVIRONMENT", "production"),
        # Development instances all live under clerk.accounts.dev; production
        # sets this to the instance's own host (e.g. clerk.example.com).
        clerk_frontend_api: env.fetch("CLERK_FRONTEND_API", "*.clerk.accounts.dev"),
      )
    end

    def development?
      environment == "development"
    end
  end

  def self.app(settings = Settings.from_env, log: $stdout)
    pages = Class.new(Pages) { set :public_folder, settings.dist_dir }
    proxy = Proxy.new(backend_url: settings.backend_url)

    Rack::Builder.new do
      use RequestLog, output: log
      use SecurityHeaders, public_host: settings.public_host, hsts: !settings.development?,
                           clerk_frontend_api: settings.clerk_frontend_api
      use SocketRelay, backend_url: settings.backend_url, allowed_origins: settings.allowed_origins
      map("/api") { run proxy }
      run pages
    end.to_app
  end
end
