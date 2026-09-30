import json

from fastapi import APIRouter, Depends, WebSocket, WebSocketException, status
from sqlalchemy.orm import Session

from app import gate
from app.auth import ACCESS_TOKEN_COOKIE_NAME, decode_user_from_token
from app.config import settings
from app.connection_manager import manager
from app.database import get_db
from app.models import Message, Room, User

router = APIRouter(tags=["chat"])

# Taken from the column itself so the two can't drift apart. Postgres rejects
# anything longer outright (SQLite silently stores it), so over-long content
# has to be dropped here rather than left to fail at commit time.
MAX_MESSAGE_LENGTH = Message.__table__.c.content.type.length


def origin_allowed(websocket: WebSocket) -> bool:
    """CORS doesn't apply to WebSockets, and with a SameSite=None session
    cookie any other website could otherwise open a chat socket as whoever
    is logged in. Browsers always send Origin on a WebSocket handshake, so
    it's checked against the same allowlist CORS uses. A missing Origin means
    a non-browser client (e.g. the canary), which has no victim's cookie to
    ride, so it's let through to the normal cookie check.
    """
    origin = websocket.headers.get("origin")
    return origin is None or origin in settings.cors_origin_list


def parse_message_content(raw: str | None) -> str | None:
    """Returns the message text to store, or None if the frame should be
    ignored. Anything malformed is skipped rather than raised -- an uncaught
    error here would drop the sender's connection over one bad frame.
    """
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("content"), str):
        return None

    content = data["content"].strip()
    if not content or len(content) > MAX_MESSAGE_LENGTH:
        return None
    return content


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
    if not origin_allowed(websocket):
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Origin not allowed")

    user = get_user_from_websocket(websocket, db)

    room = db.get(Room, room_id)
    if not room:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Room not found")

    if not (gate.dev_bypass_active(skip_gate) or gate.canary_bypass_active(canary_token)):
        user_tz = user.timezone or gate.FALLBACK_TIMEZONE
        if not gate.is_night_in_timezone(user_tz):
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason=f"gate-closed:{user_tz}")

    await manager.connect(room_id, websocket)
    # Whatever ends this loop -- a normal disconnect or an unexpected error --
    # the connection must come out of the room's broadcast list. A dead socket
    # left behind would make every later broadcast in the room fail.
    try:
        while True:
            frame = await websocket.receive()
            if frame["type"] == "websocket.disconnect":
                break

            content = parse_message_content(frame.get("text"))
            if content is None:
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
    finally:
        manager.disconnect(room_id, websocket)
