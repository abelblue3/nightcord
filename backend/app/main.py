import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings
from app.rate_limit import limiter
from app.routers import auth, chat, rooms

if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        send_default_pii=False,
    )

app = FastAPI(title="nightcord")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    # This API only ever returns JSON -- nothing here should load or
    # execute anything, so the policy can be maximally strict. The actual
    # pages (Vercel-hosted) have their own, necessarily less strict CSP
    # covering Google Sign-In, Sentry, etc. -- see frontend/vercel.json.
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if settings.environment == "production":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


app.include_router(auth.router)
app.include_router(rooms.router)
app.include_router(chat.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
