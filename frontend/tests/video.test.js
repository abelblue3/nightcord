import { describe, it, expect, beforeEach, vi } from 'vitest';

// LiveKit is replaced with a small fake room that records what the page asks
// of it and lets the test fire its events.
const lk = vi.hoisted(() => {
  const RoomEvent = {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    Disconnected: 'disconnected',
  };
  const state = { room: null, cameraError: null };
  class Room {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.remoteParticipants = new Map();
      this.localTrack = { stop: vi.fn() };
      this.localParticipant = {
        identity: 'me',
        trackPublications: new Map([['mic', { track: this.localTrack }]]),
        setCameraEnabled: vi.fn(async () => {
          if (state.cameraError) throw state.cameraError;
        }),
        setMicrophoneEnabled: vi.fn(async () => {}),
      };
      this.connect = vi.fn(async () => {});
      this.disconnect = vi.fn(() => this.emit(RoomEvent.Disconnected));
      state.room = this;
    }

    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    }

    emit(event, ...args) {
      this.handlers[event]?.(...args);
    }
  }
  return { RoomEvent, Room, state };
});
vi.mock('livekit-client', () => ({ Room: lk.Room, RoomEvent: lk.RoomEvent }));
vi.mock('../src/api.js', () => ({
  getVideoToken: vi.fn(async () => ({ url: 'wss://test.livekit.cloud', token: 'join-token' })),
}));

import { initVideo } from '../src/video.js';

let els;
let onError;

async function join() {
  els.joinButton.click();
  await vi.waitFor(() => expect(els.joinButton.hidden).toBe(true));
  return lk.state.room;
}

function fakeTrack(kind) {
  const element = document.createElement(kind);
  return { kind, element, attach: () => element, detach: () => [element] };
}

