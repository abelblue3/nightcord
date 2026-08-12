from slowapi import Limiter
from slowapi.util import get_remote_address

# Keyed on the caller's IP address. get_remote_address reads request.client.host,
# which only reflects the real client (rather than Railway's proxy) once uvicorn
# is started with --proxy-headers -- see railway.json.
limiter = Limiter(key_func=get_remote_address)
