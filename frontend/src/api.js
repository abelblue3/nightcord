import { devSkipGateActive } from './nightGate.js';

const API_URL = import.meta.env.VITE_API_URL;
const WS_URL = import.meta.env.VITE_WS_URL;

const USER_KEY = 'nightcord_user';

// The session token itself lives in an httpOnly cookie the backend sets --
// this JS never sees it. What's cached here is only the non-sensitive user
// object, purely so the UI has something to render immediately; the cookie
// (checked server-side on every request) is the actual source of truth.
export function saveSession(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem(USER_KEY);
}

// Optimistic only: a cached user doesn't prove the cookie is still valid
// (it may have expired, or been revoked by "log out of all devices" on
// another tab). The real check happens on the first authenticated request;
// request() below redirects here on a 401 either way.
export function requireAuth() {
  if (!getUser()) {
    window.location.href = '/index.html';
    return null;
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

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'nightcord' };
  if (auth && devSkipGateActive()) headers['X-Dev-Skip-Gate'] = '1';

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: 'include', // send/receive the httpOnly session cookie, including cross-site (Vercel <-> Railway)
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (auth && res.status === 401) {
      // Cookie missing/expired/revoked -- the cached user object is stale.
      clearSession();
      window.location.href = '/index.html';
    }
    const detail = data.detail;
    const message = typeof detail === 'string' ? detail : detail?.message || 'Something went wrong.';
    throw new ApiError(message, res.status, detail);
  }

  return data;
}

export async function signup({ email, password, displayName, timezone }) {
  return request('/auth/signup', {
    method: 'POST',
    body: { email, password, display_name: displayName, timezone },
  });
}

export async function login({ email, password }) {
  return request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export async function logout() {
  return request('/auth/logout', { method: 'POST' });
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

export async function getRoomMessages(roomId) {
  return request(`/rooms/${roomId}/messages`, { auth: true });
}

export async function googleAuth(credential, timezone) {
  return request('/auth/google', { method: 'POST', body: { credential, timezone } });
}

export function connectRoomSocket(roomId) {
  const params = new URLSearchParams();
  if (devSkipGateActive()) params.set('skip_gate', '1');
  const query = params.toString();
  // The session cookie rides along on the WebSocket handshake automatically
  // (it's a normal HTTP request under the hood) -- no token in the URL.
  return new WebSocket(`${WS_URL}/ws/rooms/${roomId}${query ? `?${query}` : ''}`);
}
