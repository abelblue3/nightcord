import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Clerk is replaced with a small fake: whether someone is signed in, and the
// session token getSessionToken() hands out.
const clerkState = vi.hoisted(() => ({ user: { id: 'user_1' }, token: 'clerk-token-1' }));

vi.mock('../src/clerk.js', () => ({
  loadClerk: vi.fn(async () => ({ user: clerkState.user })),
  getSessionToken: vi.fn(async () => clerkState.token),
  signOutOfClerk: vi.fn(async () => {}),
}));

import { signOutOfClerk } from '../src/clerk.js';
import {
  saveSession,
  getUser,
  clearSession,
  requireAuth,
  signOut,
  startSession,
  logoutAllDevices,
  listRooms,
  createRoom,
  connectRoomSocket,
  getRoomMessages,
} from '../src/api.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockFetchOnce(status, body) {
  global.fetch = vi.fn().mockResolvedValue(jsonResponse(status, body));
}

function mockFetchSequence(...responses) {
  global.fetch = vi.fn();
  for (const [status, body] of responses) global.fetch.mockResolvedValueOnce(jsonResponse(status, body));
}

let originalLocation;

function captureRedirects() {
  originalLocation = window.location;
  delete window.location;
  window.location = { href: '', search: '', protocol: 'http:', host: 'localhost:5173' };
}

function restoreLocation() {
  if (originalLocation) window.location = originalLocation;
  originalLocation = undefined;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  clerkState.user = { id: 'user_1' };
  clerkState.token = 'clerk-token-1';
});

afterEach(() => {
  restoreLocation();
  vi.unstubAllEnvs();
});

