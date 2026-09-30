require "test_helper"

class RequestLogTest < Minitest::Test
  def test_logs_method_path_status_and_never_the_query_string
    output = StringIO.new
    app = NightcordWeb::RequestLog.new(->(_env) { [201, {}, ["ok"]] }, output: output)

    app.call(Rack::MockRequest.env_for("/api/ws/rooms/1?canary_token=super-secret", method: "POST"))

    line = output.string
    assert_match %r{\APOST /api/ws/rooms/1 201 \d+ms\n\z}, line
    refute_includes line, "super-secret"
  end
end
