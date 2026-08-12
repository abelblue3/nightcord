import './sentry.js';
import './style.css';
import { requireAuth, getUser, clearSession, listRooms, createRoom } from './api.js';
import { renderClosedScreen, watchForClose } from './closedScreen.js';
import { initThemeToggle } from './theme.js';

if (requireAuth()) {
  init();
}
// else: requireAuth already redirected to /index.html

async function init() {
  initThemeToggle(document.getElementById('theme-toggle'));

  const user = getUser();
  document.getElementById('user-tag').textContent = user?.display_name ? `hi, ${user.display_name}` : '';

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearSession();
    window.location.href = '/index.html';
  });

  const roomListEl = document.getElementById('room-list');
  const emptyStateEl = document.getElementById('empty-state');
  const errorBox = document.getElementById('error-box');

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
      showError(err.message);
      return true;
    }
  }

  document.getElementById('create-room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('room-name');
    const submitBtn = document.getElementById('create-submit');
    submitBtn.disabled = true;

    try {
      await createRoom(input.value.trim());
      input.value = '';
      await loadRooms();
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  const gateOpen = await loadRooms();
  if (gateOpen && user?.timezone) {
    watchForClose(user.timezone);
  }
}
