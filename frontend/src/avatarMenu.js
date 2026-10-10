import { getUser, signOut } from './api.js';
import { renderAvatar } from './avatar.js';

// Your avatar in the top bar, opening a Windows 95-style menu: Profile,
// Settings, Log out. On every signed-in page, the closed (daytime) screen
// included -- profiles aren't night-gated. During a video call it's
// disabled, because leaving the page would end the call.

const ITEMS = [
  { label: 'Profile', href: '/profile.html' },
  { label: 'Settings', href: '/profile.html#settings' },
  { label: 'Log out', action: signOut },
];

export function initAvatarMenu(container) {
  const user = getUser();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'avatar-button';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', `Account menu${user?.display_name ? ` for ${user.display_name}` : ''}`);
  button.title = 'Profile, settings and log out';
  button.append(renderAvatar({ avatarUrl: user?.avatar_url, userId: user?.id, size: 32 }));

  const menu = document.createElement('ul');
  menu.className = 'retro-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const entries = ITEMS.map(({ label, href, action }) => {
    const item = document.createElement('li');
    item.setAttribute('role', 'none');
    const control = document.createElement(href ? 'a' : 'button');
    control.className = 'retro-menu-item';
    control.setAttribute('role', 'menuitem');
    control.tabIndex = -1;
    control.textContent = label;
    if (href) control.href = href;
    else {
      control.type = 'button';
      control.addEventListener('click', action);
    }
    item.append(control);
    menu.append(item);
    return control;
  });

  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    entries[0].focus();
  }

  function close({ refocus = false } = {}) {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  }

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open();
    }
  });
  menu.addEventListener('keydown', (event) => {
    const index = entries.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ refocus: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      entries[(index + step + entries.length) % entries.length].focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!container.contains(event.target)) close();
  });

  container.classList.add('avatar-menu');
  container.replaceChildren(button, menu);

  return {
    // While in a video call: leaving the page would end the call.
    setInCall(inCall) {
      button.disabled = inCall;
      button.title = inCall ? 'Leave the video call to open your profile' : 'Profile, settings and log out';
      if (inCall) close();
    },
  };
}
