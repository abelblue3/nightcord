import { renderAvatar } from './avatar.js';
import { setBusy } from './ui.js';

// Settings: the students you've blocked, each with an Unblock button.
// `unblock(userId)` resolves once the server has done it.

function emptyNote() {
  const li = document.createElement('li');
  li.className = 'blocked-empty';
  li.textContent = "You haven't blocked anyone.";
  return li;
}

export function renderBlockedList(list, students, { unblock }) {
  list.replaceChildren();
  if (!students.length) list.append(emptyNote());

  for (const student of students) {
    const row = document.createElement('li');
    row.className = 'blocked-row';

    const name = document.createElement('span');
    name.className = 'blocked-name';
    name.textContent = student.display_name;

    const error = document.createElement('span');
    error.className = 'blocked-error';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-small';
    button.textContent = 'Unblock';
    button.setAttribute('aria-label', `Unblock ${student.display_name}`);
    button.addEventListener('click', async () => {
      const restore = setBusy(button, 'UNBLOCKING...');
      try {
        await unblock(student.id);
        row.remove();
        if (!list.children.length) list.append(emptyNote());
      } catch (err) {
        restore();
        error.textContent = `ERR: ${err.message}`;
      }
    });

    row.append(renderAvatar({ avatarUrl: student.avatar_url, userId: student.id, size: 24 }), name, button, error);
    list.append(row);
  }
}
