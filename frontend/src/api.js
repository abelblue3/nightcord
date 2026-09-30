import { devSkipGateActive, getBrowserTimezone } from './nightGate.js';
import { getSessionToken, loadClerk, signOutOfClerk } from './clerk.js';

// Same-origin by default: the Ruby web layer (web/) serves these pages and
// carries /api -- HTTP and WebSocket -- through to the backend.
// VITE_API_URL / VITE_WS_URL only need setting to talk to a backend on a
// different host directly.
function apiBaseUrl() {
  return import.meta.env.VITE_API_URL || '/api';
}

function wsBaseUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api`;
}

const USER_KEY = 'nightcord_user';

// Clerk holds the actual session. What's cached here is only what the pages
// render (id, name, school timezone), so the UI has something to show
// immediately. The email is deliberately left out: nothing displays it, and
// anything in localStorage is readable by any script on the page.
export function saveSession({ id, display_name, timezone }) {
  localStorage.setItem(USER_KEY, JSON.stringify({ id, display_name, timezone }));
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem(USER_KEY);
}

// Sends someone back to the sign-in page, signed out of Clerk in this browser.
export async function signOut() {
  clearSession();
  try {
    await signOutOfClerk();
  } catch {
    // Leave either way -- a failed sign-out call shouldn't strand anyone.
  } finally {
    window.location.href = '/index.html';
  }
}

// For the signed-in pages: true if Clerk has a session here, otherwise
// redirects to the sign-in page.
export async function requireAuth() {
  const clerk = await loadClerk();
  if (!clerk.user) {
    clearSession();
    window.location.href = '/index.html';
    return false;
  }
  return true;
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    // Raw `detail` payload from the server -- a plain string for most
    // errors, but the night gate returns { message, timezone } so the UI
    // can show an accurate countdown. Callers can check `.data?.timezone`.
    this.data = data;
  }
}

async function request(path, { method = 'GET', body, auth = false, retried = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  // Clerk session tokens live about a minute; getSessionToken() refreshes
  // as needed, so every request asks for one.
  const token = await getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (auth && devSkipGateActive()) headers['X-Dev-Skip-Gate'] = '1';

  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail = data.detail;
    if (auth && res.status === 401) {
      if (detail?.code === 'not-linked' && !retried) {
        // Signed in with Clerk but the nightcord account isn't linked yet
        // (e.g. a sign-in that skipped the index page). Link it, then retry.
        await startSession(getBrowserTimezone());
        return request(path, { method, body, auth, retried: true });
      }
      // Session expired or revoked ("log out of all devices" elsewhere).
      await signOut();
    }
    const message = typeof detail === 'string' ? detail : detail?.message || 'Something went wrong.';
    throw new ApiError(message, res.status, detail);
  }

  return data;
}

// Links this Clerk sign-in to a nightcord account (creating one on first
// sign-in) and caches what the pages render.
export async function startSession(timezone) {
  const user = await request('/auth/session', { method: 'POST', body: { timezone } });
  saveSession(user);
  return user;
}

export async function logoutAllDevices() {
  return request('/auth/logout-all', { method: 'POST', auth: true });
}

export async function listRooms() {
  return request('/rooms', { auth: true });
}

export async function createRoom(name) {
  return request('/rooms', { method: 'POST', body: { name }, auth: true });
}

// Newest page first; pass `before` (a message id) to page further back.
export async function getRoomMessages(roomId, { before } = {}) {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return request(`/rooms/${roomId}/messages${query}`, { auth: true });
}

// Browsers can't put an Authorization header on a WebSocket, so the session
// token goes in the first message instead (never the URL, which ends up in
// logs). The token is fetched before connecting and sent from the first
// 'open' listener, so it always goes out before anything the page sends.
export async function connectRoomSocket(roomId) {
  const token = await getSessionToken();
  const params = new URLSearchParams();
  if (devSkipGateActive()) params.set('skip_gate', '1');
  const query = params.toString();

  const socket = new WebSocket(`${wsBaseUrl()}/ws/rooms/${roomId}${query ? `?${query}` : ''}`);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'auth', token }));
  });
  return socket;
}
