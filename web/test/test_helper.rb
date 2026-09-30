require "minitest/autorun"
require "rack/test"
require "stringio"
require "tmpdir"
require "webmock"

# Loading webmock switches it on for every HTTP client. Only proxy_test.rb
# wants that -- socket_relay_test.rb talks to real servers on localhost.
WebMock.disable!

require_relative "../lib/nightcord_web"

module TestSettings
  def settings(overrides = {})
    NightcordWeb::Settings.from_env({ "DIST_DIR" => @dist_dir, "BACKEND_URL" => "http://backend.test" }.merge(overrides))
  end
end
