import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startDelete } from '../src/messageDelete.js';

let log;

function message(id) {
  const msg = document.createElement('div');
  msg.className = 'msg own';
  msg.dataset.messageId = id;
  msg.textContent = `message ${id}`;
  log.append(msg);
  return msg;
}

const undoLine = (msg) => msg.querySelector('.msg-undo');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="log"></div>';
  log = document.getElementById('log');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deleting your own message', () => {
  it('fades the message and counts down from 10', async () => {
    const msg = message(1);
    startDelete(msg, { send: vi.fn(async () => {}) });

    expect(msg.classList.contains('msg-deleting')).toBe(true);
    expect(undoLine(msg).textContent).toContain('Deleting in 10');
    await vi.advanceTimersByTimeAsync(3000);
    expect(undoLine(msg).textContent).toContain('Deleting in 7');
  });

  it('Undo brings it back and never sends', async () => {
    const msg = message(1);
    const send = vi.fn(async () => {});
    const onDone = vi.fn();
    startDelete(msg, { send, onDone });

    await vi.advanceTimersByTimeAsync(4000);
    undoLine(msg).querySelector('button').click();
    await vi.advanceTimersByTimeAsync(20000);

    expect(send).not.toHaveBeenCalled();
    expect(msg.isConnected).toBe(true);
    expect(msg.classList.contains('msg-deleting')).toBe(false);
    expect(undoLine(msg)).toBeNull();
    expect(onDone).toHaveBeenCalled();
  });

  it('sends once at 0, then removes the message', async () => {
    const msg = message(1);
    const send = vi.fn(async () => {});
    startDelete(msg, { send });

    await vi.advanceTimersByTimeAsync(9000);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ keepalive: false });
    expect(msg.isConnected).toBe(false);
  });

  it('brings it back with the error if deleting fails', async () => {
    const msg = message(1);
    startDelete(msg, {
      send: vi.fn(async () => {
        throw new Error('Too many requests.');
      }),
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(msg.isConnected).toBe(true);
    expect(msg.classList.contains('msg-deleting')).toBe(false);
    expect(msg.textContent).toContain('ERR: Too many requests.');
  });

  it('sendNow() deletes straight away (when leaving the page)', async () => {
    const msg = message(1);
    const send = vi.fn(async () => {});
    const pending = startDelete(msg, { send });

    pending.sendNow();
    await vi.advanceTimersByTimeAsync(20000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ keepalive: true });
  });

  it('keeps two countdowns apart', async () => {
    const first = message(1);
    const second = message(2);
    const sendFirst = vi.fn(async () => {});
    const sendSecond = vi.fn(async () => {});
    startDelete(first, { send: sendFirst });
    await vi.advanceTimersByTimeAsync(5000);
    startDelete(second, { send: sendSecond });

    undoLine(second).querySelector('button').click();
    await vi.advanceTimersByTimeAsync(5000);

    expect(sendFirst).toHaveBeenCalledTimes(1);
    expect(sendSecond).not.toHaveBeenCalled();
    expect(second.isConnected).toBe(true);
  });
});
