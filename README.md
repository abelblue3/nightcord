# nightcord

A chat and video room platform exclusively for college students.

Nightcord is built for night owls — students who study late and want the
company of others doing the same. Access is restricted to nighttime hours
(based on the user's timezone), creating a comfortable, low-pressure space
to study alongside fellow college students without the daytime crowd.

- **College students only** — verified student access
- **Night-only** — rooms are only open during nighttime hours, gated by timezone
- **Chat & video** — pick text or face-to-face company while you study

## Status

Backend-first build. Frontend will be a lightweight, fast-loading retro
8-bit/arcade-style UI, light mode only for now.

## Backend

Stack: **Python + FastAPI**, **PostgreSQL** (SQLAlchemy), native FastAPI
WebSockets for realtime chat, JWT auth, `.edu`-restricted signup.

### Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt
copy .env.example .env      # then edit DATABASE_URL / SECRET_KEY
```

Make sure a PostgreSQL database matching `DATABASE_URL` exists, then apply
migrations:

```bash
alembic upgrade head
```

Then run the server:

```bash
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000` (docs at `/docs`).

### Database migrations

Schema changes are managed with **Alembic** — the app no longer auto-creates
tables on startup, so a fresh database must be migrated before first use
(`alembic upgrade head`, above).

When you change a model in `app/models.py`:

```bash
alembic revision --autogenerate -m "describe the change"
```

Review the generated file in `alembic/versions/` (autogenerate doesn't
always get everything right — e.g. it can miss renames), then apply it:

```bash
alembic upgrade head
```

Other useful commands: `alembic current` (what revision the DB is on),
`alembic check` (confirms models match the DB with no pending changes),
`alembic downgrade -1` (roll back one migration).

### Endpoints

- `POST /auth/signup` — create account (requires an allowed student email domain, see `ALLOWED_EMAIL_DOMAINS`)
- `POST /auth/login` — get a JWT access token
- `GET /rooms` / `POST /rooms` — list / create chat rooms (auth required)
- `GET /rooms/{room_id}/messages` — chat history for a room (auth required)
- `WS /ws/rooms/{room_id}?token=<jwt>` — realtime chat over WebSocket
- `GET /health` — health check
