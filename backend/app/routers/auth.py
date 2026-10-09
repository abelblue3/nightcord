import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import clerk_auth
from app.auth import bearer_scheme, email_domain, get_current_user, is_allowed_student_email, verified_claims
from app.campus_time import SchoolLookup, find_school_ids, lookup_school
from app.database import get_db
from app.gate import resolve_signup_timezone
from app.models import User
from app.rate_limit import limiter
from app.schemas import EmailCheck, EmailCheckOut, MessageResponse, SessionStart, UserOut

# uvicorn's logger, like clerk_auth's, so failures show up formatted alongside
# the server's own lines.
logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/auth", tags=["auth"])

DISPLAY_NAME_MAX_LENGTH = User.__table__.c.display_name.type.length
NOT_A_STUDENT_MESSAGE = "nightcord is for college students — please sign up with your school email address."


def clerk_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Couldn't reach the sign-in service. Please try again.",
    )


@router.post("/session", response_model=UserOut)
@limiter.limit("10/minute")
def start_session(
    request: Request,
    payload: SessionStart,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Called by the frontend after every Clerk sign-in or sign-up. Clerk has
    already proven the student owns the email address; this decides whether
    that address may use nightcord, and creates or links the nightcord
    account for it.
    """
    if credentials is None:
        clerk_auth.logger.warning("POST /auth/session arrived without a Clerk session token (no Authorization header).")
    clerk_user_id = verified_claims(credentials)["sub"]

    try:
        clerk_user = clerk_auth.get_user(clerk_user_id)
    except clerk_auth.ClerkAPIError:
        logger.exception("Clerk get_user failed")
        raise clerk_unavailable()

    if not clerk_user.email or not clerk_user.email_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verify your email address to join nightcord.")

    email = clerk_user.email
    school = lookup_school(email_domain(email))
    if not is_allowed_student_email(email, school):
        # Nobody else can use this Clerk account either, so don't leave it
        # sitting in Clerk (and counting toward its user limits).
        try:
            clerk_auth.delete_user(clerk_user_id)
        except clerk_auth.ClerkAPIError:
            logger.exception("Clerk delete_user failed for a rejected sign-up")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NOT_A_STUDENT_MESSAGE)

    user = db.query(User).filter(User.clerk_user_id == clerk_user_id).first()
    if user is None:
        # An account from before Clerk (or from a deleted and re-created Clerk
        # user) with the same address: Clerk has now verified this person owns
        # it, so they inherit it -- name, timezone and messages.
        user = db.query(User).filter(func.lower(User.email) == email.lower()).first()

    if user is None:
        name = clerk_user.full_name or email.split("@")[0]
        user = User(
            email=email,
            clerk_user_id=clerk_user_id,
            display_name=name[:DISPLAY_NAME_MAX_LENGTH],
            timezone=resolve_signup_timezone(school, payload.timezone),
        )
        db.add(user)
    else:
        user.clerk_user_id = clerk_user_id
        if user.timezone is None:
            user.timezone = resolve_signup_timezone(school, payload.timezone)

    db.commit()
    db.refresh(user)
    return user


@router.post("/check-email", response_model=EmailCheckOut)
@limiter.limit("30/minute")
def check_email(request: Request, payload: EmailCheck) -> EmailCheckOut:
    """Answers "could this address join?" while someone is still typing it
    into the sign-up form, so a non-student is stopped before Clerk emails
    them a code. It only reads the bundled school list (plus a DNS lookup for
    an unknown .edu) -- no Clerk or campus-time calls -- and it says nothing
    about whether an account exists. /auth/session still enforces the rule.
    """
    school = SchoolLookup(found=bool(find_school_ids(email_domain(payload.email))), timezone=None)
    allowed = is_allowed_student_email(payload.email, school)
    return EmailCheckOut(allowed=allowed, message=None if allowed else NOT_A_STUDENT_MESSAGE)


@router.post("/logout-all", response_model=MessageResponse)
def logout_all(user: User = Depends(get_current_user)) -> MessageResponse:
    """Ends every Clerk session for this account, on every device. (Signing
    out of just this browser happens in Clerk on the frontend.)
    """
    try:
        clerk_auth.revoke_all_sessions(user.clerk_user_id)
    except clerk_auth.ClerkAPIError:
        logger.exception("Clerk revoke_all_sessions failed")
        raise clerk_unavailable()
    return MessageResponse(message="Signed out of all devices.")
