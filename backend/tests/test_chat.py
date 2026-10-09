import time
from datetime import datetime, timedelta, timezone

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import make_token


@pytest.fixture()
def logged_in_user(client, sign_in):
    signed_in = sign_in("chatuser@university.edu", first_name="Chat User")
    room = client.post("/rooms", json={"name": "chat-test-room"}).json()
    return {"room_id": room["id"], "clerk_user_id": signed_in.clerk_user_id}


def _closed_reason(ws):
    with pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_json()
    assert closed.value.code == 1008
    return closed.value.reason


def test_websocket_rejects_an_invalid_token(client, room_socket):
    with room_socket(1, token="not-a-real-token") as ws:
        assert _closed_reason(ws) == "unauthorized"


def test_websocket_rejects_an_expired_token(client, logged_in_user, room_socket):
    expired = make_token(logged_in_user["clerk_user_id"], expires_in=-60)
    with room_socket(logged_in_user["room_id"], token=expired) as ws:
        assert _closed_reason(ws) == "unauthorized"


def test_websocket_requires_the_auth_frame_first(client, logged_in_user, room_socket):
    with client.websocket_connect(f"/ws/rooms/{logged_in_user['room_id']}") as ws:
        ws.send_json({"content": "hi, skipping the login"})
        assert _closed_reason(ws) == "unauthorized"


def test_websocket_gives_up_waiting_for_the_auth_frame(client, logged_in_user, monkeypatch):
    monkeypatch.setattr("app.routers.chat.AUTH_TIMEOUT_SECONDS", 0.1)
    with client.websocket_connect(f"/ws/rooms/{logged_in_user['room_id']}") as ws:
        assert _closed_reason(ws) == "unauthorized"


def test_websocket_rejects_missing_room(client, logged_in_user, room_socket):
    with room_socket(999999) as ws:
        assert _closed_reason(ws) == "Room not found"


def test_websocket_send_and_receive_broadcast(client, logged_in_user, room_socket):
    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as ws:
        ws.send_json({"content": "hey, anyone up for calc?"})
        received = ws.receive_json()

    assert received["content"] == "hey, anyone up for calc?"
    assert received["room_id"] == room_id
    assert received["display_name"] == "Chat User"
    assert "id" in received and "created_at" in received


def test_websocket_ignores_blank_messages(client, logged_in_user, room_socket):
    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as ws:
        ws.send_json({"content": "   "})
        ws.send_json({"content": "real message"})
        received = ws.receive_json()

    # The blank message should have been skipped, so the first thing
    # broadcast back is the real one.
    assert received["content"] == "real message"


def test_websocket_message_is_persisted(client, logged_in_user, room_socket):
    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as ws:
        ws.send_json({"content": "persisted message"})
        ws.receive_json()

    history = client.get(f"/rooms/{room_id}/messages").json()
    assert any(m["content"] == "persisted message" for m in history)


def test_websocket_survives_malformed_frames(client, logged_in_user, room_socket):
    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as ws:
        # Each of these used to be an uncaught error that dropped the sender
        # and left a dead socket registered in the room.
        ws.send_text("not json at all")
        ws.send_json(["a", "list"])
        ws.send_json({"content": 42})
        ws.send_bytes(b"\x00\x01")
        ws.send_json({"content": "still connected"})
        received = ws.receive_json()

    assert received["content"] == "still connected"


def test_room_keeps_working_after_a_client_leaves(client, logged_in_user, room_socket):
    from app.connection_manager import manager

    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as first:
        first.send_text("not json")
        first.send_json({"content": "hello"})
        first.receive_json()

    assert not manager.active_connections.get(room_id)

    with room_socket(room_id) as second:
        second.send_json({"content": "anyone still here?"})
        assert second.receive_json()["content"] == "anyone still here?"


def test_websocket_ignores_over_long_messages(client, logged_in_user, room_socket):
    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as ws:
        ws.send_json({"content": "x" * 2001})
        ws.send_json({"content": "y" * 2000})
        received = ws.receive_json()

    # The 2001-char message was dropped; exactly 2000 is still allowed.
    assert received["content"] == "y" * 2000


def test_websocket_rejects_disallowed_origin(client, logged_in_user, room_socket):
    room_id = logged_in_user["room_id"]

    with pytest.raises(WebSocketDisconnect):
        with room_socket(room_id, headers={"Origin": "https://evil.example"}):
            pass


def test_websocket_accepts_allowed_origin(client, logged_in_user, room_socket):
    from app.config import settings

    room_id = logged_in_user["room_id"]

    with room_socket(room_id, headers={"Origin": settings.cors_origin_list[0]}) as ws:
        ws.send_json({"content": "from the real frontend"})
        assert ws.receive_json()["content"] == "from the real frontend"


