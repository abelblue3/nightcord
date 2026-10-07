// Synthetic monitoring: periodically exercises the real, deployed nightcord
// app end-to-end (frontend load, backend health, sign-in, rooms, live chat)
// using a dedicated canary account. Exits non-zero on any failure, which
// GitHub Actions surfaces as a failed scheduled run (and emails on failure
// by default).
//
// Sign-in: the canary is a Clerk user like everyone else. Its session token
// comes from one of two places:
//   - CLERK_SECRET_KEY (production): Clerk's Backend API creates a session
//     for CANARY_CLERK_USER_ID and a session token for it.
//   - CANARY_TEST_PRIVATE_KEY (CI only): the token is signed locally with a
//     throwaway key whose public half the CI backend was given.
import { createSign } from 'node:crypto';
import WebSocket from 'ws';

const FRONTEND_URL = process.env.CANARY_FRONTEND_URL || 'https://nightcord-gamma.vercel.app';
const API_URL = process.env.CANARY_API_URL || 'https://nightcord-production.up.railway.app';
const WS_URL = API_URL.replace(/^http/, 'ws');
const CLERK_API_URL = process.env.CLERK_API_URL || 'https://api.clerk.com/v1';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const TEST_PRIVATE_KEY = process.env.CANARY_TEST_PRIVATE_KEY;
const CLERK_USER_ID = process.env.CANARY_CLERK_USER_ID;
const CANARY_TOKEN = process.env.CANARY_BYPASS_TOKEN;
const ROOM_NAME = 'canary-room';

if (!CLERK_USER_ID || !(CLERK_SECRET_KEY || TEST_PRIVATE_KEY)) {
  console.error('Set CANARY_CLERK_USER_ID, plus CLERK_SECRET_KEY (or CANARY_TEST_PRIVATE_KEY in CI).');
  process.exit(1);
}
if (!CANARY_TOKEN) {
  console.error('CANARY_BYPASS_TOKEN is not set -- the canary account has no resolved timezone and will be blocked by the night gate without it.');
  process.exit(1);
}

function step(name) {
  console.log(`--- ${name} ---`);
}

// CI only: a token shaped like Clerk's, signed with the throwaway key.
function signTestToken(privateKeyPem, sub) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ sub, sid: `sess_${sub}`, iat: now, nbf: now, exp: now + 60 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function clerkApi(path, options = {}) {
  const res = await fetch(`${CLERK_API_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Clerk ${options.method || 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Returns { token, cleanup }; cleanup ends the Clerk session afterwards so
// canary runs don't pile up sessions.
async function getSessionToken() {
  if (TEST_PRIVATE_KEY) {
    return { token: signTestToken(TEST_PRIVATE_KEY, CLERK_USER_ID), cleanup: async () => {} };
  }
  const session = await clerkApi('/sessions', { method: 'POST', body: JSON.stringify({ user_id: CLERK_USER_ID }) });
  const { jwt } = await clerkApi(`/sessions/${session.id}/tokens`, { method: 'POST' });
  return {
    token: jwt,
    cleanup: () => clerkApi(`/sessions/${session.id}/revoke`, { method: 'POST' }).catch(() => {}),
  };
}

async function main() {
  step('frontend loads');
  const frontendRes = await fetch(`${FRONTEND_URL}/index.html`);
  if (!frontendRes.ok) throw new Error(`frontend returned ${frontendRes.status}`);
  console.log('OK');

  step('backend health');
  const healthRes = await fetch(`${API_URL}/health`);
  const health = await healthRes.json();
  if (!healthRes.ok || health.status !== 'ok') throw new Error(`health check failed: ${JSON.stringify(health)}`);
  console.log('OK');

  step('sign in (Clerk session token)');
  const { token, cleanup } = await getSessionToken();
  console.log('OK');

  try {
    step('list rooms, find canary-room');
    const roomsRes = await fetch(`${API_URL}/rooms`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Canary-Token': CANARY_TOKEN },
    });
    if (!roomsRes.ok) throw new Error(`list rooms failed: ${roomsRes.status} ${await roomsRes.text()}`);
    const rooms = await roomsRes.json();
    const room = rooms.find((r) => r.name === ROOM_NAME);
    if (!room) throw new Error(`${ROOM_NAME} not found in rooms list`);
    console.log(`OK (room id ${room.id})`);

    step('live chat round trip over WebSocket');
    const nonce = `canary-${Date.now()}`;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('timed out waiting for chat message echo'));
      }, 10_000);

      // The bypass token goes in a header, never the URL (URLs end up in logs).
      const ws = new WebSocket(`${WS_URL}/ws/rooms/${room.id}`, {
        headers: { 'X-Canary-Token': CANARY_TOKEN },
      });

      ws.on('open', () => {
        // Chat signs in with its first message.
        ws.send(JSON.stringify({ type: 'auth', token }));
        ws.send(JSON.stringify({ content: nonce }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.content === nonce) {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });

      ws.on('close', (code, reason) => {
        if (code === 1008) {
          clearTimeout(timeout);
          reject(new Error(`chat refused the connection: ${reason}`));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    console.log('OK');
  } finally {
    await cleanup();
  }

  console.log('\nAll canary checks passed.');
}

main().catch((err) => {
  console.error('\nCANARY FAILED:', err.message);
  process.exit(1);
});
