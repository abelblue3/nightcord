require "json"
require "sinatra/base"

module NightcordWeb
  # Serves the Vite build (index.html, rooms.html, room.html, assets/...) from
  # `public_folder`, which NightcordWeb.app points at DIST_DIR.
  class Pages < Sinatra::Base
    # Railway's edge decides which hostnames reach this service; the pages
    # never build absolute URLs from the Host header.
    set :host_authorization, {}
    set :static, true
    set :show_exceptions, false
    set :logging, false # RequestLog covers every request, not just these

    get "/" do
      send_file File.join(settings.public_folder, "index.html")
    end

    # Answers without touching FastAPI, so a backend outage can't make Railway
    # restart this service in a loop.
    get "/healthz" do
      content_type :json
      JSON.generate(status: "ok")
    end

    not_found do
      content_type :text
      "Not found"
    end
  end
end