def test_idle_socket_holds_no_database_session(client, logged_in_user, room_socket, db_session):
    from contextlib import contextmanager

    from app.database import get_session_factory
    from app.main import app

    sessions = {"opened": 0, "open_now": 0}

    @contextmanager
    def counting_session():
        sessions["opened"] += 1
        sessions["open_now"] += 1
        try:
            yield db_session
        finally:
            sessions["open_now"] -= 1

    app.dependency_overrides[get_session_factory] = lambda: counting_session

    with room_socket(logged_in_user["room_id"]) as ws:
        ws.send_json({"content": "hello"})
        ws.receive_json()
        # Sign-in, room check and the message each used a session, and none
        # is still open while the socket waits for more.
        assert sessions == {"opened": 3, "open_now": 0}


def test_history_includes_author_display_name(client, logged_in_user, room_socket):
    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as ws:
        ws.send_json({"content": "who said this?"})
        ws.receive_json()

    history = client.get(f"/rooms/{room_id}/messages").json()
    assert history[-1]["display_name"] == "Chat User"


# --- open sockets are re-checked ---


def test_socket_outlives_its_token_by_the_grace_period(client, logged_in_user, room_socket):
    # A background tab may only send its next token a minute later.
    short_lived = make_token(logged_in_user["clerk_user_id"], expires_in=1)

    with room_socket(logged_in_user["room_id"], token=short_lived) as ws:
        time.sleep(1.1)  # past the token's expiry
        ws.send_json({"content": "still here"})
        assert ws.receive_json()["content"] == "still here"


def test_fresh_token_keeps_the_socket_open(client, logged_in_user, room_socket, monkeypatch):
    monkeypatch.setattr("app.routers.chat.TOKEN_GRACE_SECONDS", 0)
    # exp is whole seconds, so expires_in=2 leaves at least a second for the
    # fresh token to arrive (1 could leave only milliseconds).
    short_lived = make_token(logged_in_user["clerk_user_id"], expires_in=2)

    with room_socket(logged_in_user["room_id"], token=short_lived) as ws:
        ws.send_json({"type": "auth", "token": make_token(logged_in_user["clerk_user_id"])})
        time.sleep(2.1)  # past the first token's expiry
        ws.send_json({"content": "still here"})
        assert ws.receive_json()["content"] == "still here"


def test_socket_closes_when_its_token_runs_out(client, logged_in_user, room_socket, monkeypatch):
    monkeypatch.setattr("app.routers.chat.TOKEN_GRACE_SECONDS", 0)
    short_lived = make_token(logged_in_user["clerk_user_id"], expires_in=1)

    with room_socket(logged_in_user["room_id"], token=short_lived) as ws:
        assert _closed_reason(ws) == "session-expired"


def test_another_accounts_token_closes_the_socket(client, logged_in_user, room_socket):
    with room_socket(logged_in_user["room_id"]) as ws:
        ws.send_json({"type": "auth", "token": make_token("user_someone_else")})
        assert _closed_reason(ws) == "unauthorized"


def test_socket_closes_when_the_night_ends(client, logged_in_user, room_socket, monkeypatch):
    soon = datetime.now(timezone.utc) + timedelta(seconds=0.3)
    monkeypatch.setattr("app.gate.night_ends_at", lambda tz_name, now=None: soon)

    with room_socket(logged_in_user["room_id"]) as ws:
        assert _closed_reason(ws).startswith("gate-closed:")


# --- per-connection send limit ---


def test_send_limiter_allows_a_burst_then_drops_then_flags_a_flood():
    from app.routers.chat import FLOOD_MULTIPLIER, SEND_LIMIT, SEND_WINDOW_SECONDS, SendLimiter

    now = [0.0]
    limiter = SendLimiter(clock=lambda: now[0])

    verdicts = [limiter.check() for _ in range(SEND_LIMIT * FLOOD_MULTIPLIER + 1)]
    assert verdicts[:SEND_LIMIT] == ["ok"] * SEND_LIMIT
    assert set(verdicts[SEND_LIMIT:-1]) == {"drop"}
    assert verdicts[-1] == "flood"

    now[0] += SEND_WINDOW_SECONDS  # the window has fully passed
    assert limiter.check() == "ok"


def test_websocket_drops_messages_over_the_send_limit(client, logged_in_user, room_socket):
    from app.routers.chat import SEND_LIMIT

    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as ws:
        for n in range(SEND_LIMIT + 3):
            ws.send_json({"content": f"message {n}"})
        received = [ws.receive_json()["content"] for _ in range(SEND_LIMIT)]

    assert received == [f"message {n}" for n in range(SEND_LIMIT)]
    history = client.get(f"/rooms/{room_id}/messages").json()
    assert len(history) == SEND_LIMIT  # the extra ones never reached the database


def test_websocket_disconnects_a_flooding_client(client, logged_in_user, room_socket):
    from app.routers.chat import FLOOD_MULTIPLIER, SEND_LIMIT

    room_id = logged_in_user["room_id"]

    with room_socket(room_id) as ws:
        for n in range(SEND_LIMIT * FLOOD_MULTIPLIER + 1):
            ws.send_json({"content": f"spam {n}"})
        for _ in range(SEND_LIMIT):
            ws.receive_json()
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert closed.value.code == 1008
    assert closed.value.reason == "rate-limited"
