import { getVideoToken } from './api.js';
import { renderAvatar } from './avatar.js';
import { createWindow } from './floatingWindow.js';
import { setBusy } from './ui.js';

// A room's video call, next to its chat. LiveKit carries the video and audio;
// nightcord's backend only hands out the join token (signed in, night at your
// school). The LiveKit library is downloaded only when someone joins.
//
// Everyone gets a draggable, resizable window. Your own ("You") carries the
// call controls -- mic, camera, and × to leave -- shown when you point at it
// or tap it. Camera and mic start off; the browser asks permission the first
// time each is switched on, and nothing is shared until it's allowed.

const DEVICE_HELP = {
  NotAllowedError: (device) =>
    `Your browser is blocking the ${device}. Allow it for this site in your browser's site settings, then switch it on again.`,
  NotFoundError: (device) => `No ${device} found on this device.`,
  NotReadableError: (device) => `Another app is using the ${device}. Close it and try again.`,
};

const CAMERA_HINT = 'Click the camera to share. Your browser asks first.';

// 12x12 pixel-art icons; the slash shows while the device is off (style.css).
const PIXEL_ICON = {
  microphone: `<rect x="5" y="0" width="2" height="1"/><rect x="4" y="1" width="4" height="5"/>
    <rect x="2" y="4" width="1" height="2"/><rect x="9" y="4" width="1" height="2"/>
    <rect x="3" y="6" width="1" height="1"/><rect x="8" y="6" width="1" height="1"/>
    <rect x="4" y="7" width="4" height="1"/><rect x="5" y="8" width="2" height="2"/>
    <rect x="3" y="10" width="6" height="1"/>`,
  camera: `<rect x="0" y="3" width="8" height="6"/><rect x="8" y="5" width="1" height="2"/>
    <rect x="9" y="4" width="1" height="4"/><rect x="10" y="3" width="2" height="6"/>`,
};

// A one-pixel diagonal from corner to corner.
const SLASH = Array.from({ length: 12 }, (_, i) => `<rect x="${i}" y="${i}" width="1" height="1"/>`).join('');

// What a window shows while there's no picture: the person's avatar (from
// their join token's metadata) over "camera off".
function cameraOffCard(participant) {
  let avatarUrl = null;
  try {
    avatarUrl = JSON.parse(participant.metadata || '{}').avatar_url ?? null;
  } catch {
    // no metadata: the pixel avatar
  }
  const card = document.createElement('div');
  card.className = 'camera-off';
  const caption = document.createElement('span');
  caption.className = 'camera-off-caption';
  caption.textContent = 'camera off';
  card.append(renderAvatar({ avatarUrl, userId: Number(participant.identity), size: 48 }), caption);
  return card;
}

function deviceButton(device) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'retro-title-button self-control';
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', device === 'camera' ? 'Camera' : 'Microphone');
  button.title = button.getAttribute('aria-label');
  button.innerHTML = `<svg class="device-icon" viewBox="0 0 12 12" width="12" height="12" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
    ${PIXEL_ICON[device]}<g class="device-slash">${SLASH}</g>
  </svg>`;
  return button;
}

