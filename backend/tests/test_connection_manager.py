import asyncio

from app.connection_manager import ConnectionManager


class FakeWebSocket:
    def __init__(self):
        self.accepted = False
        self.sent = []

    async def accept(self):
        self.accepted = True

    async def send_json(self, message):
        self.sent.append(message)


def run(coro):
    return asyncio.run(coro)


def test_connect_accepts_and_tracks_connection():
    manager = ConnectionManager()
    ws = FakeWebSocket()

    run(manager.connect(room_id=1, websocket=ws))

    assert ws.accepted is True
    assert manager.active_connections[1] == [ws]


def test_broadcast_sends_to_all_connections_in_room():
    manager = ConnectionManager()
    ws1, ws2 = FakeWebSocket(), FakeWebSocket()
    run(manager.connect(room_id=1, websocket=ws1))
    run(manager.connect(room_id=1, websocket=ws2))

    run(manager.broadcast(1, {"content": "hey"}))

    assert ws1.sent == [{"content": "hey"}]
    assert ws2.sent == [{"content": "hey"}]


def test_broadcast_does_not_leak_across_rooms():
    manager = ConnectionManager()
    ws_room1, ws_room2 = FakeWebSocket(), FakeWebSocket()
    run(manager.connect(room_id=1, websocket=ws_room1))
    run(manager.connect(room_id=2, websocket=ws_room2))

    run(manager.broadcast(1, {"content": "only for room 1"}))

    assert ws_room1.sent == [{"content": "only for room 1"}]
    assert ws_room2.sent == []


def test_disconnect_removes_connection_and_cleans_up_empty_room():
    manager = ConnectionManager()
    ws = FakeWebSocket()
    run(manager.connect(room_id=1, websocket=ws))

    manager.disconnect(1, ws)

    assert 1 not in manager.active_connections


def test_disconnect_is_safe_when_room_never_connected():
    manager = ConnectionManager()
    # Should not raise even though room 42 has no connections.
    manager.disconnect(42, FakeWebSocket())
