require "ipaddr"

module NightcordWeb
  # The real client address, for FastAPI's per-IP rate limits. Same rule as
  # the backend's app/rate_limit.py: each proxy appends to X-Forwarded-For,
  # so walk it from the right and take the first address that isn't one of
  # our own hops -- anything a client typed in lands further left and is
  # ignored. (Rack::Request#ip isn't used because its trusted-proxy list
  # doesn't include 100.64.0.0/10, a range Railway's network uses.)
  module ClientIp
    INTERNAL_NETWORKS = %w[10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 127.0.0.0/8 ::1/128 fc00::/7]
      .map { |network| IPAddr.new(network) }.freeze

    def self.from_env(env)
      forwarded = env["HTTP_X_FORWARDED_FOR"].to_s.split(",").map(&:strip).reject(&:empty?)
      forwarded.reverse_each { |entry| return entry unless internal?(entry) }
      env["REMOTE_ADDR"]
    end

    def self.internal?(address)
      ip = IPAddr.new(address)
      INTERNAL_NETWORKS.any? { |network| network.include?(ip) }
    rescue IPAddr::Error
      true # not an address our proxies would write; skip it
    end
  end
end
