from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session, joinedload

from app.auth import require_csrf_header
from app.database import get_db
from app.gate import require_night_access
from app.models import Message, Room, User
from app.rate_limit import limiter, user_or_ip_key
from app.schemas import MessageOut, RoomCreate, RoomOut

router = APIRouter(prefix="/rooms", tags=["rooms"])

MESSAGE_PAGE_SIZE = 50
MAX_MESSAGE_PAGE_SIZE = 100


@router.get("", response_model=list[RoomOut])
@limiter.limit("60/minute", key_func=user_or_ip_key)
def list_rooms(request: Request, db: Session = Depends(get_db), _: User = Depends(require_night_access)) -> list[Room]:
    return db.query(Room).order_by(Room.created_at.desc()).all()


@router.post("", response_model=RoomOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf_header)])
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
