import './sentry.js';
import './style.css';
import { requireAuth, getUser, signOut, getRoomMessages, connectRoomSocket, listBlocks, blockStudent } from './api.js';
import { renderClosedScreen, watchForClose } from './closedScreen.js';
import { initConsentBanner } from './consentBanner.js';
import { getTheme, initThemeToggle } from './theme.js';
import { initContextMenu } from './contextMenu.js';
import { roomMenuItems } from './roomMenu.js';
import { initAvatarMenu } from './avatarMenu.js';
import { renderMessage } from './chatMessage.js';
import { createWindow } from './floatingWindow.js';
import { openProfilePopup } from './profilePopup.js';
import { loadingLine, setBusy } from './ui.js';
import { initVideo } from './video.js';

init();

// The chat lives in a Win95-style window like the video ones. It opens right
// where the chat sits in the page (which keeps its space). × closes it, and
// "Open chat" beside "Join video" brings it back, counting the messages that
// arrived meanwhile.
function openChatWindow(title, openButton) {
  const content = document.getElementById('chat-content');
  const spot = content.getBoundingClientRect();
  let unread = 0;
  const label = () => (unread ? `Open chat (${unread})` : 'Open chat');

  const win = createWindow({
    title,
    className: 'chat-window',
    resize: 'free',
    at: { left: spot.left, top: spot.top },
    onHide: () => {
      openButton.textContent = label();
      openButton.hidden = false;
    },
  });

  openButton.addEventListener('click', () => {
    win.show();
    openButton.hidden = true;
    unread = 0;
  });

  const placeholder = document.createElement('div');
  content.replaceWith(placeholder);
  win.body.appendChild(content);
  document.querySelector('.screen').appendChild(win.element);
  placeholder.style.height = `${win.element.offsetHeight}px`;

  return {
    isHidden: () => win.element.hidden,
    open: () => openButton.click(),
    noteMessage() {
      if (!win.element.hidden) return;
      unread += 1;
      openButton.textContent = label();
    },
  };
}