describe('session storage', () => {
  it('saveSession stores the user, getUser reads it back', () => {
    saveSession({ id: 1, display_name: 'Jane' });
    expect(getUser()).toEqual({ id: 1, display_name: 'Jane' });
  });

  it('saveSession keeps only what the pages render -- never the email', () => {
    saveSession({ id: 1, email: 'jane@university.edu', display_name: 'Jane', timezone: 'America/Chicago' });
    expect(getUser()).toEqual({ id: 1, display_name: 'Jane', timezone: 'America/Chicago' });
    expect(localStorage.getItem('nightcord_user')).not.toContain('jane@university.edu');
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
  it('returns true when Clerk has a signed-in user', async () => {
    expect(await requireAuth()).toBe(true);
  });

  it('redirects to the sign-in page when nobody is signed in', async () => {
    clerkState.user = null;
    saveSession({ id: 1 });
    captureRedirects();

    expect(await requireAuth()).toBe(false);
    expect(window.location.href).toBe('/index.html');
    expect(getUser()).toBeNull();
  });
});

describe('signOut', () => {
  it('signs out of Clerk, clears the cache and goes to the sign-in page', async () => {
    saveSession({ id: 1 });
    captureRedirects();

    await signOut();

    expect(signOutOfClerk).toHaveBeenCalled();
    expect(getUser()).toBeNull();
    expect(window.location.href).toBe('/index.html');
  });

  it('still leaves if Clerk sign-out fails', async () => {
    signOutOfClerk.mockRejectedValueOnce(new Error('network error'));
    captureRedirects();

    await signOut();

    expect(window.location.href).toBe('/index.html');
  });
});

describe('request wrapper', () => {
  it('sends the Clerk session token as a Bearer header', async () => {
    mockFetchOnce(200, []);
    await listRooms();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer clerk-token-1');
  });

  it('sends no cookie credentials and no CSRF header -- there is no cookie session anymore', async () => {
    mockFetchOnce(200, []);
    await listRooms();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.credentials).toBeUndefined();
    expect(options.headers['X-Requested-With']).toBeUndefined();
  });

  it('omits Authorization when signed out', async () => {
    clerkState.token = null;
    mockFetchOnce(200, {});
    await startSession(null).catch(() => {});

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('throws with the server-provided detail message on failure', async () => {
    mockFetchOnce(409, { detail: 'Room name already taken.' });
    await expect(createRoom('dup')).rejects.toThrow('Room name already taken.');
  });

  it('falls back to a generic message when the server gives no detail', async () => {
    mockFetchOnce(500, {});
    await expect(createRoom('x')).rejects.toThrow('Something went wrong.');
  });

  it('createRoom sends the room name in the body', async () => {
    mockFetchOnce(201, { id: 1, name: 'calc' });
    await createRoom('calc');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/rooms');
    expect(JSON.parse(options.body)).toEqual({ name: 'calc' });
  });

  it('logoutAllDevices posts to /auth/logout-all', async () => {
    mockFetchOnce(200, { message: 'Signed out of all devices.' });
    await logoutAllDevices();

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/logout-all');
    expect(options.method).toBe('POST');
  });
});

describe('startSession', () => {
  it('posts the browser timezone and caches the account (without the email)', async () => {
    mockFetchOnce(200, { id: 7, email: 'a@university.edu', display_name: 'A', timezone: 'America/Denver' });

    const user = await startSession('America/Denver');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/auth/session');
    expect(JSON.parse(options.body)).toEqual({ timezone: 'America/Denver' });
    expect(user.id).toBe(7);
    expect(getUser()).toEqual({ id: 7, display_name: 'A', timezone: 'America/Denver' });
  });

  it('a refusal (e.g. not a .edu address) is thrown, not redirected', async () => {
    captureRedirects();
    mockFetchOnce(403, { detail: 'Only college student (.edu) emails can join nightcord.' });

    await expect(startSession(null)).rejects.toThrow('.edu');
    expect(window.location.href).toBe('');
  });
});

describe('401 on an authenticated request', () => {
  it('links the account and retries when the backend says it is not linked yet', async () => {
    mockFetchSequence(
      [401, { detail: { message: 'Finish signing in to nightcord.', code: 'not-linked' } }],
      [200, { id: 3, display_name: 'C', timezone: 'UTC' }],
      [200, [{ id: 1, name: 'calc' }]],
    );

    const rooms = await listRooms();

    expect(rooms).toEqual([{ id: 1, name: 'calc' }]);
    const paths = global.fetch.mock.calls.map(([url]) => url.replace(/^.*?(\/rooms|\/auth\/session)$/, '$1'));
    expect(paths).toEqual(['/rooms', '/auth/session', '/rooms']);
    expect(getUser()).toEqual({ id: 3, display_name: 'C', timezone: 'UTC' });
  });

  it('signs out when the session is no longer valid', async () => {
    saveSession({ id: 1 });
    captureRedirects();
    mockFetchOnce(401, { detail: 'Could not validate credentials' });

    await expect(listRooms()).rejects.toThrow();

    expect(signOutOfClerk).toHaveBeenCalled();
    expect(getUser()).toBeNull();
    expect(window.location.href).toBe('/index.html');
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
});

describe('dev gate bypass header', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('attaches X-Dev-Skip-Gate to authenticated requests when the bypass is on', async () => {
    window.history.replaceState({}, '', '/?skipGate=1');
    mockFetchOnce(200, []);

    await listRooms();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Dev-Skip-Gate']).toBe('1');
  });

  it('omits the header when the bypass is off', async () => {
    localStorage.clear();
    mockFetchOnce(200, []);

    await listRooms();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['X-Dev-Skip-Gate']).toBeUndefined();
  });
});

describe('getRoomMessages', () => {
  it('asks for the newest page by default', async () => {
    mockFetchOnce(200, []);
    await getRoomMessages(7);
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/rooms\/7\/messages$/);
  });

  it('pages back with ?before=<oldest message id>', async () => {
    mockFetchOnce(200, []);
    await getRoomMessages(7, { before: 123 });
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/rooms\/7\/messages\?before=123$/);
  });
});

describe('connectRoomSocket', () => {
  let sockets;

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    sockets = [];
    global.WebSocket = class {
      constructor(url) {
        this.url = url;
        this.sent = [];
        this.listeners = {};
        sockets.push(this);
      }

      addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
      }

      send(data) {
        this.sent.push(data);
      }

      open() {
        for (const fn of this.listeners.open || []) fn();
      }
    };
  });

  it('builds a ws URL with just the room id -- no token in the URL', async () => {
    await connectRoomSocket(42);

    expect(sockets[0].url).toContain('/ws/rooms/42');
    expect(sockets[0].url).not.toContain('token');
    expect(sockets[0].url).not.toContain('skip_gate');
  });

  it('sends the session token as the first message, before anything the page sends', async () => {
    const socket = await connectRoomSocket(42);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ content: 'hello' })));

    socket.open();

    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'auth', token: 'clerk-token-1' });
    expect(JSON.parse(socket.sent[1])).toEqual({ content: 'hello' });
  });

  it('includes skip_gate=1 when the dev bypass is on', async () => {
    window.history.replaceState({}, '', '/?skipGate=1');
    await connectRoomSocket(42);
    expect(sockets[0].url).toContain('skip_gate=1');
  });
});

describe('same-origin defaults (served through the Ruby web layer)', () => {
  it('calls /api on the current site when VITE_API_URL is not set', async () => {
    vi.stubEnv('VITE_API_URL', '');
    mockFetchOnce(200, []);

    await listRooms();

    expect(global.fetch.mock.calls[0][0]).toBe('/api/rooms');
  });

  it('opens the chat socket on the current site when VITE_WS_URL is not set', async () => {
    vi.stubEnv('VITE_WS_URL', '');
    window.history.replaceState({}, '', '/');
    let capturedUrl;
    global.WebSocket = class {
      constructor(url) {
        capturedUrl = url;
      }

      addEventListener() {}
    };

    await connectRoomSocket(42);

    expect(capturedUrl).toBe(`ws://${window.location.host}/api/ws/rooms/42`);
  });

  it('still honors an explicit VITE_WS_URL', async () => {
    vi.stubEnv('VITE_WS_URL', 'wss://backend.example');
    let capturedUrl;
    global.WebSocket = class {
      constructor(url) {
        capturedUrl = url;
      }

      addEventListener() {}
    };

    await connectRoomSocket(42);

    expect(capturedUrl).toBe('wss://backend.example/ws/rooms/42');
  });
});
