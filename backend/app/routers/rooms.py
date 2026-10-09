from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from livekit import api as livekit
from sqlalchemy.orm import Session, joinedload

from app import gate
from app.config import settings
from app.database import get_db
from app.gate import require_night_access
from app.models import Message, Room, User
from app.rate_limit import limiter, user_or_ip_key
from app.schemas import MessageOut, RoomCreate, RoomOut, VideoTokenOut

router = APIRouter(prefix="/rooms", tags=["rooms"])

MESSAGE_PAGE_SIZE = 50
MAX_MESSAGE_PAGE_SIZE = 100


@router.get("", response_model=list[RoomOut])
@limiter.limit("60/minute", key_func=user_or_ip_key)
def list_rooms(request: Request, db: Session = Depends(get_db), _: User = Depends(require_night_access)) -> list[Room]:
    return db.query(Room).order_by(Room.created_at.desc()).all()


@router.post("", response_model=RoomOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour", key_func=user_or_ip_key)
def create_room(
    request: Request,
    payload: RoomCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_night_access),
) -> Room:
    if db.query(Room).filter(Room.name == payload.name).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Room name already taken.")

    room = Room(name=payload.name, created_by=current_user.id)
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


@router.get("/{room_id}/messages", response_model=list[MessageOut])
@limiter.limit("60/minute", key_func=user_or_ip_key)
def get_room_messages(
    request: Request,
    room_id: int,
    before: int | None = Query(default=None, ge=1, description="Only messages older than this message id."),
    limit: int = Query(default=MESSAGE_PAGE_SIZE, ge=1, le=MAX_MESSAGE_PAGE_SIZE),
    db: Session = Depends(get_db),
    _: User = Depends(require_night_access),
) -> list[Message]:
    """One page of history, oldest first: the newest `limit` messages, or
    the `limit` messages just before `before` when paging back further.
    """
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")

    query = (
        db.query(Message)
        .options(joinedload(Message.author))  # display_name for every message, without a query per message
        .filter(Message.room_id == room_id)
    )
    if before is not None:
        query = query.filter(Message.id < before)

    newest_first = query.order_by(Message.id.desc()).limit(limit).all()
    return list(reversed(newest_first))


@router.post("/{room_id}/video-token", response_model=VideoTokenOut)
@limiter.limit("20/minute", key_func=user_or_ip_key)
def get_video_token(
    request: Request,
    room_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_night_access),
) -> VideoTokenOut:
    """A LiveKit join token for this room's video call. LiveKit carries the
    video and audio; nightcord only decides who may join, with the same
    checks as the chat (signed in, night at their school).
    """
    if not (settings.livekit_url and settings.livekit_api_key and settings.livekit_api_secret):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Video isn't set up yet.")
    if not db.get(Room, room_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")

    # Valid until 6am at the student's school, so nobody can join after the
    # night ends.
    night_ends = gate.night_ends_at(current_user.timezone or gate.FALLBACK_TIMEZONE)
    token = (
        livekit.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(str(current_user.id))
        .with_name(current_user.display_name)
        .with_ttl(night_ends - datetime.now(timezone.utc))
        .with_grants(
            livekit.VideoGrants(
                room_join=True,
                room=f"room-{room_id}",
                can_subscribe=True,
                can_publish=True,
                can_publish_sources=["camera", "microphone"],  # no screen sharing
                can_publish_data=False,  # chat stays on nightcord's own socket
            )
        )
    )
    return VideoTokenOut(url=settings.livekit_url, token=token.to_jwt())
