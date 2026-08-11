from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, WebSocketException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.connection_manager import manager
from app.database import get_db
from app.models import Message, Room, User

router = APIRouter(tags=["chat"])


def get_user_from_token(token: str, db: Session) -> User:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        email = payload.get("sub")
    except JWTError:
        email = None

    user = db.query(User).filter(User.email == email).first() if email else None
    if user is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or missing token")
    return user


@router.websocket("/ws/rooms/{room_id}")
async def room_chat(websocket: WebSocket, room_id: int, token: str, db: Session = Depends(get_db)):
    user = get_user_from_token(token, db)

    room = db.get(Room, room_id)
    if not room:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Room not found")

    await manager.connect(room_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            content = (data.get("content") or "").strip()
            if not content:
                continue

            message = Message(room_id=room_id, user_id=user.id, content=content)
            db.add(message)
            db.commit()
            db.refresh(message)

            await manager.broadcast(
                room_id,
                {
                    "id": message.id,
                    "room_id": room_id,
                    "user_id": user.id,
                    "display_name": user.display_name,
                    "content": message.content,
                    "created_at": message.created_at.isoformat(),
                },
            )
    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
