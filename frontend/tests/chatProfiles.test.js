import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({ me: { id: 1 }, getProfile: null }));
vi.mock('../src/api.js', () => ({
  getUser: () => api.me,
  getProfile: (...args) => api.getProfile(...args),
}));

import { renderMessage } from '../src/chatMessage.js';
import { openProfilePopup } from '../src/profilePopup.js';

const MESSAGE = { user_id: 2, display_name: 'night_owl', content: 'hi', created_at: '2026-10-09T03:00:00Z' };

beforeEach(() => {
  document.body.innerHTML = '<div class="screen"></div>';
  api.getProfile = vi.fn(async (id) => ({ id, display_name: id === 1 ? 'me_myself' : 'night_owl', bio: 'late-night CS', socials: {} }));
});

describe('chat messages', () => {
  it("show the sender's pixel avatar, or their photo", () => {
    const pixel = renderMessage(MESSAGE, { currentUser: api.me, onOpenProfile: () => {} });
    expect(pixel.querySelector('.msg-avatar .avatar-pixel')).not.toBeNull();

    const photo = renderMessage({ ...MESSAGE, avatar_url: 'https://img.clerk.com/a.png' }, { currentUser: api.me, onOpenProfile: () => {} });
    expect(photo.querySelector('.msg-avatar img').src).toBe('https://img.clerk.com/a.png');
  });

  it('open the profile from the avatar or the name', () => {
    const onOpenProfile = vi.fn();
    const msg = renderMessage(MESSAGE, { currentUser: api.me, onOpenProfile });

    msg.querySelector('.msg-author').click();
    msg.querySelector('.msg-avatar').click();

    expect(onOpenProfile).toHaveBeenCalledTimes(2);
    expect(onOpenProfile.mock.calls[0].slice(0, 2)).toEqual([2, 'night_owl']);
    expect(msg.querySelector('.msg-author').textContent).toBe('night_owl');
  });

  it('keep message text as text', () => {
    const msg = renderMessage({ ...MESSAGE, content: '<b>x</b>' }, { currentUser: api.me, onOpenProfile: () => {} });
    expect(msg.querySelector('.msg-body b')).toBeNull();
  });
});

describe('profile popups', () => {
  it("open a window with that student's public profile", async () => {
    const win = await openProfilePopup(2, 'night_owl');

    expect(api.getProfile).toHaveBeenCalledWith(2);
    expect(win.element.getAttribute('aria-label')).toBe('night_owl');
    expect(win.body.querySelector('.profile-bio').textContent).toBe('late-night CS');
    expect(win.body.querySelector('.profile-edit-link')).toBeNull(); // not yours
    win.element.querySelector('[aria-label^="Close"]').click();
  });

  it('bring an open one to the front instead of opening another', async () => {
    const first = await openProfilePopup(2, 'night_owl');
    const again = await openProfilePopup(2, 'night_owl');

    expect(again).toBe(first);
    expect(document.querySelectorAll('.profile-window')).toHaveLength(1);
    first.element.querySelector('[aria-label^="Close"]').click();
    expect(document.querySelector('.profile-window')).toBeNull();
  });

  it('link your own to the profile page, in a new tab so a call keeps going', async () => {
    const win = await openProfilePopup(1, 'me_myself');
    const edit = win.body.querySelector('.profile-edit-link');

    expect(edit.getAttribute('href')).toBe('/profile.html');
    expect(edit.target).toBe('_blank');
    win.element.querySelector('[aria-label^="Close"]').click();
  });

  it('say what went wrong if the profile cannot load', async () => {
    api.getProfile = vi.fn(async () => {
      throw new Error('No such student.');
    });

    const win = await openProfilePopup(9, 'ghost');

    expect(win.body.textContent).toBe('ERR: No such student.');
    win.element.querySelector('[aria-label^="Close"]').click();
  });
});
