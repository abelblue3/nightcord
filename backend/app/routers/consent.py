from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import ConsentRecord, User
from app.rate_limit import limiter, user_or_ip_key
from app.schemas import ConsentIn, MessageResponse

router = APIRouter(prefix="/consent", tags=["consent"])


@router.post("", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute", key_func=user_or_ip_key)
def record_consent(
    request: Request,
    payload: ConsentIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MessageResponse:
    """Logs a signed-in student's cookie/data choice (from the consent
    banner). Visitors who aren't signed in keep theirs in the browser only;
    the frontend sends it here once they sign in.
    """
    db.add(
        ConsentRecord(
            user_id=user.id,
            policy_version=payload.policy_version,
            preferences=payload.preferences,
            diagnostics=payload.diagnostics,
        )
    )
    db.commit()
    return MessageResponse(message="Consent recorded.")
