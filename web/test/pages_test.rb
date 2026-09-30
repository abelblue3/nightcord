require "test_helper"

class PagesTest < Minitest::Test
  include Rack::Test::Methods
  include TestSettings

  def setup
    @dist_dir = Dir.mktmpdir
    File.write(File.join(@dist_dir, "index.html"), "<h1>login page</h1>")
    File.write(File.join(@dist_dir, "rooms.html"), "<h1>rooms page</h1>")
    Dir.mkdir(File.join(@dist_dir, "assets"))
    File.write(File.join(@dist_dir, "assets", "rooms-abc123.js"), "console.log('rooms')")
    @overrides = {}
  end

  def teardown
    FileUtils.remove_entry(@dist_dir)
  end

  def app
    NightcordWeb.app(settings(@overrides), log: StringIO.new)
  end

  def test_root_serves_the_login_page
    get "/"
    assert_equal 200, last_response.status
    assert_includes last_response.body, "login page"
  end

  def test_serves_other_pages_and_built_assets
    get "/rooms.html"
    assert_includes last_response.body, "rooms page"

    get "/assets/rooms-abc123.js"
    assert_equal 200, last_response.status
    assert_includes last_response.body, "console.log"
  end

  def test_unknown_path_is_404
    get "/nope.html"
    assert_equal 404, last_response.status
  end

  def test_healthz_answers_without_the_backend
    get "/healthz"
    assert_equal 200, last_response.status
    assert_equal({ "status" => "ok" }, JSON.parse(last_response.body))
  end

  def test_pages_carry_the_security_headers
    get "/"
    csp = last_response.headers["content-security-policy"]
    assert_includes csp, "connect-src 'self' https://*.clerk.accounts.dev https://*.protect.clerk.com:*"
    assert_includes csp, "script-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com"
    assert_includes csp, "img-src 'self' data: https://img.clerk.com"
    assert_includes csp, "worker-src 'self' blob:"
    refute_includes csp, "accounts.google.com", "Google sign-in now goes through Clerk"
    assert_includes csp, "frame-ancestors 'none'"
    refute_includes csp, "railway.app", "the API is same-origin now; no backend URL belongs in the CSP"
    assert_equal "nosniff", last_response.headers["x-content-type-options"]
    assert_equal "DENY", last_response.headers["x-frame-options"]
  end

  def test_no_hsts_in_local_development
    @overrides = { "ENVIRONMENT" => "development" }
    get "/"
    assert_nil last_response.headers["strict-transport-security"]
  end

  def test_hsts_in_every_deployed_environment
    @overrides = { "ENVIRONMENT" => "beta" }
    get "/"
    assert_includes last_response.headers["strict-transport-security"], "max-age="
  end

  def test_environment_defaults_to_production
    refute NightcordWeb::Settings.from_env({}).development?
  end

  def test_production_clerk_host_goes_in_the_csp
    @overrides = { "CLERK_FRONTEND_API" => "clerk.nightcord.example" }
    get "/"
    csp = last_response.headers["content-security-policy"]
    assert_includes csp, "script-src 'self' https://clerk.nightcord.example"
    refute_includes csp, "clerk.accounts.dev"
  end

  def test_public_host_is_allowed_for_websockets_and_in_the_csp
    @overrides = { "PUBLIC_HOST" => "nightcord.example.com" }
    assert_includes settings(@overrides).allowed_origins, "https://nightcord.example.com"

    get "/"
    assert_includes last_response.headers["content-security-policy"], "wss://nightcord.example.com"
  end
end
