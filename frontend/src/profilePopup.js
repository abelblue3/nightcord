import { blockStudent, getProfile, getUser, unblockStudent } from './api.js';
import { createWindow } from './floatingWindow.js';
import { renderProfileCard } from './profileCard.js';
import { loadingLine, setBusy } from './ui.js';

// Someone's profile in a read-only Win95-style window, opened from chat. One
// window per person: opening them again brings theirs to the front.

const open = new Map(); // user id -> window

// Report (handed to the room page, which knows the room) and Block, after a
// second click to confirm, then Undo. `onBlock(userId)` / `onUnblock(userId)`
// let the room page hide or keep that student.
function blockControls(userId, displayName, { onBlock, onUnblock, onReport }) {
  const row = document.createElement('div');
  row.className = 'profile-block-row';

  function note(text, buttonClass, label, onClick) {
    const p = document.createElement('p');
    p.textContent = text;
    row.replaceChildren(p);
    if (buttonClass) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn btn-small ${buttonClass}`;
      button.textContent = label;
      button.addEventListener('click', onClick);
      row.append(button);
    }
  }

  const block = document.createElement('button');
  block.type = 'button';
  block.className = 'btn btn-small profile-block';
  block.textContent = 'Block';
  block.addEventListener('click', async () => {
    if (block.textContent === 'Block') {
      block.textContent = 'Sure? Block';
      return;
    }
    const restore = setBusy(block, 'BLOCKING...');
    try {
      await blockStudent(userId);
      onBlock?.(userId);
      note("Blocked. You won't see their messages.", 'profile-unblock', 'Undo', async () => {
        try {
          await unblockStudent(userId);
          onUnblock?.(userId);
          note('Unblocked. Their earlier messages come back when you reload the room.');
        } catch (err) {
          note(`ERR: ${err.message}`);
        }
      });
    } catch (err) {
      restore();
      note(`ERR: ${err.message}`);
    }
  });
  if (onReport) {
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'btn btn-small profile-report';
    report.textContent = 'Report';
    report.addEventListener('click', () => onReport(userId, displayName));
    row.append(report);
  }
  row.append(block);
  return row;
}

export async function openProfilePopup(userId, displayName, at, { onBlock, onUnblock, onReport } = {}) {
  const existing = open.get(userId);
  if (existing) {
    existing.show();
    return existing;
  }

  const win = createWindow({
    title: displayName,
    className: 'profile-window',
    at,
    close: {
      label: `Close ${displayName}'s profile`,
      action: () => {
        win.remove();
        open.delete(userId);
      },
    },
  });
  open.set(userId, win);
  win.body.append(loadingLine('LOADING PROFILE'));
  document.querySelector('.screen').append(win.element);
  win.show();
  win.element.querySelector('.retro-titlebar').focus(); // keyboard users land in it

  try {
    const profile = await getProfile(userId);
    win.body.replaceChildren(renderProfileCard(profile));
    if (userId === getUser()?.id) {
      // A new tab, so a video call on this page keeps going.
      const edit = document.createElement('a');
      edit.className = 'btn btn-small profile-edit-link';
      edit.href = '/profile.html';
      edit.target = '_blank';
      edit.textContent = 'Edit your profile';
      win.body.append(edit);
    } else {
      win.body.append(blockControls(userId, displayName, { onBlock, onUnblock, onReport }));
    }
  } catch (err) {
    const error = document.createElement('p');
    error.className = 'profile-window-error';
    error.textContent = `ERR: ${err.message}`;
    win.body.replaceChildren(error);
  }
  return win;
}
