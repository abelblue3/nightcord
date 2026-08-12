from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import (
    DUMMY_PASSWORD_HASH,
    create_access_token,
    generate_verification_token,
    hash_password,
    is_account_locked,
    is_allowed_student_email,
    record_failed_login,
    record_successful_login,
    verify_google_id_token,
    verify_password,
)
from app.database import get_db
from app.email import send_verification_email
from app.gate import resolve_signup_timezone
from app.models import User, as_utc
from app.rate_limit import limiter
from app.schemas import (
    GoogleAuthRequest,
    LoginRequest,
    MessageResponse,
    ResendVerificationRequest,
    Token,
    UserCreate,
    UserOut,
    VerifyEmailRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
def signup(request: Request, payload: UserCreate, db: Session = Depends(get_db)) -> User:
    if not is_allowed_student_email(payload.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signup requires a valid college student email address.",
        )

    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered.")

    token, expires_at = generate_verification_token()
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        display_name=payload.display_name,
        timezone=resolve_signup_timezone(payload.email, payload.timezone),
        is_verified=False,
        verification_token=token,
        verification_token_expires_at=expires_at,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    send_verification_email(user.email, token)
    return user


@router.post("/login", response_model=Token)
@limiter.limit("10/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> Token:
    user = db.query(User).filter(User.email == payload.email).first()
    locked = user is not None and is_account_locked(user)

    if user is not None and user.hashed_password is not None and not locked:
        password_ok = verify_password(payload.password, user.hashed_password)
    else:
        # No real hash to check against (no such user, a Google-only account,
        # or a locked-out account) -- verify against a dummy hash anyway so
        # this path costs the same as a genuine wrong-password check. Without
        # this, response timing alone would reveal which of those cases it is.
        verify_password(payload.password, DUMMY_PASSWORD_HASH)
        password_ok = False

    if user is None or not password_ok:
        if user is not None:
            record_failed_login(user)
            db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    record_successful_login(user)
    db.commit()

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in — check your inbox for the link.",
        )

    token = create_access_token(subject=user.email)
    return Token(access_token=token, user=user)


@router.post("/verify-email", response_model=Token)
@limiter.limit("20/hour")
def verify_email(request: Request, payload: VerifyEmailRequest, db: Session = Depends(get_db)) -> Token:
    user = db.query(User).filter(User.verification_token == payload.token).first()

    if not user or not user.verification_token_expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification link.")

    if as_utc(user.verification_token_expires_at) < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This verification link has expired. Request a new one.",
        )

    user.is_verified = True
    user.verification_token = None
    user.verification_token_expires_at = None
    db.commit()

    token = create_access_token(subject=user.email)
    return Token(access_token=token, user=user)


@router.post("/google", response_model=Token)
def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)) -> Token:
    claims = verify_google_id_token(payload.credential)

    email = claims.get("email")
    if not email or not claims.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google did not return a verified email address.",
        )

    if not is_allowed_student_email(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sign-in requires a valid college student email address.",
        )

    google_id = claims["sub"]
    user = db.query(User).filter(User.google_id == google_id).first()

    if not user:
        user = db.query(User).filter(User.email == email).first()
        if user and user.google_id and user.google_id != google_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered.")

    if user:
        user.google_id = google_id
        user.is_verified = True
        if user.timezone is None:
            user.timezone = resolve_signup_timezone(email, payload.timezone)
    else:
        user = User(
            email=email,
            hashed_password=None,
            google_id=google_id,
            display_name=claims.get("name") or email.split("@")[0],
            is_verified=True,
            timezone=resolve_signup_timezone(email, payload.timezone),
        )
        db.add(user)

    db.commit()
    db.refresh(user)

    token = create_access_token(subject=user.email)
    return Token(access_token=token, user=user)


@router.post("/resend-verification", response_model=MessageResponse)
@limiter.limit("3/hour")
def resend_verification(request: Request, payload: ResendVerificationRequest, db: Session = Depends(get_db)) -> MessageResponse:
    user = db.query(User).filter(User.email == payload.email).first()

    if user and not user.is_verified:
        token, expires_at = generate_verification_token()
        user.verification_token = token
        user.verification_token_expires_at = expires_at
        db.commit()
        send_verification_email(user.email, token)

    # Same response whether or not the account exists, so we don't leak which emails are registered.
    return MessageResponse(message="If that account needs verifying, a new link has been sent.")
