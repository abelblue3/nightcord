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

  def test_a_path_cannot_forge_log_lines_or_send_terminal_escapes
    output = StringIO.new
    app = NightcordWeb::RequestLog.new(->(_env) { [404, {}, []] }, output: output)
    env = Rack::MockRequest.env_for("/x")
    env["PATH_INFO"] = "/x\nGET /api/auth/session 200 3ms\e[2J"

    app.call(env)

    assert_equal "GET /x%0AGET /api/auth/session 200 3ms%1B[2J 404", output.string.sub(/ \d+ms\n\z/, "")
  end
end
