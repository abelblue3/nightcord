import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  connectRoomSocket,
  getToken,
  getUser,
  listRooms,
  login,
  requireAuth,
  saveSession,
  signup,
} from '../src/api.js';

beforeEach(() => {
  localStorage.clear();
});

describe('session storage helpers', () => {
  it('round-trips token and user through saveSession/getToken/getUser', () => {
    saveSession('abc.jwt.token', { id: 1, display_name: 'Ada' });
    expect(getToken()).toBe('abc.jwt.token');
    expect(getUser()).toEqual({ id: 1, display_name: 'Ada' });
  });

  it('getUser returns null when nothing is stored', () => {
    expect(getUser()).toBeNull();
  });

  it('clearSession removes both token and user', () => {
    saveSession('abc.jwt.token', { id: 1 });
    clearSession();
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
  });
});

describe('requireAuth', () => {
  let originalLocation;

  beforeEach(() => {
    originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };
  });

  afterEach(() => {
    window.location = originalLocation;
  });

  it('redirects to index.html and returns null when there is no token', () => {
    const result = requireAuth();
    expect(result).toBeNull();
    expect(window.location.href).toBe('/index.html');
  });

  it('returns the token and does not redirect when one exists', () => {
    saveSession('abc.jwt.token', { id: 1 });
    const result = requireAuth();
    expect(result).toBe('abc.jwt.token');
    expect(window.location.href).toBe('');
  });
});

describe('request wrapper (via the exported endpoint functions)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signup posts JSON with the mapped field names', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, email: 'a@university.edu' }),
    });

    await signup({ email: 'a@university.edu', password: 'password123', displayName: 'Ada' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toMatch(/\/auth\/signup$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      email: 'a@university.edu',
      password: 'password123',
      display_name: 'Ada',
    });
  });

  it('attaches an Authorization header for authenticated requests when a token exists', async () => {
    saveSession('my-jwt', { id: 1 });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    await listRooms();

    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer my-jwt');
  });

  it('omits the Authorization header for authenticated requests with no token', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    await listRooms();

    const [, opts] = fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('throws an error using the backend-provided detail message on failure', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Incorrect email or password.' }),
    });

    await expect(login({ email: 'a@university.edu', password: 'wrong' })).rejects.toThrow(
      'Incorrect email or password.'
    );
  });

  it('falls back to a generic message when the error body has no detail', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(login({ email: 'a@university.edu', password: 'x' })).rejects.toThrow('Something went wrong.');
  });

  it('falls back to a generic message when the error body is not valid JSON', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(login({ email: 'a@university.edu', password: 'x' })).rejects.toThrow('Something went wrong.');
  });
});

describe('connectRoomSocket', () => {
  it('opens a WebSocket to the room endpoint carrying the stored token', () => {
    saveSession('my-jwt', { id: 1 });
    const OriginalWebSocket = global.WebSocket;
    const captured = [];
    global.WebSocket = class {
      constructor(url) {
        captured.push(url);
      }
    };

    connectRoomSocket(42);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain('/ws/rooms/42');
    expect(captured[0]).toContain('token=my-jwt');

    global.WebSocket = OriginalWebSocket;
  });
});
