import asyncio
import json
import math
import time
from collections import deque
from datetime import datetime

from fastapi import APIRouter, Depends, WebSocket, WebSocketException, status
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool

from app import gate
from app.auth import session_claims
from app.config import settings
from app.connection_manager import manager
from app.database import get_session_factory
from app.models import Message, Room, User

router = APIRouter(tags=["chat"])

# Taken from the column itself so the two can't drift apart. Postgres rejects
# anything longer outright (SQLite silently stores it), so over-long content
# has to be dropped here rather than left to fail at commit time.
MAX_MESSAGE_LENGTH = Message.__table__.c.content.type.length

# Per connection, at most SEND_LIMIT frames per SEND_WINDOW_SECONDS; extra
# frames are dropped before they reach the database. A connection that keeps
# flooding past FLOOD_MULTIPLIER times the limit is disconnected.
SEND_LIMIT = 5
SEND_WINDOW_SECONDS = 5.0
FLOOD_MULTIPLIER = 3


class SendLimiter:
    """Sliding-window counter of every frame a connection sends, including
    the ones it drops -- otherwise a flood of dropped frames would never
    count toward the disconnect threshold.
    """

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._recent: deque[float] = deque()

    def check(self) -> str:
        """Records one frame and returns "ok", "drop", or "flood"."""
        now = self._clock()
        while self._recent and now - self._recent[0] >= SEND_WINDOW_SECONDS:
            self._recent.popleft()
        self._recent.append(now)

        count = len(self._recent)
        if count <= SEND_LIMIT:
            return "ok"
        if count > SEND_LIMIT * FLOOD_MULTIPLIER:
            return "flood"
        return "drop"


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


def parse_frame(raw: str | None) -> dict:
    """The frame's JSON object, or {} for anything else. Malformed frames are
    skipped rather than raised -- an uncaught error here would drop the
    sender's connection over one bad frame.
    """
    try:
        data = json.loads(raw or "")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def message_content(data: dict) -> str | None:
    """The message text to store, or None if there's nothing to store."""
    content = data.get("content")
    if not isinstance(content, str):
        return None
    content = content.strip()
    if not content or len(content) > MAX_MESSAGE_LENGTH:
        return None
    return content


def auth_token(data: dict) -> str | None:
    """The token from an auth frame: {"type": "auth", "token": ...}."""
    token = data.get("token")
    return token if data.get("type") == "auth" and isinstance(token, str) else None


async def run_db(session_factory: sessionmaker, work):
    """Runs work(db) in its own short session, off the event loop. A socket
    stays open for hours, so it must never hold a session (and a pooled
    connection) while it waits; and a blocking database call on the event
    loop would stall every other socket and request.
    """

    def run():
        with session_factory() as db:
            return work(db)

    return await run_in_threadpool(run)


def save_message(db: Session, room_id: int, user_id: int, content: str) -> tuple[int, datetime]:
    """Returns the new message's id and created_at, read after the INSERT
    and before the commit expires them, so nothing is fetched back."""
    message = Message(room_id=room_id, user_id=user_id, content=content)
    db.add(message)
    db.flush()
    saved = (message.id, message.created_at)
    db.commit()
    return saved


# Browsers can't put an Authorization header on a WebSocket, so the Clerk
# session token arrives as a message instead: {"type":"auth","token":...},
# first thing after connecting and then every 40 seconds from the page.
# (Not in the URL: URLs end up in logs.)
AUTH_TIMEOUT_SECONDS = 5.0

# How long past its token's expiry an open socket waits for a fresher one
# before closing ("session-expired"). Generous because a background tab may
# only run the page's timers once a minute; a signed-out or banned student
# can't get new tokens, so they still lose the socket within two minutes.
TOKEN_GRACE_SECONDS = 60


