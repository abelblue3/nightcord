import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveSession,
  getToken,
  getUser,
  clearSession,
  requireAuth,
  signup,
  login,
  listRooms,
  createRoom,
  connectRoomSocket,
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
  it('saveSession stores token and user, getToken/getUser read them back', () => {
    saveSession('abc123', { id: 1, display_name: 'Jane' });
    expect(getToken()).toBe('abc123');
    expect(getUser()).toEqual({ id: 1, display_name: 'Jane' });
  });

  it('getUser returns null when nothing is stored', () => {
    expect(getUser()).toBeNull();
  });

  it('clearSession removes both', () => {
    saveSession('abc123', { id: 1 });
    clearSession();
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
  });
});

describe('requireAuth', () => {
  it('returns the token when one exists', () => {
    saveSession('abc123', { id: 1 });
    expect(requireAuth()).toBe('abc123');
  });

  it('redirects to /index.html and returns null when there is no token', () => {
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

  it('authenticated requests attach the Authorization header when a token exists', async () => {
    saveSession('my-token', { id: 1 });
    mockFetchOnce(200, []);

    await listRooms();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer my-token');
  });

  it('requests with no session omit the Authorization header', async () => {
    mockFetchOnce(200, []);
    await listRooms();
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('createRoom sends the room name in the body', async () => {
    saveSession('my-token', { id: 1 });
    mockFetchOnce(201, { id: 5, name: 'late-night-calc' });

    await createRoom('late-night-calc');

    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ name: 'late-night-calc' });
  });
});

describe('connectRoomSocket', () => {
  it('builds a ws URL with the room id and current token', () => {
    saveSession('my-token', { id: 1 });

    let capturedUrl;
    global.WebSocket = class {
      constructor(url) {
        capturedUrl = url;
      }
    };

    connectRoomSocket(42);

    expect(capturedUrl).toContain('/ws/rooms/42');
    expect(capturedUrl).toContain('token=my-token');
  });
});
