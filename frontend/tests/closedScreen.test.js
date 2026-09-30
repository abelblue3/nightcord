import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/api.js', () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}));

import { signOut } from '../src/api.js';
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

  it('clicking sign out signs the student out', () => {
    const stop = renderClosedScreen(container, 'UTC');
    container.querySelector('#closed-logout-btn').click();

    expect(signOut).toHaveBeenCalled();
    stop();
  });
});
