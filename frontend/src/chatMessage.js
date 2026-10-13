import { renderAvatar } from './avatar.js';

// One chat message: the sender's avatar, their name and the time, then the
// text. Clicking the avatar or name calls `onOpenProfile(userId, name, at)`,
// `at` being just below what was clicked (the profile popup opens there).

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function renderMessage({ id, display_name, content, created_at, user_id, avatar_url }, { currentUser, onOpenProfile, onDelete }) {
  const name = display_name || 'someone';
  const wrap = document.createElement('div');
  wrap.className = 'msg' + (currentUser && user_id === currentUser.id ? ' own' : '');
  wrap.dataset.userId = user_id; // so blocking someone can remove theirs
  wrap.dataset.messageId = id; // so a report can point at this message

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

  // Your own messages get a small Delete (shown on hover or focus, always on
  // touch screens, which have no right-click). `onDelete(message)`.
  if (onDelete && currentUser && user_id === currentUser.id) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'msg-delete';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', 'Delete message');
    remove.addEventListener('click', () => onDelete(wrap));
    meta.append(remove);
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = content;

  wrap.append(avatar, meta, body);
  return wrap;
}

// A `{type: "deleted", id}` frame from the chat socket: someone deleted their
// message. It's removed from the chat, and from `held` (live messages held
// back during a reconnect catch-up). Returns false for an ordinary message.
export function applyDeletion(chatLog, held, frame) {
  if (frame.type !== 'deleted') return false;
  chatLog.querySelector(`.msg[data-message-id="${Number(frame.id)}"]`)?.remove();
  const at = held ? held.findIndex((msg) => msg.id === frame.id) : -1;
  if (at >= 0) held.splice(at, 1);
  return true;
}
