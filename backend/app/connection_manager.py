from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[int, list[WebSocket]] = {}
        self.user_ids: dict[WebSocket, int] = {}  # whose socket it is

    def connect(self, room_id: int, websocket: WebSocket, user_id: int) -> None:
        """Adds an already-accepted socket to the room's broadcast list."""
        self.active_connections.setdefault(room_id, []).append(websocket)
        self.user_ids[websocket] = user_id

    def disconnect(self, room_id: int, websocket: WebSocket) -> None:
        self.user_ids.pop(websocket, None)
        connections = self.active_connections.get(room_id)
        if not connections:
            return
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            self.active_connections.pop(room_id, None)

    async def broadcast(self, room_id: int, message: dict, skip_user_ids: set[int] = frozenset()) -> None:
        """Sends to everyone in the room except the students in
        `skip_user_ids` (those who blocked the sender)."""
        # Iterate over a copy: a failed send removes that connection mid-loop.
        for connection in list(self.active_connections.get(room_id, [])):
            if self.user_ids.get(connection) in skip_user_ids:
                continue
            try:
                await connection.send_json(message)
            except Exception:
                # A peer that went away before its own handler cleaned up
                # must not take down the sender's connection -- drop it and
                # keep delivering to everyone else in the room.
                self.disconnect(room_id, connection)


manager = ConnectionManager()
