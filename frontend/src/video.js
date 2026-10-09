import { getVideoToken } from './api.js';
import { setBusy } from './ui.js';

// A room's video call, next to its chat. LiveKit carries the video and audio;
// nightcord's backend only hands out the join token (signed in, night at your
// school). The LiveKit library is downloaded only when someone joins.
//
// Camera and mic start off. The browser asks permission the first time each
// is switched on -- never before -- and nothing is shared until it's allowed.

const DEVICE_HELP = {
  NotAllowedError: (device) =>
    `Your browser is blocking the ${device}. Allow it for this site in your browser's site settings, then switch it on again.`,
  NotFoundError: (device) => `No ${device} found on this device.`,
  NotReadableError: (device) => `Another app is using the ${device}. Close it and try again.`,
};

export function initVideo(roomId, { joinButton, panel, grid, cameraButton, micButton, leaveButton, notice, onError }) {
  let room = null;
  const tiles = new Map(); // participant identity -> tile

  function tileFor(participant, label) {
    let tile = tiles.get(participant.identity);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile';
      const name = document.createElement('span');
      name.className = 'video-name';
      name.textContent = label || participant.name || 'someone';
      tile.appendChild(name);
      grid.appendChild(tile);
      tiles.set(participant.identity, tile);
    }
    return tile;
  }

  function removeTile(participant) {
    tiles.get(participant.identity)?.remove();
    tiles.delete(participant.identity);
  }

  function attach(track, participant, label) {
    const element = track.attach();
    if (track.kind === 'audio') element.hidden = true;
    tileFor(participant, label).prepend(element);
  }

  function detach(track) {
    for (const element of track.detach()) element.remove();
  }

  function reset() {
    room = null;
    tiles.clear();
    grid.replaceChildren();
    panel.hidden = true;
    joinButton.hidden = false;
    cameraButton.setAttribute('aria-pressed', 'false');
    micButton.setAttribute('aria-pressed', 'false');
    notice.textContent = '';
  }

  joinButton.addEventListener('click', async () => {
    const restore = setBusy(joinButton, 'JOINING...');
    try {
      const { url, token } = await getVideoToken(roomId);
      const { Room, RoomEvent } = await import('livekit-client');
      room = new Room();
      room
        .on(RoomEvent.ParticipantConnected, (participant) => tileFor(participant))
        .on(RoomEvent.ParticipantDisconnected, removeTile)
        .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attach(track, participant))
        .on(RoomEvent.TrackUnsubscribed, detach)
        // Your own camera shows in your tile; your own mic isn't played back.
        .on(RoomEvent.LocalTrackPublished, (publication, participant) => {
          if (publication.track.kind === 'video') attach(publication.track, participant, 'You');
        })
        .on(RoomEvent.LocalTrackUnpublished, (publication) => detach(publication.track))
        .on(RoomEvent.Disconnected, reset);
      await room.connect(url, token);
      tileFor(room.localParticipant, 'You');
      for (const participant of room.remoteParticipants.values()) tileFor(participant);
      joinButton.hidden = true;
      panel.hidden = false;
    } catch (err) {
      room = null;
      onError(err);
    } finally {
      restore();
    }
  });

  function deviceSwitch(button, device, setEnabled) {
    button.addEventListener('click', async () => {
      if (!room) return;
      const on = button.getAttribute('aria-pressed') !== 'true';
      notice.textContent = '';
      try {
        await setEnabled(room.localParticipant, on);
        button.setAttribute('aria-pressed', String(on));
      } catch (err) {
        button.setAttribute('aria-pressed', 'false');
        const help = DEVICE_HELP[err.name];
        notice.textContent = help ? help(device) : `Couldn't switch on the ${device}.`;
      }
    });
  }

  deviceSwitch(cameraButton, 'camera', (participant, on) => participant.setCameraEnabled(on));
  deviceSwitch(micButton, 'microphone', (participant, on) => participant.setMicrophoneEnabled(on));
  leaveButton.addEventListener('click', () => room?.disconnect());

  return {
    // For the chat page: 6am or a sign-out ends the call with the chat.
    leave: () => room?.disconnect(),
  };
}
