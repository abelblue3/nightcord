import { describe, it, expect, beforeEach, vi } from 'vitest';
import { roomMenuItems } from '../src/roomMenu.js';

let ctx;

function message(userId, name, text, messageId = 55) {
  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.dataset.userId = userId;
  msg.dataset.messageId = messageId;
  msg.innerHTML = '<button class="msg-author"></button><div class="msg-body"></div>';
  msg.querySelector('.msg-author').textContent = name;
  msg.querySelector('.msg-body').textContent = text;
  document.body.append(msg);
  return msg;
}

const labels = (items) => items.map((item) => item.label);

beforeEach(() => {
  document.body.innerHTML = '<p class="spot"></p>';
  ctx = {
    currentUserId: 1,
    lampOn: () => false,
    chatHidden: () => false,
    hiddenVideos: () => 0,
    inCall: () => false,
    actions: {
      viewProfile: vi.fn(),
      copy: vi.fn(),
      block: vi.fn(),
      report: vi.fn(),
      deleteMessage: vi.fn(),
      lamp: vi.fn(),
      openChat: vi.fn(),
      showVideos: vi.fn(),
      myProfile: vi.fn(),
      logOut: vi.fn(),
    },
  };
});

describe("the room's right-click menu", () => {
  it("offers profile, copy, report and block on someone else's message", () => {
    const msg = message(2, 'night_owl', 'anyone up?');
    const items = roomMenuItems(msg.querySelector('.msg-body'), ctx);

    expect(labels(items)).toEqual(['View profile', 'Copy message', 'Report night_owl…', 'Block night_owl']);
    expect(items[3].confirmLabel).toBe('Sure? Block night_owl');

    items.forEach((item) => item.action());
    expect(ctx.actions.viewProfile.mock.calls[0].slice(0, 2)).toEqual([2, 'night_owl']);
    expect(ctx.actions.copy).toHaveBeenCalledWith('anyone up?');
    expect(ctx.actions.report).toHaveBeenCalledWith(2, 'night_owl', 55); // with the message
    expect(ctx.actions.block).toHaveBeenCalledWith(2);
  });

  it('offers Delete, not Report or Block, on your own message', () => {
    const msg = message(1, 'me_myself', 'hi');
    const items = roomMenuItems(msg, ctx);

    expect(labels(items)).toEqual(['View profile', 'Copy message', 'Delete message']);
    items[2].action();
    expect(ctx.actions.deleteMessage).toHaveBeenCalledWith(msg);
  });

  it('offers the room actions anywhere else', () => {
    expect(labels(roomMenuItems(document.querySelector('.spot'), ctx))).toEqual(['Lamp on', 'My profile', 'Log out']);
  });

  it('names Lamp by what it will do, and offers chat and videos only when they are closed', () => {
    ctx.lampOn = () => true;
    ctx.chatHidden = () => true;
    ctx.hiddenVideos = () => 2;

    expect(labels(roomMenuItems(document.querySelector('.spot'), ctx))).toEqual([
      'Lamp off',
      'Open chat',
      'Show videos (2)',
      'My profile',
      'Log out',
    ]);
  });

  it('greys out Log out during a video call', () => {
    ctx.inCall = () => true;
    const logOut = roomMenuItems(document.querySelector('.spot'), ctx).find((item) => item.label === 'Log out');
    expect(logOut.disabled).toBe(true);
  });
});
