from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[int, list[WebSocket]] = {}

    def connect(self, room_id: int, websocket: WebSocket) -> None:
        """Adds an already-accepted socket to the room's broadcast list."""
        self.active_connections.setdefault(room_id, []).append(websocket)

    def disconnect(self, room_id: int, websocket: WebSocket) -> None:
        connections = self.active_connections.get(room_id)
        if not connections:
            return
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            self.active_connections.pop(room_id, None)

    async def broadcast(self, room_id: int, message: dict) -> None:
        # Iterate over a copy: a failed send removes that connection mid-loop.
        for connection in list(self.active_connections.get(room_id, [])):
            try:
                await connection.send_json(message)
            except Exception:
                # A peer that went away before its own handler cleaned up
                # must not take down the sender's connection -- drop it and
                # keep delivering to everyone else in the room.
                self.disconnect(room_id, connection)


manager = ConnectionManager()
