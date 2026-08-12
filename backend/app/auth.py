import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import dns.exception
import dns.resolver
import httpx
from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.edu_domains import is_known_edu_institution
from app.models import User, as_utc

MX_LOOKUP_TIMEOUT_SECONDS = 3.0
PWNED_API_TIMEOUT_SECONDS = 2.0

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ACCESS_TOKEN_COOKIE_NAME = "access_token"

# A hash of a password nobody has. Verifying against this on every login
# failure path that doesn't have a real hash to check (no such user, a
# Google-only account, or a locked-out account) burns the same bcrypt cost as
# a genuine wrong-password attempt, so response timing can't be used to tell
# those cases apart from the outside.
DUMMY_PASSWORD_HASH = CryptContext(schemes=["bcrypt"]).hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    if hashed_password is None:
        return False
    return pwd_context.verify(plain_password, hashed_password)


def is_account_locked(user: User) -> bool:
    return user.lockout_until is not None and as_utc(user.lockout_until) > datetime.now(timezone.utc)


def record_failed_login(user: User) -> None:
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= settings.login_max_failed_attempts:
        user.lockout_until = datetime.now(timezone.utc) + timedelta(minutes=settings.login_lockout_minutes)
        user.failed_login_attempts = 0


def record_successful_login(user: User) -> None:
    user.failed_login_attempts = 0
    user.lockout_until = None


def revoke_all_sessions(user: User) -> None:
    """Invalidates every token already issued for this account, not just the
    one in the browser that called this -- bumping the version makes every
    previously-issued JWT fail the `ver` check in decode_user_from_token,
    regardless of how many devices/browsers hold a copy.
    """
    user.token_version += 1


def _cookie_flags() -> dict:
    # Production genuinely spans two different sites (Vercel <-> Railway),
    # which requires SameSite=None (and therefore Secure) for the cookie to
    # survive the cross-site hop. Local dev is same-site (just different
    # localhost ports), so Lax without Secure works over plain http.
    is_prod = settings.environment == "production"
    return {"httponly": True, "secure": is_prod, "samesite": "none" if is_prod else "lax"}


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE_NAME,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        **_cookie_flags(),
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=ACCESS_TOKEN_COOKIE_NAME, **_cookie_flags())


def verify_google_id_token(credential: str) -> dict:
    try:
        return google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), settings.google_client_id
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google credential.")


def has_valid_mx_record(domain: str) -> bool:
    """Confirms the domain can currently receive mail at all. Fails closed:
    any lookup problem (nonexistent domain, no mail servers, timeout, resolver
    error) is treated as "not a real, reachable domain" rather than allowing
    it through.
    """
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=MX_LOOKUP_TIMEOUT_SECONDS)
        return len(answers) > 0
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers, dns.exception.Timeout):
        return False
    except Exception:
        return False


def is_breached_password(password: str) -> bool:
    """Checks the password against the Have I Been Pwned Pwned Passwords
    corpus using k-anonymity: only a 5-character SHA-1 prefix is ever sent
    over the network, shared by hundreds of unrelated hashes, so neither the
    password nor its full hash leaves this server.

    Fails open (treats the password as clean) on any network/API problem --
    unlike has_valid_mx_record's fail-closed behavior above, an outage here
    says nothing about whether the password itself is bad, so blocking every
    signup over a third-party hiccup would be the wrong tradeoff.
    """
    sha1 = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = sha1[:5], sha1[5:]
    try:
        response = httpx.get(f"https://api.pwnedpasswords.com/range/{prefix}", timeout=PWNED_API_TIMEOUT_SECONDS)
        response.raise_for_status()
    except httpx.HTTPError:
        return False
    return any(line.partition(":")[0] == suffix for line in response.text.splitlines())


def is_allowed_student_email(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1].lower()

    matches_allowed_suffix = any(
        domain == allowed.lstrip(".") or domain.endswith(allowed if allowed.startswith(".") else f".{allowed}")
        for allowed in settings.allowed_email_domain_list
    )
    if not matches_allowed_suffix:
        return False

    # A domain we recognize as a real, accredited institution is trusted
    # outright -- no need for a network call. Anything else still has to
    # prove it can actually receive mail, which catches typos and
    # nonexistent domains that happen to end in .edu.
    if is_known_edu_institution(domain):
        return True

    return has_valid_mx_record(domain)


def create_access_token(subject: str, token_version: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "ver": token_version, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_user_from_token(token: str, db: Session) -> User | None:
    """Shared by the HTTP cookie dependency and the WebSocket auth path so
    the ver-claim revocation check can't drift between the two.
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except JWTError:
        return None

    email = payload.get("sub")
    if email is None:
        return None

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        return None

    if payload.get("ver") != user.token_version:
        return None
    return user


def get_current_user(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )
    if access_token is None:
        raise credentials_exception
    user = decode_user_from_token(access_token, db)
    if user is None:
        raise credentials_exception
    return user


def require_csrf_header(x_requested_with: str | None = Header(default=None)) -> None:
    """Cookie-based auth means the browser attaches credentials to any
    request to this API, cross-site or not -- SameSite=None in production
    removes the protection SameSite=Lax/Strict would otherwise give for
    free. Strict CORS + JSON-only bodies already block the two classic CSRF
    vectors (a script-driven cross-origin fetch fails CORS preflight; a bare
    cross-site <form> POST can't produce a JSON body FastAPI will parse) --
    this header is a deliberate extra layer in case either of those is ever
    loosened without someone noticing the CSRF implication. A third-party
    page can't set custom headers on a simple form post, so this is cheap
    to enforce and cheap for the frontend to satisfy.
    """
    if x_requested_with != "nightcord":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing or invalid request header.")
