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
fast-loading retro 8-bit/arcade-style UI with two dark themes, Night and Lamp.

## How it fits together

In production:

```
Browser ──> Vercel     the pages (frontend/, built into static files)
Browser ──> backend/   Python (FastAPI) on Railway, called directly:
                       accounts, night gate, rooms, chat WebSockets
                         └──> PostgreSQL
```

Locally, one more layer sits in front so pages and API share one address:

```
Browser ──> Vite ──> web/  Ruby (Sinatra on Falcon): serves the pages, carries
                           /api (HTTP + chat WebSockets) through
                             └──> backend/ ──> PostgreSQL
```

- **`frontend/`** — the pages (vanilla JS + Vite), built into static files.
- **`web/`** — local development entry point, and the path CI's end-to-end
  test takes. No business logic; not deployed (it can be — see
  [web/README.md](web/README.md)).
- **`backend/`** — all the rules and data.
- **[Clerk](https://clerk.com)** — accounts: sign-up, sign-in, the emailed
  code that proves a student owns their address, Google sign-in, and
  password resets. nightcord never stores a password.

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
                             # add your Clerk keys (see "Clerk setup")
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

`ENVIRONMENT` defaults to `production` when unset, so a deploy that forgets it
still gets HSTS, no dev gate bypass, and no public `/docs`.
`.env.example` sets `development` for local work — keep that locally, and set
`ENVIRONMENT=production` explicitly on Railway.

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

Clerk proves the student owns the address; nightcord then decides whether
the address belongs to a college (`app/auth.py`, `app/campus_time.py`):

1. **Known school** — the domain (or a parent of it, e.g.
   `cs.harvard.edu` → `harvard.edu`) is looked up in
   `app/data/school_domains.json`: every school website in the NCES IPEDS
   directory of US institutions (~4,900 domains), mapped to its institution
   IDs. A match is admitted whatever the domain ends in — about a fifth of US
   institutions (mostly smaller trade, religious and arts schools) use
   `.org`, `.com`, `.us` and so on. Free hosting platforms and K-12 district
   domains are left out of the list. Regenerate it with
   `python scripts/build_school_domains.py`.
2. **Unknown `.edu`** — a `.edu` domain that isn't in the list (a real but
   newer/smaller school the snapshot missed) is admitted if a live DNS lookup
   confirms it can receive mail. Fails closed: any lookup problem
   (nonexistent domain, no mail servers, timeout) rejects the signup.

Any other domain is rejected. Note that a school that uses a larger
organization's domain (e.g. a hospital-run nursing school) admits that
organization's addresses too. International schools aren't covered — the
NCES directory and campus-time are US-only.

### Clerk setup

nightcord uses a Clerk **development** instance until it has its own domain
(Clerk production instances require one).

1. In the [Clerk dashboard](https://dashboard.clerk.com), create an
   application with **Email** (password + email verification code) and
   **Google** sign-in.
2. Settings worth turning on: minimum password length 12, reject compromised
   passwords, block disposable email addresses and `+` subaddresses.
3. From **API keys**, put the keys in the local `.env` files:
   - `backend/.env`: `CLERK_SECRET_KEY` (Secret key) and `CLERK_JWT_KEY` (the
     JWKS public key, PEM — written on one line with `\n` for line breaks)
   - `frontend/.env`: `VITE_CLERK_PUBLISHABLE_KEY` (Publishable key)
4. For the canary: create a user for it in the dashboard, run
   `scripts/seed_canary.py` with `CANARY_CLERK_USER_ID=<its id>`, and add
   `CLERK_SECRET_KEY` and `CANARY_CLERK_USER_ID` to the GitHub secrets.

`.edu`-only access is enforced by nightcord itself (`POST /auth/session`),
not Clerk's allowlist, which is a paid feature in production.

### Endpoints

Signed-in requests carry `Authorization: Bearer <Clerk session token>`. The
tokens are short-lived (about a minute; the frontend refreshes them), signed
by Clerk, and verified here with the Clerk instance's public key — so there's
no session cookie, and ordinary requests never call Clerk.

- `POST /auth/session` — after each Clerk sign-in: checks the email is a
  verified student address (and deletes the Clerk user if not), then links or
  creates the nightcord account and returns it. An account that predates Clerk
  is linked by its email, keeping its name, timezone and messages.
- `POST /auth/logout-all` — ends every Clerk session for the account, on every
  device (signing out of one browser happens in Clerk on the frontend)
- `GET /rooms` / `POST /rooms` — list / create chat rooms (auth + night gate)
- `GET /rooms/{room_id}/messages` — chat history for a room, with author names (auth + night gate)
- `WS /ws/rooms/{room_id}` — realtime chat over WebSocket. The first message must be
  `{"type": "auth", "token": "<Clerk session token>"}` (browsers can't set
  headers on WebSockets), and the page sends the current token again every 40
  seconds. The socket closes with a reason the page acts on: `unauthorized`,
  `gate-closed:<timezone>` (also at 6am while connected), or `session-expired`
  (no fresher token within a minute of the last one expiring)
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

Rooms are an open lounge by design: during night hours, every verified
student can see every room, read its history, and join its chat. There are
no private rooms.

When the gate is closed, the 403 response includes the student's school
timezone. That's deliberate: the frontend needs it for the "opens in"
countdown, and it only ever goes to the signed-in student it belongs to.

Chat also limits each connection to 5 messages per 5 seconds; extra messages
are dropped, and a connection that keeps flooding is disconnected. History
loads 50 messages at a time (`GET /rooms/{id}/messages?before=<id>`), and room
creation is limited to 10 per hour per student.

campus-time can't yet search by email domain, so the domain → institution
step uses the bundled `school_domains.json` above. Once it can, that file and
its build script can go.

### Testing

```bash
pip install -r requirements-dev.txt
pytest
```

Tests run against an isolated in-memory SQLite database (never the real
Postgres database), sign their own session tokens with a throwaway key, and
fake Clerk's Backend API, DNS lookups and campus-time, so the suite needs no
external services or `.env` file. Set `TEST_DATABASE_URL` to run the same suite against real Postgres
(CI does both).

## Frontend

Stack: vanilla HTML/CSS/JS + Vite, no framework — self-hosted retro pixel
fonts, Night and Lamp themes, and a "closed" screen with a countdown whenever the
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

### Cookies, consent and legal pages

- **Cookie banner** (`src/consentBanner.js`): shown until a visitor chooses.
  *Essential* (sign-in, bot protection, session info) is always on;
  *Preferences* (remembering the theme) and *Diagnostics* (Sentry crash
  reports) are off until they agree. Sentry isn't even downloaded without
  consent. "Cookie settings" in every page's footer reopens the choices.
- **Consent log**: signed-in students' choices are also recorded on the
  backend (`POST /consent`, table `consent_records`, one row per choice).
- **Keep the pages honest**: the cookie table in `privacy.html`, the
  categories in `consentBanner.js`, and the storage the code actually uses
  must match. When the cookie section changes, bump `CONSENT_VERSION` in
  `src/consent.js` so everyone is asked again.
- **Legal pages** (`terms.html`, `privacy.html`) are **drafts** with
  `[PLACEHOLDERS]` — have them reviewed by a lawyer before launch. Clerk's
  sign-up "I agree" checkbox is turned on in the Clerk dashboard and links to
  them.

### Testing

```bash
npm test
```

Unit tests (Vitest + jsdom) cover the night-time gate logic, theme
persistence, and the API client — the parts of the frontend that are pure
logic rather than DOM wiring.
