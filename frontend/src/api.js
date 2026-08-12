import { devSkipGateActive } from './nightGate.js';

const API_URL = import.meta.env.VITE_API_URL;
const WS_URL = import.meta.env.VITE_WS_URL;

const TOKEN_KEY = 'nightcord_token';
const USER_KEY = 'nightcord_user';

export function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = '/index.html';
    return null;
  }
  return token;
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
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (devSkipGateActive()) headers['X-Dev-Skip-Gate'] = '1';
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
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

export async function listRooms() {
  return request('/rooms', { auth: true });
}

export async function createRoom(name) {
  return request('/rooms', { method: 'POST', body: { name }, auth: true });
}

export async function getRoomMessages(roomId) {
  return request(`/rooms/${roomId}/messages`, { auth: true });
}

export async function verifyEmail(token) {
  return request('/auth/verify-email', { method: 'POST', body: { token } });
}

export async function resendVerification(email) {
  return request('/auth/resend-verification', { method: 'POST', body: { email } });
}

export async function googleAuth(credential, timezone) {
  return request('/auth/google', { method: 'POST', body: { credential, timezone } });
}

export function connectRoomSocket(roomId) {
  const params = new URLSearchParams({ token: getToken() });
  if (devSkipGateActive()) params.set('skip_gate', '1');
  return new WebSocket(`${WS_URL}/ws/rooms/${roomId}?${params.toString()}`);
}
