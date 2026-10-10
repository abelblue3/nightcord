import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app import clerk_auth
from app.config import settings
from app.rate_limit import limiter
from app.routers import auth, chat, consent, profiles, rooms

if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        send_default_pii=False,
    )


def api_docs_settings(environment: str) -> dict:
    """/docs, /redoc and /openapi.json map out every endpoint -- handy
    locally, no reason to publish. Only a local dev machine gets them.
    """
    if environment == "development":
        return {}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


app = FastAPI(title="nightcord", **api_docs_settings(settings.environment))

app.state.limiter = limiter

clerk_auth.log_configuration_problems()


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    # `detail`, like every other error, so the frontend shows this message.
    return JSONResponse(status_code=429, content={"detail": "Too many requests. Please wait a bit and try again."})


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
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if settings.environment != "development":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


app.include_router(auth.router)
app.include_router(rooms.router)
app.include_router(chat.router)
app.include_router(consent.router)
app.include_router(profiles.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
