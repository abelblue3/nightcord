from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import Message, Report, Room, User, as_utc
from app.rate_limit import limiter, user_or_ip_key
from app.schemas import MessageResponse, ReportIn

# Reporting needs sign-in only -- not the night gate -- so a student can
# report in the daytime about something from the night before.
router = APIRouter(prefix="/reports", tags=["reports"])

SNAPSHOT_SIZE = 50


def room_snapshot(db: Session, room_id: int, up_to_message_id: int | None) -> list[dict]:
    """A copy of the room's last messages (up to the reported one), oldest
    first. Everyone's, including people the reporter blocked: reviewers need
    the whole conversation."""
    query = db.query(Message).options(joinedload(Message.author)).filter(Message.room_id == room_id)
    if up_to_message_id is not None:
        query = query.filter(Message.id <= up_to_message_id)
    newest_first = query.order_by(Message.id.desc()).limit(SNAPSHOT_SIZE).all()
    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "display_name": m.author.display_name,
            "content": m.content,
            "created_at": as_utc(m.created_at).isoformat(),
        }
        for m in reversed(newest_first)
    ]


@router.post("", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour", key_func=user_or_ip_key)
def report_student(
    request: Request,
    payload: ReportIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MessageResponse:
    """Saves the report with a copy of the room's recent messages. The reply
    never includes them, so reporting can't be used to read a room."""
    if payload.reported_id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't report yourself.")
    if not db.get(User, payload.reported_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such student.")

    snapshot = []
    if payload.room_id is not None:
        if not db.get(Room, payload.room_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
        if payload.message_id is not None:
            message = db.get(Message, payload.message_id)
            if not message or message.room_id != payload.room_id or message.user_id != payload.reported_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That message isn't theirs in this room.")
        snapshot = room_snapshot(db, payload.room_id, payload.message_id)

    db.add(
        Report(
            reporter_id=user.id,
            reported_id=payload.reported_id,
            room_id=payload.room_id,
            message_id=payload.message_id,
            reason=payload.reason,
            details=payload.details or None,
            snapshot=snapshot,
        )
    )
    db.commit()
    return MessageResponse(message="Report received.")
