# nightcord web layer

A small Ruby service (Sinatra on Falcon) that sits between the browser and
the FastAPI backend. It:

- serves the built frontend pages (`frontend/dist`) with their security headers,
- forwards every `/api/...` request to FastAPI (dropping the `/api` prefix),
- relays chat WebSockets (`/api/ws/...`) to FastAPI frame for frame, and
- logs one line per request (method, path, status, time — never query
  strings, bodies, or cookies).

Pages and API share one domain. There is no business logic here: sign-in
(Clerk session tokens), the night gate, and all data stay in FastAPI.

## What passes through

| Browser → web layer | → FastAPI | Request carries | Response carries |
|---|---|---|---|
| `GET /`, `/index.html`, `/rooms.html`, `/room.html`, `/assets/*` | — (served here) | — | HTML/JS/CSS + security headers |
| `POST /api/auth/session` | `/auth/session` | token + `{timezone}` | `{id, email, display_name, timezone}`; 401/403 (not a verified student email)/429/502 |
| `POST /api/auth/logout-all` | `/auth/logout-all` | token | `{message}` |
| `GET /api/rooms` | `/rooms` | token | `[{id, name, created_by, created_at}]` or `403 {detail: {message, timezone}}` |
| `POST /api/rooms` | `/rooms` | token + `{name}` | room object; 409/429 |
| `GET /api/rooms/:id/messages?before=` | `/rooms/:id/messages` | token | up to 50 `[{id, room_id, user_id, display_name, content, created_at}]`, oldest first |
| `WS /api/ws/rooms/:id` | `/ws/rooms/:id` | first frame `{type: "auth", token}`, then `{content}` frames and a fresh auth frame every 40 s | server frames `{id, room_id, user_id, display_name, content, created_at}`; FastAPI's close code and reason passed on unchanged |
| `GET /api/health` | `/health` | — | `{status: "ok"}` |
| `GET /healthz` | — (answered here) | — | `{status: "ok"}` |

"token" above is `Authorization: Bearer <Clerk session token>`.

**Forwarded to FastAPI:** `Content-Type`, `Accept`, `Authorization`,
`X-Dev-Skip-Gate`, `X-Canary-Token`, plus `X-Forwarded-For` set to the real
client IP (FastAPI rate-limits per IP). Nothing else — in particular not
`Origin` or `Cookie`.

**Returned to the browser:** status, body, `Content-Type`, every
`Set-Cookie`, `Retry-After`, `Cache-Control`.

**When FastAPI can't be reached:** `502 {"detail": "Service unavailable."}`
(the same shape as FastAPI's own errors, so the frontend shows it as-is).

**WebSockets from other websites** are refused (403) by checking `Origin`
against `ALLOWED_ORIGINS`. Requests with no `Origin` (non-browser clients
such as the canary) are allowed through to FastAPI's session check.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `BACKEND_URL` | `http://localhost:8000` | Where FastAPI is. On Railway: its private-network address. |
| `PUBLIC_HOST` | — | This service's public hostname, e.g. `nightcord.up.railway.app`. Allowed as a WebSocket origin and added to the CSP. |
| `ALLOWED_ORIGINS` | `http://localhost:4567,http://localhost:5173` | Extra origins allowed to open chat sockets (comma-separated). |
| `ENVIRONMENT` | `production` | Set `development` locally; anything else turns on HSTS. |
| `CLERK_FRONTEND_API` | `*.clerk.accounts.dev` | The Clerk instance's Frontend API host, allowed in the CSP. Set it to the production instance's host (e.g. `clerk.<your-domain>`) at go-live. |
| `DIST_DIR` | `../frontend/dist` | The built pages (the Docker image sets `/app/public`). |
| `PORT` / `BIND` | `4567` / `0.0.0.0` | Where to listen. |

For the Docker build, `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_SENTRY_DSN` are
passed to the frontend build. `VITE_API_URL` / `VITE_WS_URL` are deliberately
left unset so the pages call `/api` on their own site.

## Running locally

Needs Ruby 3.3. On Windows, use RubyInstaller's "Ruby+Devkit 3.3".

```bash
cd web
bundle install
bundle exec rake test               # unit + real-socket relay tests
bundle exec ruby bin/server.rb      # http://localhost:4567
```

Local development runs three processes:

1. FastAPI — `cd backend && uvicorn app.main:app --reload` (port 8000)
2. this layer — `cd web && bundle exec ruby bin/server.rb` (port 4567)
3. Vite — `cd frontend && npm run dev` (port 5173), which forwards `/api`
   to this layer, so hot reload keeps working

Open http://localhost:5173. Leave `VITE_API_URL` / `VITE_WS_URL` unset in
`frontend/.env`, or the pages will skip this layer and call FastAPI directly.

`bin/server.rb` is used instead of `falcon serve` because the latter's
process supervisor needs Unix-only signals; the launcher runs the same server
on Windows and Linux.

## Deploying (Railway)

Not deployed today: production serves the pages from Vercel, and the browser
calls the FastAPI service on Railway directly. This layer is the local
development entry point, and CI's end-to-end test runs through it.

To deploy it later instead: a separate Railway service built from the **repo
root** with `web/Dockerfile`. Point the service's config-as-code path at
`web/railway.json`.
