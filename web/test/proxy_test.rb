require "test_helper"

class ProxyTest < Minitest::Test
  include Rack::Test::Methods
  include WebMock::API
  include TestSettings

  def setup
    @dist_dir = Dir.mktmpdir
    WebMock.enable!
    WebMock.disable_net_connect!
  end

  def teardown
    WebMock.reset!
    WebMock.disable!
    FileUtils.remove_entry(@dist_dir)
  end

  def app
    NightcordWeb.app(settings, log: StringIO.new)
  end

  def test_forwards_the_request_without_the_api_prefix_and_returns_the_answer
    stub_request(:get, "http://backend.test/rooms/7/messages?limit=5")
      .with(headers: { "Cookie" => "access_token=abc", "X-Requested-With" => "nightcord" })
      .to_return(status: 200, body: '[{"id":1}]', headers: { "Content-Type" => "application/json" })

    header "Cookie", "access_token=abc"
    header "X-Requested-With", "nightcord"
    get "/api/rooms/7/messages?limit=5"

    assert_equal 200, last_response.status
    assert_equal '[{"id":1}]', last_response.body
    assert_equal "application/json", last_response.headers["content-type"]
  end

  def test_forwards_the_json_body_and_returns_every_set_cookie
    stub_request(:post, "http://backend.test/auth/login")
      .with(body: '{"email":"a@b.edu","password":"pw"}', headers: { "Content-Type" => "application/json" })
      .to_return(status: 200, body: "{}", headers: { "Set-Cookie" => ["access_token=xyz; HttpOnly", "other=1"] })

    post "/api/auth/login", '{"email":"a@b.edu","password":"pw"}', "CONTENT_TYPE" => "application/json"

    cookies = Array(last_response.headers["set-cookie"]).flat_map { |value| value.split("\n") }
    assert_equal ["access_token=xyz; HttpOnly", "other=1"], cookies
  end

  def test_passes_error_statuses_and_bodies_through_unchanged
    # e.g. the night gate's structured 403 the frontend turns into a countdown
    detail = '{"detail":{"message":"closed","timezone":"America/Chicago"}}'
    stub_request(:get, "http://backend.test/rooms").to_return(status: 403, body: detail)

    get "/api/rooms"

    assert_equal 403, last_response.status
    assert_equal detail, last_response.body
  end

  def test_forwards_the_gate_bypass_headers
    stub_request(:get, "http://backend.test/rooms")
      .with(headers: { "X-Canary-Token" => "tok", "X-Dev-Skip-Gate" => "1" })
      .to_return(status: 200, body: "[]")

    header "X-Canary-Token", "tok"
    header "X-Dev-Skip-Gate", "1"
    get "/api/rooms"

    assert_equal 200, last_response.status
  end

  def test_does_not_forward_other_headers
    stub_request(:get, "http://backend.test/rooms")
      .with { |request| !request.headers.key?("Origin") && !request.headers.key?("Authorization") }
      .to_return(status: 200, body: "[]")

    header "Origin", "https://evil.example"
    header "Authorization", "Bearer something"
    get "/api/rooms"

    assert_equal 200, last_response.status
  end

  def test_sends_the_real_client_ip_for_rate_limiting
    stub_request(:get, "http://backend.test/rooms").with(headers: { "X-Forwarded-For" => "203.0.113.9" })

    # Behind Railway's edge: the proxy's own (private) address, with the
    # client appended to X-Forwarded-For.
    get "/api/rooms", {}, "REMOTE_ADDR" => "10.0.0.5", "HTTP_X_FORWARDED_FOR" => "203.0.113.9"

    assert_equal 200, last_response.status
  end

  def test_a_client_cannot_spoof_its_ip_by_sending_x_forwarded_for_itself
    stub_request(:get, "http://backend.test/rooms").with(headers: { "X-Forwarded-For" => "203.0.113.9" })

    # The client typed 1.2.3.4; Railway's edge appended the real address.
    get "/api/rooms", {}, "REMOTE_ADDR" => "100.64.0.3", "HTTP_X_FORWARDED_FOR" => "1.2.3.4, 203.0.113.9"

    assert_equal 200, last_response.status
  end

  def test_uses_the_socket_address_when_no_proxy_is_involved
    stub_request(:get, "http://backend.test/rooms").with(headers: { "X-Forwarded-For" => "198.51.100.7" })

    get "/api/rooms", {}, "REMOTE_ADDR" => "198.51.100.7"

    assert_equal 200, last_response.status
  end

  def test_backend_unreachable_is_a_502_the_frontend_can_show
    stub_request(:get, "http://backend.test/rooms").to_raise(Errno::ECONNREFUSED)
    get "/api/rooms"
    assert_equal 502, last_response.status
    assert_equal({ "detail" => "Service unavailable." }, JSON.parse(last_response.body))

    stub_request(:get, "http://backend.test/rooms").to_timeout
    get "/api/rooms"
    assert_equal 502, last_response.status
  end

  def test_rejects_methods_fastapi_never_serves
    request "/api/rooms", method: "TRACE"
    assert_equal 405, last_response.status
  end
end
