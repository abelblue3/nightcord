import { renderAvatar } from './avatar.js';

// One chat message: the sender's avatar, their name and the time, then the
// text. Clicking the avatar or name calls `onOpenProfile(userId, name, at)`,
// `at` being just below what was clicked (the profile popup opens there).

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function renderMessage({ display_name, content, created_at, user_id, avatar_url }, { currentUser, onOpenProfile }) {
  const name = display_name || 'someone';
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (currentUser && user_id === currentUser.id ? ' own' : '');

  // The avatar and the name open the same popup; only the name is a tab stop.
  const avatar = document.createElement('button');
  avatar.type = 'button';
  avatar.className = 'msg-avatar';
  avatar.tabIndex = -1;
  avatar.setAttribute('aria-hidden', 'true');
  avatar.append(renderAvatar({ avatarUrl: avatar_url, userId: user_id, size: 24 }));

  const author = document.createElement('button');
  author.type = 'button';
  author.className = 'msg-author';
  author.textContent = name;
  author.title = `View ${name}'s profile`;

  for (const button of [avatar, author]) {
    button.addEventListener('click', () => {
      const spot = button.getBoundingClientRect();
      onOpenProfile(user_id, name, { left: spot.left, top: spot.bottom + 4 });
    });
  }

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = formatTime(created_at);
  meta.append(author, time);

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = content;

  wrap.append(avatar, meta, body);
  return wrap;
}
