import pytest
from starlette.websockets import WebSocketDisconnect


@pytest.fixture()
def logged_in_user(client):
    client.post(
        "/auth/signup",
        json={"email": "chatuser@university.edu", "password": "correct-horse-battery", "display_name": "Chat User"},
    )

    # The client's cookie jar now carries the session -- no token/headers to
    # thread through manually.
    room = client.post("/rooms", json={"name": "chat-test-room"}).json()
    return {"room_id": room["id"]}


def test_websocket_rejects_invalid_session(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/rooms/1", cookies={"access_token": "not-a-real-token"}):
            pass


def test_websocket_rejects_missing_room(client, logged_in_user):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/rooms/999999"):
            pass


def test_websocket_send_and_receive_broadcast(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        ws.send_json({"content": "hey, anyone up for calc?"})
        received = ws.receive_json()

    assert received["content"] == "hey, anyone up for calc?"
    assert received["room_id"] == room_id
    assert received["display_name"] == "Chat User"
    assert "id" in received and "created_at" in received


def test_websocket_ignores_blank_messages(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        ws.send_json({"content": "   "})
        ws.send_json({"content": "real message"})
        received = ws.receive_json()

    # The blank message should have been skipped, so the first thing
    # broadcast back is the real one.
    assert received["content"] == "real message"


def test_websocket_message_is_persisted(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        ws.send_json({"content": "persisted message"})
        ws.receive_json()

    history = client.get(f"/rooms/{room_id}/messages").json()
    assert any(m["content"] == "persisted message" for m in history)


def test_websocket_rejects_after_token_revocation(client):
    client.post(
        "/auth/signup",
        json={"email": "revokews@university.edu", "password": "correct-horse-battery", "display_name": "Revoke Me"},
    )
    old_cookie = client.cookies["access_token"]
    room = client.post("/rooms", json={"name": "revoke-ws-room"}).json()

    client.post("/auth/logout-all")

    # A copy of the pre-revocation token (as if cached in another browser)
    # must be rejected too, not just the current client's now-cleared cookie.
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/rooms/{room['id']}", cookies={"access_token": old_cookie}):
            pass


def test_websocket_survives_malformed_frames(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        # Each of these used to be an uncaught error that dropped the sender
        # and left a dead socket registered in the room.
        ws.send_text("not json at all")
        ws.send_json(["a", "list"])
        ws.send_json({"content": 42})
        ws.send_bytes(b"\x00\x01")
        ws.send_json({"content": "still connected"})
        received = ws.receive_json()

    assert received["content"] == "still connected"


def test_room_keeps_working_after_a_client_leaves(client, logged_in_user):
    from app.connection_manager import manager

    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as first:
        first.send_text("not json")
        first.send_json({"content": "hello"})
        first.receive_json()

    assert not manager.active_connections.get(room_id)

    with client.websocket_connect(f"/ws/rooms/{room_id}") as second:
        second.send_json({"content": "anyone still here?"})
        assert second.receive_json()["content"] == "anyone still here?"


def test_websocket_ignores_over_long_messages(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        ws.send_json({"content": "x" * 2001})
        ws.send_json({"content": "y" * 2000})
        received = ws.receive_json()

    # The 2001-char message was dropped; exactly 2000 is still allowed.
    assert received["content"] == "y" * 2000


def test_websocket_rejects_disallowed_origin(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/rooms/{room_id}", headers={"Origin": "https://evil.example"}):
            pass


def test_websocket_accepts_allowed_origin(client, logged_in_user):
    from app.config import settings

    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}", headers={"Origin": settings.cors_origin_list[0]}) as ws:
        ws.send_json({"content": "from the real frontend"})
        assert ws.receive_json()["content"] == "from the real frontend"


def test_history_includes_author_display_name(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        ws.send_json({"content": "who said this?"})
        ws.receive_json()

    history = client.get(f"/rooms/{room_id}/messages").json()
    assert history[-1]["display_name"] == "Chat User"


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


def test_websocket_drops_messages_over_the_send_limit(client, logged_in_user):
    from app.routers.chat import SEND_LIMIT

    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        for n in range(SEND_LIMIT + 3):
            ws.send_json({"content": f"message {n}"})
        received = [ws.receive_json()["content"] for _ in range(SEND_LIMIT)]

    assert received == [f"message {n}" for n in range(SEND_LIMIT)]
    history = client.get(f"/rooms/{room_id}/messages").json()
    assert len(history) == SEND_LIMIT  # the extra ones never reached the database


def test_websocket_disconnects_a_flooding_client(client, logged_in_user):
    from app.routers.chat import FLOOD_MULTIPLIER, SEND_LIMIT

    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        for n in range(SEND_LIMIT * FLOOD_MULTIPLIER + 1):
            ws.send_json({"content": f"spam {n}"})
        for _ in range(SEND_LIMIT):
            ws.receive_json()
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert closed.value.code == 1008
    assert closed.value.reason == "rate-limited"