const windowOf = (name) => [...els.layer.children].find((w) => w.getAttribute('aria-label') === name);
const ownControl = (label) => windowOf('You').querySelector(`[aria-label="${label}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
  lk.state.room = null;
  lk.state.cameraError = null;
  const joinButton = document.createElement('button');
  document.body.appendChild(joinButton);
  els = { joinButton, showButton: document.createElement('button'), layer: document.createElement('div') };
  document.body.append(els.showButton, els.layer);
  onError = vi.fn();
  initVideo('7', { ...els, onError });
});

describe('the room video call', () => {
  it('shows no call controls until you join', () => {
    expect(els.layer.children).toHaveLength(0);
    expect(document.querySelector('[aria-label="Microphone"]')).toBeNull();
  });

  it('joins with camera and mic off; your window carries mic, camera and leave', async () => {
    const room = await join();

    expect(room.connect).toHaveBeenCalledWith('wss://test.livekit.cloud', 'join-token');
    expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(ownControl('Microphone').getAttribute('aria-pressed')).toBe('false');
    expect(ownControl('Camera').getAttribute('aria-pressed')).toBe('false');
    expect(ownControl('Leave video call')).not.toBeNull();
    expect(windowOf('You').textContent).toContain('Your browser asks first');
  });

  it('switching the mic off releases it (no recording indicator left on)', async () => {
    const room = await join();
    expect(room.options.publishDefaults.stopMicTrackOnMute).toBe(true);
  });

  it('camera and mic each switch only their own device', async () => {
    const room = await join();

    ownControl('Camera').click();
    await vi.waitFor(() => expect(ownControl('Camera').getAttribute('aria-pressed')).toBe('true'));
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();

    ownControl('Microphone').click();
    await vi.waitFor(() => expect(ownControl('Microphone').getAttribute('aria-pressed')).toBe('true'));
    ownControl('Microphone').click();
    await vi.waitFor(() => expect(ownControl('Microphone').getAttribute('aria-pressed')).toBe('false'));
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
  });

  it('explains a blocked camera inside your window, and keeps the switch off', async () => {
    await join();
    lk.state.cameraError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });

    ownControl('Camera').click();

    await vi.waitFor(() => expect(windowOf('You').textContent).toContain('site settings'));
    expect(ownControl('Camera').getAttribute('aria-pressed')).toBe('false');
  });

  it('a tap on your window reveals its controls; a tap elsewhere hides them', async () => {
    await join();

    windowOf('You').click();
    expect(windowOf('You').classList.contains('show-controls')).toBe(true);

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(windowOf('You').classList.contains('show-controls')).toBe(false);
  });

  it('gives others their own window, shaped like their video, removed when they leave', async () => {
    const room = await join();
    const sam = { identity: '2', name: 'Sam' };
    const video = fakeTrack('video');

    room.emit('participantConnected', sam);
    room.emit('trackSubscribed', video, {}, sam);
    expect(windowOf('Sam').querySelectorAll('video')).toHaveLength(1);

    // A phone held upright: 720 wide, 1280 tall.
    Object.defineProperty(video.element, 'videoWidth', { value: 720 });
    Object.defineProperty(video.element, 'videoHeight', { value: 1280 });
    video.element.dispatchEvent(new Event('loadedmetadata'));
    expect(windowOf('Sam').querySelector('.retro-body').style.aspectRatio).toBe('720 / 1280');

    room.emit('participantDisconnected', sam);
    expect(windowOf('Sam')).toBeUndefined();
  });

  it('with the camera off, a window shows the avatar from their join token', async () => {
    const room = await join();
    const photo = 'https://img.clerk.com/sam.png';
    room.emit('participantConnected', { identity: '2', name: 'Sam', metadata: JSON.stringify({ avatar_url: photo }) });
    room.emit('participantConnected', { identity: '3', name: 'Kai', metadata: '' });

    expect(windowOf('Sam').querySelector('.camera-off img').src).toBe(photo);
    expect(windowOf('Kai').querySelector('.camera-off .avatar-pixel')).not.toBeNull();
    expect(windowOf('You').querySelector('.camera-off')).not.toBeNull();
  });

  it('a camera switched off hides its last frame, and shows again when switched on', async () => {
    const room = await join();
    const sam = { identity: '2', name: 'Sam' };
    const video = fakeTrack('video');
    const publication = { kind: 'video', track: { attachedElements: [video.element] } };
    room.emit('participantConnected', sam);
    room.emit('trackSubscribed', video, publication, sam);

    room.emit('trackMuted', publication, sam);
    expect(video.element.hidden).toBe(true);

    room.emit('trackUnmuted', publication, sam);
    expect(video.element.hidden).toBe(false);
  });

  it("× closes someone else's window, and \"Show videos\" brings them back", async () => {
    const room = await join();
    room.emit('participantConnected', { identity: '2', name: 'Sam' });
    room.emit('participantConnected', { identity: '3', name: 'Kai' });

    windowOf('Sam').querySelector('[aria-label="Hide Sam"]').click();
    windowOf('Kai').querySelector('[aria-label="Hide Kai"]').click();
    expect(windowOf('Sam').hidden).toBe(true);
    expect(els.showButton.hidden).toBe(false);
    expect(els.showButton.textContent).toBe('Show videos (2)');

    room.emit('participantDisconnected', { identity: '3', name: 'Kai' });
    expect(els.showButton.textContent).toBe('Show videos (1)');

    els.showButton.click();
    expect(windowOf('Sam').hidden).toBe(false);
    expect(els.showButton.hidden).toBe(true);
  });

  it('× on your own window leaves: devices stopped, page put back as it was', async () => {
    const room = await join();
    room.emit('participantConnected', { identity: '2', name: 'Sam' });
    windowOf('Sam').querySelector('[aria-label="Hide Sam"]').click();

    ownControl('Leave video call').click();

    expect(room.localTrack.stop).toHaveBeenCalled();
    expect(room.disconnect).toHaveBeenCalledWith(true);
    expect(els.joinButton.hidden).toBe(false);
    expect(els.layer.children).toHaveLength(0);
    expect(els.showButton.hidden).toBe(true);
  });

  it('closing or leaving the page also ends the call', async () => {
    const room = await join();
    window.dispatchEvent(new Event('pagehide'));
    expect(room.disconnect).toHaveBeenCalledWith(true);
  });

  it('reports a refused join (e.g. the night gate) to the page', async () => {
    const { getVideoToken } = await import('../src/api.js');
    getVideoToken.mockRejectedValueOnce(Object.assign(new Error('closed'), { status: 403 }));

    els.joinButton.click();

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(els.layer.children).toHaveLength(0);
  });
});
