from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Message, Room, User
from app.schemas import MessageOut, RoomCreate, RoomOut

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.get("", response_model=list[RoomOut])
def list_rooms(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> list[Room]:
    return db.query(Room).order_by(Room.created_at.desc()).all()


@router.post("", response_model=RoomOut, status_code=status.HTTP_201_CREATED)
def create_room(
    payload: RoomCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Room:
    if db.query(Room).filter(Room.name == payload.name).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Room name already taken.")

    room = Room(name=payload.name, created_by=current_user.id)
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


@router.get("/{room_id}/messages", response_model=list[MessageOut])
def get_room_messages(
    room_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Message]:
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")

    return db.query(Message).filter(Message.room_id == room_id).order_by(Message.created_at.asc()).all()