async function init() {
  initConsentBanner();

  const historyLoading = loadingLine('LOADING MESSAGES');
  document.getElementById('chat-log').appendChild(historyLoading);

  if (!(await requireAuth())) return; // already redirecting to the sign-in page

  initThemeToggle(document.getElementById('theme-toggle'));

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('id');
  const roomName = params.get('name') || 'room';

  // Room ids are numbers; anything else came from a hand-made link.
  if (!/^\d+$/.test(roomId ?? '')) {
    window.location.href = '/rooms.html';
    return;
  }

  document.getElementById('room-title').textContent = roomName.toUpperCase();

  const chatWindow = openChatWindow(roomName.toUpperCase(), document.getElementById('chat-open'));

  const avatarMenu = initAvatarMenu(document.getElementById('avatar-menu'));

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

  // Students you've blocked. The backend already leaves out their messages;
  // the page also hides their video and clears what's on screen when you
  // block someone. If the list can't load, nothing extra is hidden.
  const blocked = new Set((await listBlocks().catch(() => [])).map((student) => student.id));

  const blockHandlers = {
    onBlock(userId) {
      blocked.add(userId);
      for (const msg of chatLog.querySelectorAll(`.msg[data-user-id="${userId}"]`)) msg.remove();
      video.hide(userId);
    },
    onUnblock(userId) {
      blocked.delete(userId);
      video.show(userId);
    },
  };

  const showMessage = (msg) =>
    renderMessage(msg, {
      currentUser,
      onOpenProfile: (userId, name, at) => openProfilePopup(userId, name, at, blockHandlers),
    });

  // The newest message shown, so a reconnect can fetch what came after it.
  let newestMessageId = null;

  // Returns false for a message that's already shown.
  function appendMessage(msg) {
    if (newestMessageId !== null && msg.id <= newestMessageId) return false;
    newestMessageId = msg.id;
    chatLog.appendChild(showMessage(msg));
    chatLog.scrollTop = chatLog.scrollHeight;
    return true;
  }

  function receiveMessage(msg) {
    if (appendMessage(msg)) chatWindow.noteMessage();
  }

  // History arrives a page at a time (newest page first). A full page means
  // there may be older messages, so the "Load earlier" button stays.
  const HISTORY_PAGE_SIZE = 50;
  const loadEarlierBtn = document.getElementById('load-earlier');
  let oldestMessageId = null;

  function showOrHideLoadEarlier(page) {
    if (page.length) oldestMessageId = page[0].id;
    loadEarlierBtn.hidden = page.length < HISTORY_PAGE_SIZE;
  }

  function handleHistoryError(err) {
    if (err.status === 403 && err.data?.timezone) {
      renderClosedScreen(document.querySelector('.screen'), err.data.timezone);
    } else {
      showError(err.message);
    }
  }

  // Message history is gated the same way room listing is -- this doubles
  // as the "is the gate actually open" check before we even try the socket.
  async function loadHistory() {
    try {
      const messages = await getRoomMessages(roomId);
      historyLoading.remove();
      for (const msg of messages) appendMessage(msg);
      showOrHideLoadEarlier(messages);
      return true;
    } catch (err) {
      historyLoading.remove();
      handleHistoryError(err);
      return false;
    }
  }

  loadEarlierBtn.addEventListener('click', async () => {
    const restore = setBusy(loadEarlierBtn, 'LOADING...');
    try {
      const older = await getRoomMessages(roomId, { before: oldestMessageId });
      // Insert above what's shown without moving what the reader is looking at.
      const heightBefore = chatLog.scrollHeight;
      const fragment = document.createDocumentFragment();
      for (const msg of older) fragment.appendChild(showMessage(msg));
      loadEarlierBtn.after(fragment);
      chatLog.scrollTop += chatLog.scrollHeight - heightBefore;
      showOrHideLoadEarlier(older);
    } catch (err) {
      handleHistoryError(err);
    } finally {
      restore();
    }
  });

  let inVideoCall = false;
  const video = initVideo(roomId, {
    joinButton: document.getElementById('video-join'),
    layer: document.getElementById('video-layer'),
    showButton: document.getElementById('videos-show'),
    onError: handleHistoryError, // the same closed-screen / error-box handling
    onCallChange: (inCall) => {
      inVideoCall = inCall;
      avatarMenu.setInCall(inCall);
    },
    isBlocked: (identity) => blocked.has(Number(identity)), // LiveKit identity = user id
  });

  // Right-click anywhere in the room: a retro menu in place of the browser's.
  initContextMenu(document.querySelector('.screen'), (target) =>
    roomMenuItems(target, {
      currentUserId: currentUser?.id,
      lampOn: () => getTheme() === 'lamp',
      chatHidden: chatWindow.isHidden,
      hiddenVideos: video.hiddenCount,
      inCall: () => inVideoCall,
      actions: {
        viewProfile: (userId, name, at) => openProfilePopup(userId, name, at, blockHandlers),
        copy: (text) => navigator.clipboard?.writeText(text),
        block: (userId) =>
          blockStudent(userId)
            .then(() => blockHandlers.onBlock(userId))
            .catch((err) => showError(err.message)),
        lamp: () => document.getElementById('theme-toggle').click(),
        openChat: chatWindow.open,
        showVideos: () => document.getElementById('videos-show').click(),
        myProfile: () => window.open('/profile.html', '_blank'), // a new tab keeps a call going
        logOut: signOut,
      },
    }),
  );

  let socket;
  let reconnectTimer = null;
  // Live messages held back while catching up, so they land after the ones
  // they followed.
  let heldMessages = null;

  // Reconnects after a dropped connection (network blip, server restart, or
  // the server cutting off a flood of messages).
  function scheduleReconnect(delayMs) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect({ reconnecting: true });
    }, delayMs);
  }

  // Fetches what was sent while the socket was down.
  async function catchUp() {
    heldMessages = [];
    try {
      let page;
      do {
        page = await getRoomMessages(roomId, { after: newestMessageId });
        for (const msg of page) receiveMessage(msg);
      } while (page.length === HISTORY_PAGE_SIZE);
    } catch (err) {
      handleHistoryError(err);
    } finally {
      for (const msg of heldMessages) receiveMessage(msg);
      heldMessages = null;
    }
  }

  async function connect({ reconnecting = false } = {}) {
    setStatus('connecting…', '');
    socket = await connectRoomSocket(roomId);

    socket.addEventListener('open', () => {
      setStatus('connected', 'connected');
      if (reconnecting) catchUp();
    });

    socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (heldMessages) heldMessages.push(data);
      else receiveMessage(data);
    });

    socket.addEventListener('close', (event) => {
      const gateClosedMatch = /^gate-closed:(.+)$/.exec(event.reason || '');
      if (gateClosedMatch) {
        video.leave();
        renderClosedScreen(document.querySelector('.screen'), gateClosedMatch[1]);
        return;
      }
      if (event.reason === 'unauthorized') {
        // The session ended (e.g. "log out of all devices" elsewhere).
        video.leave();
        signOut();
        return;
      }
      if (event.reason === 'rate-limited') {
        setStatus('you’re sending messages too fast — wait a moment', 'disconnected');
        scheduleReconnect(5000);
        return;
      }
      setStatus('disconnected — reconnecting…', 'disconnected');
      scheduleReconnect(3000);
    });

    socket.addEventListener('error', () => setStatus('connection error', 'disconnected'));
  }

  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = chatInput.value.trim();
    if (!content) return;
    if (socket?.readyState !== WebSocket.OPEN) {
      // Keep what they typed; say why it didn't send.
      setStatus('not connected — reconnecting…', 'disconnected');
      if (!socket || socket.readyState === WebSocket.CLOSED) scheduleReconnect(0);
      return;
    }

    socket.send(JSON.stringify({ content }));
    chatInput.value = '';
  });

  const gateOpen = await loadHistory();
  if (gateOpen) {
    await connect();
    if (currentUser?.timezone) {
      watchForClose(currentUser.timezone);
    }
  }
}
