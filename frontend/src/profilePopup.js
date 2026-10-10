import { getProfile, getUser } from './api.js';
import { createWindow } from './floatingWindow.js';
import { renderProfileCard } from './profileCard.js';
import { loadingLine } from './ui.js';

// Someone's profile in a read-only Win95-style window, opened from chat. One
// window per person: opening them again brings theirs to the front.

const open = new Map(); // user id -> window

export async function openProfilePopup(userId, displayName, at) {
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
    }
  } catch (err) {
    const error = document.createElement('p');
    error.className = 'profile-window-error';
    error.textContent = `ERR: ${err.message}`;
    win.body.replaceChildren(error);
  }
  return win;
}