async def authenticate(websocket: WebSocket, session_factory: sessionmaker) -> tuple[User, dict] | None:
    """The user and token claims from the socket's first frame, or None."""
    try:
        frame = await asyncio.wait_for(websocket.receive(), timeout=AUTH_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return None
    token = auth_token(parse_frame(frame.get("text")))
    claims = session_claims(token) if token else None
    if claims is None:
        return None
    # The row's columns stay readable after its session closes.
    user = await run_db(session_factory, lambda db: db.query(User).filter(User.clerk_user_id == claims["sub"]).first())
    return (user, claims) if user else None


async def refuse(websocket: WebSocket, reason: str) -> None:
    """Closes an accepted socket with a reason the frontend can act on
    (e.g. "gate-closed:<tz>" shows the closed screen)."""
    try:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=reason)
    except RuntimeError:
        pass  # the client already went away


@router.websocket("/ws/rooms/{room_id}")
async def room_chat(
    websocket: WebSocket,
    room_id: int,
    skip_gate: str | None = None,
    session_factory: sessionmaker = Depends(get_session_factory),
):
    if not origin_allowed(websocket):
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Origin not allowed")

    # Accepted first so every refusal below is a close frame with a reason the
    # browser can read, rather than a bare failed handshake.
    await websocket.accept()

    signed_in = await authenticate(websocket, session_factory)
    if signed_in is None:
        await refuse(websocket, "unauthorized")
        return
    user, claims = signed_in

    if not await run_db(session_factory, lambda db: db.get(Room, room_id) is not None):
        await refuse(websocket, "Room not found")
        return

    # The canary token comes in a header, never the URL: URLs end up in
    # proxy and server logs. (The dev-only skip_gate stays a query param --
    # browsers can't set headers on a WebSocket, and it's inert outside dev.)
    canary_token = websocket.headers.get("x-canary-token")
    user_tz = user.timezone or gate.FALLBACK_TIMEZONE
    gate_closes_at = math.inf  # beta and the dev and canary bypasses never close
    if not (gate.always_open() or gate.dev_bypass_active(skip_gate) or gate.canary_bypass_active(canary_token)):
        if not gate.is_night_in_timezone(user_tz):
            await refuse(websocket, f"gate-closed:{user_tz}")
            return
        gate_closes_at = gate.night_ends_at(user_tz).timestamp()

    manager.connect(room_id, websocket)
    limiter = SendLimiter()
    # Whatever ends this loop -- a normal disconnect or an unexpected error --
    # the connection must come out of the room's broadcast list. A dead socket
    # left behind would make every later broadcast in the room fail.
    try:
        while True:
            # Checked again while the socket stays open: it's closed when its
            # night ends, or when its token runs out without a fresher one.
            deadline = min(gate_closes_at, claims["exp"] + TOKEN_GRACE_SECONDS)
            try:
                frame = await asyncio.wait_for(websocket.receive(), timeout=deadline - time.time())
            except asyncio.TimeoutError:
                await refuse(websocket, f"gate-closed:{user_tz}" if deadline == gate_closes_at else "session-expired")
                break
            if frame["type"] == "websocket.disconnect":
                break

            verdict = limiter.check()
            if verdict == "flood":
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="rate-limited")
                break
            if verdict == "drop":
                continue

            data = parse_frame(frame.get("text"))
            token = auth_token(data)
            if token is not None:
                # A fresh token for the same account keeps the socket open;
                # one that fails (or is someone else's) ends it.
                claims = session_claims(token)
                if claims is None or claims["sub"] != user.clerk_user_id:
                    await refuse(websocket, "unauthorized")
                    break
                continue

            content = message_content(data)
            if content is None:
                continue

            message_id, created_at = await run_db(
                session_factory, lambda db: save_message(db, room_id, user.id, content)
            )

            await manager.broadcast(
                room_id,
                {
                    "id": message_id,
                    "room_id": room_id,
                    "user_id": user.id,
                    "display_name": user.display_name,
                    "avatar_url": user.avatar_url,
                    "content": content,
                    "created_at": created_at.isoformat(),
                },
            )
    finally:
        manager.disconnect(room_id, websocket)
