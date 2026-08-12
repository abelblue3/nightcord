from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auth import (
    DUMMY_PASSWORD_HASH,
    clear_auth_cookie,
    create_access_token,
    get_current_user,
    hash_password,
    is_account_locked,
    is_allowed_student_email,
    is_breached_password,
    record_failed_login,
    record_successful_login,
    require_csrf_header,
    revoke_all_sessions,
    set_auth_cookie,
    verify_google_id_token,
    verify_password,
)
from app.database import get_db
from app.gate import resolve_signup_timezone
from app.models import User
from app.rate_limit import limiter
from app.schemas import GoogleAuthRequest, LoginRequest, MessageResponse, UserCreate, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
def signup(request: Request, response: Response, payload: UserCreate, db: Session = Depends(get_db)) -> User:
    if not is_allowed_student_email(payload.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signup requires a valid college student email address.",
        )

    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered.")

    if is_breached_password(payload.password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That password has appeared in a known data breach. Please choose a different one.",
        )

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        display_name=payload.display_name,
        timezone=resolve_signup_timezone(payload.email, payload.timezone),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=user.email, token_version=user.token_version)
    set_auth_cookie(response, token)
    return user


@router.post("/login", response_model=UserOut)
@limiter.limit("10/minute")
def login(request: Request, response: Response, payload: LoginRequest, db: Session = Depends(get_db)) -> User:
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

    token = create_access_token(subject=user.email, token_version=user.token_version)
    set_auth_cookie(response, token)
    return user


@router.post("/google", response_model=UserOut)
def google_auth(response: Response, payload: GoogleAuthRequest, db: Session = Depends(get_db)) -> User:
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
        if user.timezone is None:
            user.timezone = resolve_signup_timezone(email, payload.timezone)
    else:
        user = User(
            email=email,
            hashed_password=None,
            google_id=google_id,
            display_name=claims.get("name") or email.split("@")[0],
            timezone=resolve_signup_timezone(email, payload.timezone),
        )
        db.add(user)

    db.commit()
    db.refresh(user)

    token = create_access_token(subject=user.email, token_version=user.token_version)
    set_auth_cookie(response, token)
    return user


@router.post("/logout", response_model=MessageResponse)
def logout(response: Response) -> MessageResponse:
    """Ends this browser's session only -- the token itself isn't revoked,
    so a copy held elsewhere (e.g. another device) is unaffected. See
    /auth/logout-all for actual server-side revocation.
    """
    clear_auth_cookie(response)
    return MessageResponse(message="Logged out.")


@router.post("/logout-all", response_model=MessageResponse, dependencies=[Depends(require_csrf_header)])
def logout_all(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> MessageResponse:
    """Invalidates every token issued for this account, on every device,
    by bumping token_version -- not just this browser's cookie.
    """
    revoke_all_sessions(user)
    db.commit()
    clear_auth_cookie(response)
    return MessageResponse(message="Logged out of all devices.")
