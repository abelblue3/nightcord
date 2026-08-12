import secrets
from datetime import datetime, timedelta, timezone

import dns.exception
import dns.resolver
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.edu_domains import is_known_edu_institution
from app.models import User

MX_LOOKUP_TIMEOUT_SECONDS = 3.0

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

VERIFICATION_TOKEN_EXPIRE_HOURS = 24


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    if hashed_password is None:
        return False
    return pwd_context.verify(plain_password, hashed_password)


def generate_verification_token() -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=VERIFICATION_TOKEN_EXPIRE_HOURS)
    return token, expires_at


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


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        email = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user
