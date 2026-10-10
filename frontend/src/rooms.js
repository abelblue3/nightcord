import './sentry.js';
import './style.css';
import { requireAuth, getUser, listRooms, createRoom } from './api.js';
import { initAvatarMenu } from './avatarMenu.js';
import { renderClosedScreen, watchForClose } from './closedScreen.js';
import { initConsentBanner } from './consentBanner.js';
import { initThemeToggle } from './theme.js';
import { clearFieldError, loadingLine, setBusy, showFieldError } from './ui.js';

init();

async function init() {
  initConsentBanner();

  const roomListEl = document.getElementById('room-list');
  const emptyStateEl = document.getElementById('empty-state');
  const errorBox = document.getElementById('error-box');
  roomListEl.replaceChildren(loadingLine('LOADING ROOMS'));

  if (!(await requireAuth())) return; // already redirecting to the sign-in page

  initThemeToggle(document.getElementById('theme-toggle'));

  const user = getUser();
  initAvatarMenu(document.getElementById('avatar-menu'));

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('visible');
  }

  function renderRooms(rooms) {
    roomListEl.innerHTML = '';
    emptyStateEl.style.display = rooms.length ? 'none' : 'block';

    for (const room of rooms) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'room-item';
      btn.type = 'button';
      btn.innerHTML = `<span class="room-name">${escapeHtml(room.name)}</span><span class="room-arrow">enter &gt;</span>`;
      btn.addEventListener('click', () => {
        window.location.href = `/room.html?id=${room.id}&name=${encodeURIComponent(room.name)}`;
      });
      li.appendChild(btn);
      roomListEl.appendChild(li);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function loadRooms() {
    try {
      const rooms = await listRooms();
      renderRooms(rooms);
      return true;
    } catch (err) {
      if (err.status === 403 && err.data?.timezone) {
        renderClosedScreen(document.querySelector('.screen'), err.data.timezone);
        return false;
      }
      roomListEl.innerHTML = '';
      showError(err.message);
      return true;
    }
  }

  const roomNameInput = document.getElementById('room-name');
  const createBtn = document.getElementById('create-submit');
  roomNameInput.addEventListener('input', () => clearFieldError(roomNameInput));

  document.getElementById('create-room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = roomNameInput.value.trim();
    if (!name) {
      showFieldError(roomNameInput, 'Give your room a name.');
      return;
    }

    const restore = setBusy(createBtn, 'CREATING...');
    try {
      await createRoom(name);
      roomNameInput.value = '';
      clearFieldError(roomNameInput);
      await loadRooms();
    } catch (err) {
      // About this name or this student: show it where they're typing.
      if (err.status === 409 || err.status === 429 || err.status === 422) {
        showFieldError(roomNameInput, err.message);
      } else {
        showError(err.message);
      }
    } finally {
      restore();
    }
  });

  const gateOpen = await loadRooms();
  if (gateOpen && user?.timezone) {
    watchForClose(user.timezone);
  }
}
