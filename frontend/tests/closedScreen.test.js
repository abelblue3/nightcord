import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/api.js', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn(),
}));

import { logout, clearSession } from '../src/api.js';
import { renderClosedScreen } from '../src/closedScreen.js';

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

  it('clicking sign out logs out and redirects to the login page', async () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };

    const stop = renderClosedScreen(container, 'UTC');
    container.querySelector('#closed-logout-btn').click();

    // Let the async click handler's microtasks resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logout).toHaveBeenCalled();
    expect(clearSession).toHaveBeenCalled();
    expect(window.location.href).toBe('/index.html');

    stop();
    window.location = originalLocation;
  });

  it('still redirects to login even if the logout request fails', async () => {
    logout.mockRejectedValueOnce(new Error('network error'));

    const originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };

    const stop = renderClosedScreen(container, 'UTC');
    container.querySelector('#closed-logout-btn').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clearSession).toHaveBeenCalled();
    expect(window.location.href).toBe('/index.html');

    stop();
    window.location = originalLocation;
  });
});
