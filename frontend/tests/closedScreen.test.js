import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/api.js', () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
  getUser: () => ({ id: 3, display_name: 'night_owl', avatar_url: null }),
}));

import { signOut } from '../src/api.js';
import { renderClosedScreen, watchForClose } from '../src/closedScreen.js';

describe('watchForClose', () => {
  let originalLocation;

  beforeEach(() => {
    vi.useFakeTimers();
    originalLocation = window.location;
    delete window.location;
    window.location = { reload: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
    window.location = originalLocation;
  });

  it('reloads when night turns to day, so the closed screen takes over', () => {
    vi.setSystemTime(new Date('2026-10-09T05:59:00Z'));
    const stop = watchForClose('UTC');

    vi.advanceTimersByTime(30000);
    expect(window.location.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000); // past 6am
    expect(window.location.reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('never reloads a page opened in the daytime (beta is open all day)', () => {
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    const stop = watchForClose('UTC');

    vi.advanceTimersByTime(5 * 60000);
    expect(window.location.reload).not.toHaveBeenCalled();
    stop();
  });
});

describe('renderClosedScreen', () => {
  let container;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders a sign-out control, since the closed screen replaces any surrounding logout button', () => {
    const stop = renderClosedScreen(container, 'UTC');
    const signOutBtn = container.querySelector('#closed-logout-btn');
    expect(signOutBtn).not.toBeNull();
    stop();
  });

  it('keeps the avatar menu and Lamp, so profiles can be edited in the daytime', () => {
    const stop = renderClosedScreen(container, 'UTC');

    const avatar = container.querySelector('.avatar-button');
    expect(avatar).not.toBeNull();
    avatar.click();
    const items = [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(['Profile', 'Settings', 'Log out']);
    expect(container.querySelector('.theme-toggle svg.lamp-icon')).not.toBeNull();
    stop();
  });

  it('clicking sign out signs the student out', () => {
    const stop = renderClosedScreen(container, 'UTC');
    container.querySelector('#closed-logout-btn').click();

    expect(signOut).toHaveBeenCalled();
    stop();
  });
});
