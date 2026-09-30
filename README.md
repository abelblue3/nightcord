# nightcord

A chat and video room platform exclusively for college students.

Nightcord is built for night owls — students who study late and want the
company of others doing the same. Access is restricted to nighttime hours
(based on the user's timezone), creating a comfortable, low-pressure space
to study alongside fellow college students without the daytime crowd.

- **College students only** — verified student access
- **Night-only** — rooms are only open during nighttime hours, gated by timezone
- **Chat & Video** — pick text or face-to-face company while you study

## Status

Text chat is live; video is not built yet. The frontend is a lightweight,
fast-loading retro 8-bit/arcade-style UI with light and dark modes.

## How it fits together

```
Browser ──> web/      Ruby (Sinatra on Falcon): serves the pages, carries /api
                      (HTTP + chat WebSockets) through, logs each request
              └──> backend/  Python (FastAPI): accounts, night gate, rooms, chat
                               └──> PostgreSQL
```

- **`frontend/`** — the pages (vanilla JS + Vite), built into static files.
- **`web/`** — the only thing the browser talks to. Everything is on one
  domain, so the session cookie is first-party. No business logic. See
  [web/README.md](web/README.md) for exactly what passes through it.
- **`backend/`** — all the rules and data.

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
                             # set your own SECRET_KEY, and GOOGLE_CLIENT_ID
                             # if you need Google sign-in working
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
(`app/auth.py`, `app/campus_time.py`):

1. **Known institution check** — the domain (or a parent of it, e.g.
   `cs.harvard.edu` → `harvard.edu`) is looked up in
   `app/data/school_domains.json`: every `.edu` website in the NCES IPEDS
   institution directory (~4,000), mapped to its institution IDs. A match is
   trusted immediately — no DNS lookup. Regenerate the file with
   `python scripts/build_school_domains.py`.
2. **MX record fallback** — if the domain isn't in that list (a real but
   newer/smaller school our snapshot missed), we do a live DNS lookup to
   confirm it can actually receive mail. Fails closed: any lookup problem
   (nonexistent domain, no mail servers, timeout) rejects the signup.

### Endpoints

Sessions live in an httpOnly `access_token` cookie set by the auth
endpoints — the frontend never sees the token itself.

- `POST /auth/signup` — create account (requires an allowed, real-institution student email domain; rejects breached passwords) and start a session
- `POST /auth/login` — start a session (locks the account after repeated failures)
- `POST /auth/google` — sign in/up via Google OAuth (`.edu`-restricted)
- `POST /auth/logout` — end this browser's session
- `POST /auth/logout-all` — end every session on every device
- `GET /rooms` / `POST /rooms` — list / create chat rooms (auth + night gate)
- `GET /rooms/{room_id}/messages` — chat history for a room, with author names (auth + night gate)
- `WS /ws/rooms/{room_id}` — realtime chat over WebSocket (session cookie + night gate)
- `GET /health` — health check

### Night gate

Rooms, history, and chat are only open 9pm–6am in the student's **school's**
timezone. This is enforced server-side in `app/gate.py` — the frontend only
uses it to show a countdown. Login and signup stay open around the clock.

The school's timezone comes from the
[campus-time API](https://campus-time.replit.app), asked once at signup
(`GET /api/locations/edge:<institution ID>/time`) and stored on the account;
the gate itself never calls it. If campus-time has no timezone for the school
(unknown, held back, a chain spanning timezones, or unreachable), signup
falls back to the browser's timezone, then UTC.

When the gate is closed, the 403 response includes the student's school
timezone. That's deliberate: the frontend needs it for the "opens in"
countdown, and it only ever goes to the signed-in student it belongs to.

Chat also limits each connection to 5 messages per 5 seconds; extra messages
are dropped, and a connection that keeps flooding is disconnected.

campus-time can't yet search by email domain, so the domain → institution
step uses the bundled `school_domains.json` above. Once it can, that file and
its build script can go.

### Testing

```bash
pip install -r requirements-dev.txt
pytest
```

Tests run against an isolated in-memory SQLite database (never the real
Postgres database) and fake DNS lookups, the Have I Been Pwned check, and
Google token verification, so the suite needs no external services or `.env`
file. Set `TEST_DATABASE_URL` to run the same suite against real Postgres
(CI does both).

## Frontend

Stack: vanilla HTML/CSS/JS + Vite, no framework — self-hosted retro pixel
fonts, dark mode, and a "closed" screen with a countdown whenever the
server-side night gate says rooms are shut.

### Setup

```bash
cd frontend
npm install
copy .env.example .env      # leave VITE_API_URL / VITE_WS_URL unset
npm run dev
```

`npm run dev` forwards `/api` to the Ruby web layer on port 4567, which
forwards it to FastAPI on port 8000 — so run both of those too (see
[web/README.md](web/README.md#running-locally)).

### Testing

```bash
npm test
```

Unit tests (Vitest + jsdom) cover the night-time gate logic, theme
persistence, and the API client — the parts of the frontend that are pure
logic rather than DOM wiring.
