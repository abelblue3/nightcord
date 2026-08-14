"""Server-side enforcement of nightcord's night-only access rule.

Unlike the original client-side-only gate, this is the authoritative check:
room listing, room creation, message history, and the chat WebSocket all
depend on it. "Night" is defined relative to the *student's school*, not
their device clock or IP address, specifically so it can't be spoofed by
changing a system clock or using a VPN -- see the handoff doc's Decisions
section for the full reasoning.
"""
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, Header, HTTPException, status

from app.auth import get_current_user
from app.config import settings
from app.edu_domains import get_institution_timezone
from app.models import User

NIGHT_START_HOUR = 21  # 9 PM
NIGHT_END_HOUR = 6  # 6 AM
FALLBACK_TIMEZONE = "UTC"


def is_valid_timezone(tz_name: str) -> bool:
    try:
        ZoneInfo(tz_name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def resolve_signup_timezone(email: str, client_timezone: str | None) -> str:
    """Institution's timezone first (authoritative, not client-controlled).
    Falls back to the browser-reported timezone the frontend sends at
    signup, then to UTC as a last resort if neither is available/valid.
    """
    domain = email.rsplit("@", 1)[-1].lower()
    institution_tz = get_institution_timezone(domain)
    if institution_tz:
        return institution_tz

    if client_timezone and is_valid_timezone(client_timezone):
        return client_timezone

    return FALLBACK_TIMEZONE


def is_night_in_timezone(tz_name: str, now: datetime | None = None) -> bool:
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo(FALLBACK_TIMEZONE)

    current = (now or datetime.now(tz)).astimezone(tz)
    hour = current.hour
    return hour >= NIGHT_START_HOUR or hour < NIGHT_END_HOUR


def dev_bypass_active(skip_gate_header: str | None) -> bool:
    """Mirrors the frontend's ?skipGate=1 dev-only escape hatch, extended to
    actually affect server enforcement. Only ever honored on a local dev
    machine -- explicitly opt-in ("== development"), not opt-out ("!=
    production"), so any other deployed environment (beta, staging, ...)
    is secure by default even if nobody remembered to special-case it.
    """
    return settings.environment == "development" and skip_gate_header == "1"


def canary_bypass_active(canary_token_header: str | None) -> bool:
    """The scheduled canary check (.github/workflows/canary.yml) runs 24/7
    against production and never went through signup, so it has no
    school-derived timezone -- it needs its own exemption, separate from the
    dev-only bypass above (which is correctly forbidden in production).
    Requires both sides to be a real, non-empty, matching secret.
    """
    return bool(settings.canary_bypass_token) and canary_token_header == settings.canary_bypass_token


def require_night_access(
    current_user: User = Depends(get_current_user),
    x_dev_skip_gate: str | None = Header(default=None),
    x_canary_token: str | None = Header(default=None),
) -> User:
    """FastAPI dependency: the authoritative night gate. Unlike login, which
    stays open around the clock, this blocks room listing/creation, message
    history, and the chat WebSocket outside night hours -- computed from the
    user's stored (school-derived) timezone, not anything the client claims.
    """
    if dev_bypass_active(x_dev_skip_gate) or canary_bypass_active(x_canary_token):
        return current_user

    user_tz = current_user.timezone or FALLBACK_TIMEZONE
    if not is_night_in_timezone(user_tz):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "nightcord is closed right now for your school.",
                "timezone": user_tz,
            },
        )
    return current_user
