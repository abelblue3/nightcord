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
copy .env.example .env      # DATABASE_URL already matches docker-compose.yml;
                             # set your own SECRET_KEY, and RESEND_API_KEY /
                             # GOOGLE_CLIENT_ID if you need those features working
```

You need a PostgreSQL database matching `DATABASE_URL` to exist. Easiest way
— run one locally with Docker (no account, no cloud resource to provision
per-developer):

```bash
docker compose up -d
```

This starts Postgres on `localhost:5432` with the exact user/password/db
name already in `.env.example`, so the default `DATABASE_URL` works as-is.
(No Docker? Point `DATABASE_URL` at any Postgres instance you have —
a native local install, or a cloud one.)

Then apply migrations:

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

### Student email validation

Beyond the `.edu` suffix check, signup validates the domain two more ways
(`app/auth.py`, `app/edu_domains.py`):

1. **Known institution check** — the domain (or a parent of it, e.g.
   `cs.harvard.edu` → `harvard.edu`) is looked up against
   `app/data/edu_domains.json`, ~2,400 real U.S. `.edu` domains vendored from
   [Hipo/university-domains-list](https://github.com/Hipo/university-domains-list).
   A match is trusted immediately — no network call.
2. **MX record fallback** — if the domain isn't in that list (a real but
   newer/smaller school our snapshot missed), we do a live DNS lookup to
   confirm it can actually receive mail. Fails closed: any lookup problem
   (nonexistent domain, no mail servers, timeout) rejects the signup.

### Endpoints

- `POST /auth/signup` — create account (requires an allowed, real-institution student email domain); sends a verification email, account is inactive until verified
- `POST /auth/login` — get a JWT access token (rejects unverified accounts)
- `POST /auth/verify-email` — activate an account from its emailed verification link, returns a JWT
- `POST /auth/resend-verification` — request a new verification link
- `POST /auth/google` — sign in/up via Google OAuth (`.edu`-restricted, auto-verified)
- `GET /rooms` / `POST /rooms` — list / create chat rooms (auth required)
- `GET /rooms/{room_id}/messages` — chat history for a room (auth required)
- `WS /ws/rooms/{room_id}?token=<jwt>` — realtime chat over WebSocket
- `GET /health` — health check

### Testing

```bash
pip install -r requirements-dev.txt
pytest
```

Tests run against an isolated in-memory SQLite database (never the real
Postgres database) and mock both the Resend email API and Google token
verification, so the suite needs no external services or `.env` file.

## Frontend

Stack: vanilla HTML/CSS/JS + Vite, no framework — self-hosted retro pixel
fonts, dark mode, and a client-side night-time gate.

### Setup

```bash
cd frontend
npm install
copy .env.example .env      # then edit VITE_API_URL / VITE_WS_URL if needed
npm run dev
```

### Testing

```bash
npm test
```

Unit tests (Vitest + jsdom) cover the night-time gate logic, theme
persistence, and the API client — the parts of the frontend that are pure
logic rather than DOM wiring.
