from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, room_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
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
        for connection in self.active_connections.get(room_id, []):
            await connection.send_json(message)


manager = ConnectionManager()
