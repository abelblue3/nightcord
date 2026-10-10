import { describe, it, expect, beforeEach, vi } from 'vitest';

const user = vi.hoisted(() => ({ current: null }));
vi.mock('../src/api.js', () => ({
  getUser: () => user.current,
  signOut: vi.fn(),
}));

import { signOut } from '../src/api.js';
import { renderAvatar } from '../src/avatar.js';
import { initAvatarMenu } from '../src/avatarMenu.js';

let container;
let menu;

const button = () => container.querySelector('.avatar-button');
const items = () => [...container.querySelectorAll('[role="menuitem"]')];
const key = (target, name) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = '';
  user.current = { id: 7, display_name: 'night_owl', avatar_url: null };
  container = document.createElement('div');
  document.body.appendChild(container);
  menu = initAvatarMenu(container);
});

describe('avatars', () => {
  it('without a photo, show a pixel person in a pixel circle', () => {
    const avatar = renderAvatar({ avatarUrl: null, userId: 7 });
    expect(avatar.querySelector('svg.avatar-pixel')).not.toBeNull();
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.querySelector('svg.avatar-ring')).not.toBeNull();
  });

  it('with a photo, show the photo (as an attribute, never HTML) in the same circle', () => {
    const avatar = renderAvatar({ avatarUrl: 'https://img.clerk.com/a.png', userId: 7 });
    expect(avatar.querySelector('img').getAttribute('src')).toBe('https://img.clerk.com/a.png');
    expect(avatar.querySelector('svg.avatar-ring')).not.toBeNull();
  });

  it('give different people different backgrounds', () => {
    const tint = (id) => renderAvatar({ avatarUrl: null, userId: id }).querySelector('svg.avatar-pixel').getAttribute('class');
    expect(tint(1)).not.toBe(tint(2));
  });
});

describe('the avatar menu', () => {
  it('opens Profile, Settings and Log out, and closes again', () => {
    button().click();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(items().map((item) => item.textContent)).toEqual(['Profile', 'Settings', 'Log out']);
    expect(items()[0].getAttribute('href')).toBe('/profile.html');
    expect(items()[1].getAttribute('href')).toBe('/profile.html#settings');

    button().click();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('works from the keyboard: arrows move, Escape closes back to the button', () => {
    key(button(), 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);

    key(items()[0], 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1], 'ArrowUp');
    key(items()[0], 'ArrowUp');
    expect(document.activeElement).toBe(items()[2]); // wraps around

    key(items()[2], 'Escape');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button());
  });

  it('Log out signs out', () => {
    button().click();
    items()[2].click();
    expect(signOut).toHaveBeenCalled();
  });

  it('is disabled during a video call, and back after leaving', () => {
    menu.setInCall(true);
    expect(button().disabled).toBe(true);
    expect(button().title).toContain('Leave the video call');

    menu.setInCall(false);
    expect(button().disabled).toBe(false);
  });
});
