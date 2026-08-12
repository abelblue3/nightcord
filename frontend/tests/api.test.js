import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveSession,
  getUser,
  clearSession,
  requireAuth,
  signup,
  login,
  logout,
  logoutAllDevices,
  listRooms,
  createRoom,
  connectRoomSocket,
  googleAuth,
} from '../src/api.js';

function mockFetchOnce(status, body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('session storage', () => {
  it('saveSession stores the user, getUser reads it back', () => {
    saveSession({ id: 1, display_name: 'Jane' });
    expect(getUser()).toEqual({ id: 1, display_name: 'Jane' });
  });

  it('getUser returns null when nothing is stored', () => {
    expect(getUser()).toBeNull();
  });

  it('clearSession removes it', () => {
    saveSession({ id: 1 });
    clearSession();
    expect(getUser()).toBeNull();
  });
});

describe('requireAuth', () => {
  // The session token itself lives in an httpOnly cookie this code can't
  // read -- requireAuth only checks for a cached user as a fast, optimistic
  // UX gate. The real check happens server-side on the first request.

  it('returns true when a cached user exists', () => {
    saveSession({ id: 1 });
    expect(requireAuth()).toBe(true);
  });

  it('redirects to /index.html and returns null when there is no cached user', () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };

    const result = requireAuth();

    expect(result).toBeNull();
    expect(window.location.href).toBe('/index.html');

    window.location = originalLocation;
  });
});

describe('request wrapper (via signup/login)', () => {
  it('signup posts the right shape and returns the parsed body', async () => {
    mockFetchOnce(201, { id: 1, email: 'a@university.edu', is_verified: false });

    const result = await signup({ email: 'a@university.edu', password: 'password123', displayName: 'A' });

    expect(result).toEqual({ id: 1, email: 'a@university.edu', is_verified: false });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/signup');
    expect(JSON.parse(options.body)).toEqual({
      email: 'a@university.edu',
      password: 'password123',
      display_name: 'A',
    });
  });

  it('throws with the server-provided detail message on failure', async () => {
    mockFetchOnce(400, { detail: 'Signup requires a valid college student email address.' });

    await expect(login({ email: 'a@gmail.com', password: 'x' })).rejects.toThrow(
      'Signup requires a valid college student email address.'
    );
  });

  it('falls back to a generic message when the server gives no detail', async () => {
    mockFetchOnce(500, {});
    await expect(login({ email: 'a@university.edu', password: 'x' })).rejects.toThrow('Something went wrong.');
  });

  it('every request sends credentials so the httpOnly session cookie is included', async () => {
    mockFetchOnce(200, []);
    await listRooms();
    const [, options] = global.fetch.mock.calls[0];
    expect(options.credentials).toBe('include');
  });

  it('every request sends the CSRF header', async () => {
    mockFetchOnce(200, []);
    await listRooms();
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Requested-With']).toBe('nightcord');
  });

  it('no request ever attaches an Authorization header -- there is no client-readable token', async () => {
    saveSession({ id: 1 });
    mockFetchOnce(200, []);
    await listRooms();
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('createRoom sends the room name in the body', async () => {
    mockFetchOnce(201, { id: 5, name: 'late-night-calc' });

    await createRoom('late-night-calc');

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ name: 'late-night-calc' });
  });

  it('signup includes the browser timezone when given one', async () => {
    mockFetchOnce(201, { id: 1, email: 'a@university.edu', is_verified: false });

    await signup({ email: 'a@university.edu', password: 'password123', displayName: 'A', timezone: 'America/Denver' });

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body).timezone).toBe('America/Denver');
  });

  it('googleAuth sends the credential and timezone', async () => {
    mockFetchOnce(200, { id: 1 });

    await googleAuth('fake-credential', 'America/Chicago');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/google');
    expect(JSON.parse(options.body)).toEqual({ credential: 'fake-credential', timezone: 'America/Chicago' });
  });

  it('logout posts to /auth/logout', async () => {
    mockFetchOnce(200, { message: 'Logged out.' });
    await logout();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/logout');
    expect(options.method).toBe('POST');
  });

  it('logoutAllDevices posts to /auth/logout-all', async () => {
    mockFetchOnce(200, { message: 'Logged out of all devices.' });
    await logoutAllDevices();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/logout-all');
    expect(options.method).toBe('POST');
  });
});

describe('401 on an authenticated request', () => {
  it('clears the cached user and redirects, since the cookie is expired/revoked', async () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };

    saveSession({ id: 1, display_name: 'Jane' });
    mockFetchOnce(401, { detail: 'Could not validate credentials' });

    await expect(listRooms()).rejects.toThrow();

    expect(getUser()).toBeNull();
    expect(window.location.href).toBe('/index.html');

    window.location = originalLocation;
  });

  it('does not redirect on a 401 from a non-authenticated call like login', async () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };

    mockFetchOnce(401, { detail: 'Incorrect email or password.' });

    await expect(login({ email: 'a@university.edu', password: 'wrong' })).rejects.toThrow();

    expect(window.location.href).toBe('');

    window.location = originalLocation;
  });
});

describe('night-gate error data', () => {
  it('a 403 with a structured detail exposes .status and .data on the thrown error', async () => {
    mockFetchOnce(403, { detail: { message: 'nightcord is closed right now for your school.', timezone: 'America/New_York' } });

    await expect(listRooms()).rejects.toMatchObject({
      message: 'nightcord is closed right now for your school.',
      status: 403,
      data: { message: 'nightcord is closed right now for your school.', timezone: 'America/New_York' },
    });
  });

  it('a plain-string detail still works as before (no .data.timezone)', async () => {
    mockFetchOnce(401, { detail: 'Incorrect email or password.' });

    await expect(login({ email: 'a@university.edu', password: 'wrong' })).rejects.toMatchObject({
      message: 'Incorrect email or password.',
      data: 'Incorrect email or password.',
    });
  });
});

describe('dev gate bypass header', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('attaches X-Dev-Skip-Gate to authenticated requests when the bypass is on', async () => {
    saveSession({ id: 1 });
    window.history.replaceState({}, '', '/?skipGate=1');
    mockFetchOnce(200, []);

    await listRooms();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Dev-Skip-Gate']).toBe('1');
  });

  it('omits the header when the bypass is off', async () => {
    mockFetchOnce(200, []);

    await listRooms();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Dev-Skip-Gate']).toBeUndefined();
  });
});

describe('connectRoomSocket', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('builds a ws URL with just the room id -- the session cookie rides along automatically', () => {
    let capturedUrl;
    global.WebSocket = class {
      constructor(url) {
        capturedUrl = url;
      }
    };

    connectRoomSocket(42);

    expect(capturedUrl).toContain('/ws/rooms/42');
    expect(capturedUrl).not.toContain('token=');
    expect(capturedUrl).not.toContain('skip_gate');
  });

  it('includes skip_gate=1 when the dev bypass is on', () => {
    window.history.replaceState({}, '', '/?skipGate=1');

    let capturedUrl;
    global.WebSocket = class {
      constructor(url) {
        capturedUrl = url;
      }
    };

    connectRoomSocket(42);

    expect(capturedUrl).toContain('skip_gate=1');
  });
});
