module NightcordWeb
  # One line per request: method, path, status, duration. Deliberately never
  # logs query strings, bodies, or headers -- those carry passwords, session
  # cookies, and the canary bypass token (which rides the WebSocket URL).
  class RequestLog
    def initialize(app, output: $stdout)
      @app = app
      @output = output
    end

    def call(env)
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      status, headers, body = @app.call(env)
      [status, headers, body]
    ensure
      elapsed_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
      # Bytes outside printable ASCII are written as %XX, so a path can't
      # start a fake log line or send escape codes to a terminal reading it.
      path = "#{env["SCRIPT_NAME"]}#{env["PATH_INFO"]}".b.gsub(/[^\x20-\x7e]/n) { |c| format("%%%02X", c.ord) }
      @output.puts("#{env["REQUEST_METHOD"]} #{path} #{status || 500} #{elapsed_ms}ms")
    end
  end
end
