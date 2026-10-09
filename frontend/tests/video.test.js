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
    Disconnected: 'disconnected',
  };
  const state = { room: null, cameraError: null };
  class Room {
    constructor() {
      this.handlers = {};
      this.remoteParticipants = new Map();
      this.localParticipant = {
        identity: 'me',
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

function button(id) {
  const el = document.createElement('button');
  el.id = id;
  el.setAttribute('aria-pressed', 'false');
  document.body.appendChild(el);
  return el;
}

async function join() {
  els.joinButton.click();
  await vi.waitFor(() => expect(els.panel.hidden).toBe(false));
  return lk.state.room;
}

function fakeTrack(kind) {
  const element = document.createElement(kind);
  return { kind, attach: () => element, detach: () => [element] };
}

beforeEach(() => {
  document.body.innerHTML = '';
  lk.state.room = null;
  lk.state.cameraError = null;
  const panel = document.createElement('section');
  panel.hidden = true;
  els = {
    joinButton: button('join'),
    panel,
    grid: document.createElement('div'),
    cameraButton: button('camera'),
    micButton: button('mic'),
    leaveButton: button('leave'),
    notice: document.createElement('p'),
  };
  onError = vi.fn();
  initVideo('7', { ...els, onError });
});

describe('the room video call', () => {
  it('joins with camera and mic off, showing your own tile', async () => {
    const room = await join();

    expect(room.connect).toHaveBeenCalledWith('wss://test.livekit.cloud', 'join-token');
    expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(els.grid.textContent).toContain('You');
    expect(els.joinButton.hidden).toBe(true);
  });

  it('adds and removes a tile as others come and go, with their video', async () => {
    const room = await join();
    const sam = { identity: '2', name: 'Sam' };

    room.emit('participantConnected', sam);
    room.emit('trackSubscribed', fakeTrack('video'), {}, sam);
    expect(els.grid.textContent).toContain('Sam');
    expect(els.grid.querySelectorAll('video')).toHaveLength(1);

    room.emit('participantDisconnected', sam);
    expect(els.grid.textContent).not.toContain('Sam');
  });

  it('camera and mic are switches that only ask for their own device', async () => {
    const room = await join();

    els.cameraButton.click();
    await vi.waitFor(() => expect(els.cameraButton.getAttribute('aria-pressed')).toBe('true'));
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();

    els.cameraButton.click();
    await vi.waitFor(() => expect(els.cameraButton.getAttribute('aria-pressed')).toBe('false'));
    expect(room.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(false);
  });

  it('explains how to allow a blocked camera, and keeps the switch off', async () => {
    await join();
    lk.state.cameraError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });

    els.cameraButton.click();

    await vi.waitFor(() => expect(els.notice.textContent).toContain('site settings'));
    expect(els.cameraButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('leaving disconnects and puts the page back as it was', async () => {
    const room = await join();

    els.leaveButton.click();

    expect(room.disconnect).toHaveBeenCalled();
    expect(els.panel.hidden).toBe(true);
    expect(els.joinButton.hidden).toBe(false);
    expect(els.grid.children).toHaveLength(0);
  });

  it('reports a refused join (e.g. the night gate) to the page', async () => {
    const { getVideoToken } = await import('../src/api.js');
    getVideoToken.mockRejectedValueOnce(Object.assign(new Error('closed'), { status: 403 }));

    els.joinButton.click();

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(els.panel.hidden).toBe(true);
  });
});
