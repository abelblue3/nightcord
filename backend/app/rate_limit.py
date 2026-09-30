import ipaddress

from fastapi import Request
from slowapi import Limiter

from app import clerk_auth

# Addresses our own hops use: Railway's edge proxy and private network (and
# the Ruby web layer on it), plus loopback for local runs. A client's real
# address is never in these ranges.
_INTERNAL_NETWORKS = [
    ipaddress.ip_network(network)
    for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8", "::1/128", "fc00::/7")
]


def _is_internal(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return True  # not an address our proxies would write; skip it
    return any(ip in network for network in _INTERNAL_NETWORKS)


def client_ip(request: Request) -> str:
    """The address rate limits are keyed on.

    Each proxy appends the address it received the request from to
    X-Forwarded-For, so the entries on the right are written by our own
    infrastructure and anything a client sends lands to their left. Walking
    from the right and taking the first non-internal entry gives the real
    client -- unlike uvicorn's `--forwarded-allow-ips=*`, which takes the
    leftmost entry, the one a client can simply make up.
    """
    forwarded = [entry.strip() for entry in request.headers.get("x-forwarded-for", "").split(",") if entry.strip()]
    for entry in reversed(forwarded):
        if not _is_internal(entry):
            return entry
    return request.client.host if request.client else "unknown"


def user_or_ip_key(request: Request) -> str:
    """For signed-in routes: one bucket per account, since a whole campus
    can sit behind a single NAT address. Only a token Clerk actually signed
    counts, so the key can't be forged; anything else falls back to the IP.
    """
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and token:
        try:
            return f"user:{clerk_auth.verify_session_token(token)['sub']}"
        except clerk_auth.InvalidSessionToken:
            pass
    return client_ip(request)


limiter = Limiter(key_func=client_ip)