export function initVideo(roomId, { joinButton, layer, taskbar, onError, onCallChange = () => {} }) {
  let room = null;
  // participant identity -> their window, plus its taskbar button while hidden
  const windows = new Map();
  let notice = null; // the hint / help line in your own window

  function setNotice(text) {
    if (notice) notice.textContent = text;
  }

  function leave() {
    if (!room) return;
    // Belt and braces: stop the camera and mic here as well as in disconnect,
    // so no device stays on after leaving.
    for (const publication of room.localParticipant.trackPublications.values()) publication.track?.stop();
    room.disconnect(true);
  }

  // Others' windows: × hides one for you only -- their audio keeps playing,
  // and their taskbar button brings it back.
  function hideToTaskbar(entry) {
    entry.taskbarButton = document.createElement('button');
    entry.taskbarButton.type = 'button';
    entry.taskbarButton.className = 'taskbar-button';
    entry.taskbarButton.textContent = entry.win.title;
    entry.taskbarButton.addEventListener('click', () => {
      entry.win.show();
      entry.taskbarButton.remove();
    });
    taskbar.appendChild(entry.taskbarButton);
  }

  function ownWindow() {
    const micButton = deviceButton('microphone');
    const cameraButton = deviceButton('camera');
    const win = createWindow({
      title: 'You',
      resize: 'aspect',
      extraButtons: [micButton, cameraButton],
      close: { label: 'Leave video call', action: leave },
    });
    notice = document.createElement('p');
    notice.className = 'window-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = CAMERA_HINT;
    win.body.append(notice);

    // Phones have no hover: a tap on your window shows its controls, a tap
    // anywhere else hides them again.
    win.element.addEventListener('click', () => win.element.classList.add('show-controls'));
    document.addEventListener('pointerdown', (event) => {
      if (!win.element.contains(event.target)) win.element.classList.remove('show-controls');
    });

    deviceSwitch(micButton, 'microphone', (participant, on) => participant.setMicrophoneEnabled(on));
    deviceSwitch(cameraButton, 'camera', (participant, on) => participant.setCameraEnabled(on), (on) =>
      setNotice(on ? '' : CAMERA_HINT),
    );
    return win;
  }

  function windowFor(participant, own = false) {
    let entry = windows.get(participant.identity);
    if (!entry) {
      entry = {};
      entry.win = own
        ? ownWindow()
        : createWindow({
            title: participant.name || 'someone',
            resize: 'aspect',
            onHide: () => hideToTaskbar(entry),
          });
      entry.win.body.append(cameraOffCard(participant));
      layer.appendChild(entry.win.element);
      windows.set(participant.identity, entry);
    }
    return entry.win;
  }

  function removeWindow(participant) {
    const entry = windows.get(participant.identity);
    entry?.win.remove();
    entry?.taskbarButton?.remove();
    windows.delete(participant.identity);
  }

  function attach(track, participant, own = false) {
    const element = track.attach();
    const win = windowFor(participant, own);
    if (track.kind === 'audio') {
      element.hidden = true;
    } else {
      // The window takes the camera's real shape (wide, or tall on a phone
      // held upright), so the picture is never stretched or cropped.
      const fit = () => win.setAspectRatio(element.videoWidth, element.videoHeight);
      element.addEventListener('loadedmetadata', fit);
      element.addEventListener('resize', fit);
      element.hidden = Boolean(track.isMuted);
    }
    win.body.prepend(element);
  }

  function detach(track) {
    for (const element of track.detach()) element.remove();
  }

  // A camera switched off is muted, not removed: hide its last frame so the
  // avatar shows instead.
  function showPicture(publication, shown) {
    if (publication.kind !== 'video') return;
    for (const element of publication.track?.attachedElements ?? []) element.hidden = !shown;
  }

  function reset() {
    room = null;
    notice = null;
    windows.clear();
    layer.replaceChildren();
    taskbar.replaceChildren();
    joinButton.hidden = false;
    onCallChange(false);
  }

  function deviceSwitch(button, device, setEnabled, afterChange) {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!room) return;
      const on = button.getAttribute('aria-pressed') !== 'true';
      setNotice('');
      try {
        await setEnabled(room.localParticipant, on);
        button.setAttribute('aria-pressed', String(on));
        afterChange?.(on);
      } catch (err) {
        button.setAttribute('aria-pressed', 'false');
        const help = DEVICE_HELP[err.name];
        setNotice(help ? help(device) : `Couldn't switch on the ${device}.`);
      }
    });
  }

  joinButton.addEventListener('click', async () => {
    const restore = setBusy(joinButton, 'JOINING...');
    try {
      const { url, token } = await getVideoToken(roomId);
      const { Room, RoomEvent } = await import('livekit-client');
      // stopMicTrackOnMute: switching the mic off releases it, so the
      // browser's "recording" indicator goes away (LiveKit only mutes it by
      // default; the camera is already released when switched off).
      room = new Room({ publishDefaults: { stopMicTrackOnMute: true } });
      room
        .on(RoomEvent.ParticipantConnected, (participant) => windowFor(participant))
        .on(RoomEvent.ParticipantDisconnected, removeWindow)
        .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attach(track, participant))
        .on(RoomEvent.TrackUnsubscribed, detach)
        // Your own camera shows in your window; your own mic isn't played back.
        .on(RoomEvent.LocalTrackPublished, (publication, participant) => {
          if (publication.track.kind === 'video') attach(publication.track, participant, true);
        })
        .on(RoomEvent.LocalTrackUnpublished, (publication) => detach(publication.track))
        .on(RoomEvent.TrackMuted, (publication) => showPicture(publication, false))
        .on(RoomEvent.TrackUnmuted, (publication) => showPicture(publication, true))
        .on(RoomEvent.Disconnected, reset);
      await room.connect(url, token);
      windowFor(room.localParticipant, true);
      for (const participant of room.remoteParticipants.values()) windowFor(participant);
      joinButton.hidden = true;
      onCallChange(true);
    } catch (err) {
      room = null;
      onError(err);
    } finally {
      restore();
    }
  });

  // Closing the tab or navigating away also ends the call and frees the devices.
  window.addEventListener('pagehide', leave);

  return {
    // For the chat page: 6am or a sign-out ends the call with the chat.
    leave,
  };
}
