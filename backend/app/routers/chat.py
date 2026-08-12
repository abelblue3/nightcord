from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, WebSocketException, status
from sqlalchemy.orm import Session

from app import gate
from app.auth import ACCESS_TOKEN_COOKIE_NAME, decode_user_from_token
from app.connection_manager import manager
from app.database import get_db
from app.models import Message, Room, User

router = APIRouter(tags=["chat"])


def get_user_from_websocket(websocket: WebSocket, db: Session) -> User:
    token = websocket.cookies.get(ACCESS_TOKEN_COOKIE_NAME)
    user = decode_user_from_token(token, db) if token else None
    if user is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or missing session")
    return user


@router.websocket("/ws/rooms/{room_id}")
async def room_chat(
    websocket: WebSocket,
    room_id: int,
    skip_gate: str | None = None,
    canary_token: str | None = None,
    db: Session = Depends(get_db),
):
    user = get_user_from_websocket(websocket, db)

    room = db.get(Room, room_id)
    if not room:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Room not found")

    if not (gate.dev_bypass_active(skip_gate) or gate.canary_bypass_active(canary_token)):
        user_tz = user.timezone or gate.FALLBACK_TIMEZONE
        if not gate.is_night_in_timezone(user_tz):
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason=f"gate-closed:{user_tz}")

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
