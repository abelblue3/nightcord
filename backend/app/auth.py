import dns.exception
import dns.resolver
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app import clerk_auth
from app.campus_time import SchoolLookup
from app.config import settings
from app.database import get_db
from app.models import User

MX_LOOKUP_TIMEOUT_SECONDS = 3.0

# Every signed-in request carries `Authorization: Bearer <Clerk session token>`.
# There is no cookie, so there's nothing for a cross-site request to ride on.
bearer_scheme = HTTPBearer(auto_error=False)

NOT_LINKED_CODE = "not-linked"


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


def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].lower()


def is_allowed_student_email(email: str, school: SchoolLookup) -> bool:
    """`school` is the lookup_school() result for this email's domain --
    passed in so a sign-in makes one round of campus-time calls, not two.
    """
    # A domain that belongs to a school in the NCES directory is trusted
    # whatever it ends in -- some real colleges use .org, .com, .us, ...
    if school.found:
        return True

    # Anything else must be an allowed suffix (.edu by default -- only
    # accredited institutions can register one) and must actually receive
    # mail, which catches typos and nonexistent domains that end in .edu.
    domain = email_domain(email)
    matches_allowed_suffix = any(
        domain == allowed.lstrip(".") or domain.endswith(allowed if allowed.startswith(".") else f".{allowed}")
        for allowed in settings.allowed_email_domain_list
    )
    return matches_allowed_suffix and has_valid_mx_record(domain)


def credentials_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")


def verified_claims(credentials: HTTPAuthorizationCredentials | None) -> dict:
    if credentials is None:
        raise credentials_error()
    try:
        return clerk_auth.verify_session_token(credentials.credentials)
    except clerk_auth.InvalidSessionToken as error:
        clerk_auth.logger.warning("Rejected a Clerk session token: %s", error)
        raise credentials_error()


def user_from_token(token: str, db: Session) -> User | None:
    """Shared by the HTTP dependency and the chat WebSocket, so both check
    tokens the same way.
    """
    try:
        claims = clerk_auth.verify_session_token(token)
    except clerk_auth.InvalidSessionToken as error:
        clerk_auth.logger.warning("Rejected a Clerk session token on a chat socket: %s", error)
        return None
    return db.query(User).filter(User.clerk_user_id == claims["sub"]).first()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    claims = verified_claims(credentials)
    user = db.query(User).filter(User.clerk_user_id == claims["sub"]).first()
    if user is None:
        # Signed in with Clerk, but POST /auth/session hasn't created or
        # linked the nightcord account yet. The frontend does that and retries.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"message": "Finish signing in to nightcord.", "code": NOT_LINKED_CODE},
        )
    return user
