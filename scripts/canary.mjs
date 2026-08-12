// Synthetic monitoring: periodically exercises the real, deployed nightcord
// app end-to-end (frontend load, backend health, login, rooms, live chat)
// using a dedicated canary account. Exits non-zero on any failure, which
// GitHub Actions surfaces as a failed scheduled run (and emails on failure
// by default).
import WebSocket from 'ws';

const FRONTEND_URL = process.env.CANARY_FRONTEND_URL || 'https://nightcord-gamma.vercel.app';
const API_URL = process.env.CANARY_API_URL || 'https://nightcord-production.up.railway.app';
const WS_URL = API_URL.replace(/^http/, 'ws');
const EMAIL = process.env.CANARY_EMAIL;
const PASSWORD = process.env.CANARY_PASSWORD;
const CANARY_TOKEN = process.env.CANARY_BYPASS_TOKEN;
const ROOM_NAME = 'canary-room';

if (!EMAIL || !PASSWORD) {
  console.error('CANARY_EMAIL / CANARY_PASSWORD are not set.');
  process.exit(1);
}
if (!CANARY_TOKEN) {
  console.error('CANARY_BYPASS_TOKEN is not set -- the canary account has no resolved timezone and will be blocked by the night gate without it.');
  process.exit(1);
}

function step(name) {
  console.log(`--- ${name} ---`);
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

  step('login');
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'nightcord' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  // The session token now lives in an httpOnly Set-Cookie response header,
  // not the JSON body. Node's fetch has no browser-style cookie jar, so it
  // has to be captured and forwarded by hand on every subsequent request.
  const setCookieHeaders = loginRes.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookieHeaders.map((c) => c.split(';')[0]).join('; ');
  if (!sessionCookie) throw new Error('login succeeded but no session cookie was set');
  console.log('OK');

  step('list rooms, find canary-room');
  const roomsRes = await fetch(`${API_URL}/rooms`, {
    headers: { Cookie: sessionCookie, 'X-Canary-Token': CANARY_TOKEN },
  });
  if (!roomsRes.ok) throw new Error(`list rooms failed: ${roomsRes.status}`);
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

    const ws = new WebSocket(
      `${WS_URL}/ws/rooms/${room.id}?canary_token=${encodeURIComponent(CANARY_TOKEN)}`,
      { headers: { Cookie: sessionCookie } }
    );

    ws.on('open', () => {
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

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  console.log('OK');

  console.log('\nAll canary checks passed.');
}

main().catch((err) => {
  console.error('\nCANARY FAILED:', err.message);
  process.exit(1);
});
