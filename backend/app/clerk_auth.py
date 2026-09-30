"""Clerk handles sign-up, sign-in and email verification; this module is
nightcord's side of that: checking Clerk session tokens, and the few Clerk
Backend API calls the app makes.

Session tokens are short-lived (60 seconds) RS256 JWTs that the browser
refreshes through Clerk's own script. They're verified here with the
instance's public key (CLERK_JWT_KEY), so ordinary requests never call
Clerk -- only first sign-in, rejecting a non-student, and "log out of all
devices" do.
"""
from dataclasses import dataclass

import httpx
import jwt

from app.config import settings

CLERK_API_TIMEOUT_SECONDS = 5.0
# Tolerates small clock differences between Clerk and this server.
TOKEN_LEEWAY_SECONDS = 5


class InvalidSessionToken(Exception):
    pass


class ClerkAPIError(Exception):
    pass


def verify_session_token(token: str) -> dict:
    """Returns the token's claims if Clerk signed it and it's still valid.
    `sub` is the Clerk user id.
    """
    public_key = settings.clerk_jwt_public_key
    if not public_key:
        raise InvalidSessionToken("CLERK_JWT_KEY is not configured.")

    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],  # never HS256: that would let the public key act as a signing secret
            leeway=TOKEN_LEEWAY_SECONDS,
            options={"require": ["exp", "nbf", "sub"]},
        )
    except jwt.PyJWTError as error:
        raise InvalidSessionToken(str(error)) from error

    # `azp` is the page origin the token was issued to. Clerk's guidance is to
    # check it against the origins you serve; tokens minted server-side (the
    # canary's) carry none.
    authorized_party = claims.get("azp")
    if authorized_party is not None and authorized_party not in settings.cors_origin_list:
        raise InvalidSessionToken(f"Token issued to an unknown origin: {authorized_party}")

    return claims


@dataclass(frozen=True)
class ClerkUser:
    id: str
    email: str | None  # the primary email address
    email_verified: bool
    first_name: str | None
    last_name: str | None

    @property
    def full_name(self) -> str:
        return " ".join(part for part in (self.first_name, self.last_name) if part).strip()


def _request(method: str, path: str, **kwargs) -> httpx.Response:
    try:
        response = httpx.request(
            method,
            f"{settings.clerk_api_url}{path}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            timeout=CLERK_API_TIMEOUT_SECONDS,
            **kwargs,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise ClerkAPIError(f"Clerk {method} {path} failed: {error}") from error
    return response


def get_user(user_id: str) -> ClerkUser:
    data = _request("GET", f"/users/{user_id}").json()

    primary_id = data.get("primary_email_address_id")
    email, verified = None, False
    for address in data.get("email_addresses") or []:
        if address.get("id") == primary_id:
            email = address.get("email_address")
            verified = (address.get("verification") or {}).get("status") == "verified"

    return ClerkUser(
        id=data["id"],
        email=email,
        email_verified=verified,
        first_name=data.get("first_name"),
        last_name=data.get("last_name"),
    )


def delete_user(user_id: str) -> None:
    _request("DELETE", f"/users/{user_id}")


def revoke_all_sessions(user_id: str) -> None:
    """Signs the user out everywhere. Already-issued session tokens stay
    valid until they expire, which is at most a minute.
    """
    data = _request("GET", "/sessions", params={"user_id": user_id, "status": "active"}).json()
    sessions = data if isinstance(data, list) else data.get("data", [])
    for session in sessions:
        _request("POST", f"/sessions/{session['id']}/revoke")
