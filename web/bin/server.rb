#!/usr/bin/env ruby
# Starts the web service: one Falcon process serving config.ru on $PORT.
#
# Used instead of `falcon serve`, whose process supervisor needs Unix-only
# signals and fork -- this runs the same server the same way on Windows (for
# local development) and on Linux (Railway). One process is plenty: Falcon
# handles each request and WebSocket on its own fiber.
require "bundler/setup"
require "async"
require "async/http/endpoint"
require "falcon/server"
require "rack/builder"

port = ENV.fetch("PORT", "4567")
bind = ENV.fetch("BIND", "0.0.0.0")
app = Rack::Builder.parse_file(File.expand_path("../config.ru", __dir__))
endpoint = Async::HTTP::Endpoint.parse("http://#{bind}:#{port}")

$stdout.sync = true
puts "nightcord web listening on http://#{bind}:#{port}"

Async do
  # No response cache: API answers depend on the session cookie.
  Falcon::Server.new(Falcon::Server.rack_middleware(app, cache: false), endpoint).run.wait
end
