import './style.css';
import { requireAuth, getUser, clearSession, getRoomMessages, connectRoomSocket } from './api.js';
import { isNightTime } from './nightGate.js';
import { renderClosedScreen, watchForClose } from './closedScreen.js';

if (!requireAuth()) {
  // requireAuth already redirected to /index.html
} else if (!isNightTime()) {
  renderClosedScreen(document.querySelector('.screen'));
} else {
  init();
}

async function init() {
  watchForClose();

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('id');
  const roomName = params.get('name') || 'room';

  if (!roomId) {
    window.location.href = '/rooms.html';
    return;
  }

  document.getElementById('room-title').textContent = roomName.toUpperCase();

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearSession();
    window.location.href = '/index.html';
  });

  const chatLog = document.getElementById('chat-log');
  const errorBox = document.getElementById('error-box');
  const statusEl = document.getElementById('connection-status');
  const currentUser = getUser();

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('visible');
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = `connection-status ${cls}`;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function appendMessage({ display_name, content, created_at, user_id }) {
    const wrap = document.createElement('div');
    wrap.className = 'msg' + (currentUser && user_id === currentUser.id ? ' own' : '');

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = display_name || 'someone';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = formatTime(created_at);
    meta.appendChild(nameSpan);
    meta.appendChild(timeSpan);

    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = content;

    wrap.appendChild(meta);
    wrap.appendChild(body);
    chatLog.appendChild(wrap);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function loadHistory() {
    try {
      const messages = await getRoomMessages(roomId);
      for (const msg of messages) appendMessage(msg);
    } catch (err) {
      showError(err.message);
    }
  }

  let socket;

  function connect() {
    socket = connectRoomSocket(roomId);

    socket.addEventListener('open', () => setStatus('connected', 'connected'));

    socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      appendMessage(data);
    });

    socket.addEventListener('close', () => setStatus('disconnected', 'disconnected'));

    socket.addEventListener('error', () => setStatus('connection error', 'disconnected'));
  }

  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = chatInput.value.trim();
    if (!content || socket?.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({ content }));
    chatInput.value = '';
  });

  await loadHistory();
  connect();
}
