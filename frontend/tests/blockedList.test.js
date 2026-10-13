import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderBlockedList } from '../src/blockedList.js';

let list;

beforeEach(() => {
  document.body.innerHTML = '<ul id="blocked-list"></ul>';
  list = document.getElementById('blocked-list');
});

describe('the blocked students list in Settings', () => {
  it('says so when nobody is blocked', () => {
    renderBlockedList(list, [], { unblock: vi.fn() });
    expect(list.textContent).toBe("You haven't blocked anyone.");
  });

  it('lists each blocked student with an Unblock button', () => {
    renderBlockedList(list, [{ id: 4, display_name: 'loud_owl', avatar_url: null }], { unblock: vi.fn() });

    expect(list.querySelector('.blocked-name').textContent).toBe('loud_owl');
    expect(list.querySelector('.avatar-pixel')).not.toBeNull();
    expect(list.querySelector('button').getAttribute('aria-label')).toBe('Unblock loud_owl');
  });

  it('removes a student once unblocked, then shows the empty note', async () => {
    const unblock = vi.fn(async () => ({}));
    renderBlockedList(list, [{ id: 4, display_name: 'loud_owl', avatar_url: null }], { unblock });

    list.querySelector('button').click();

    await vi.waitFor(() => expect(list.textContent).toBe("You haven't blocked anyone."));
    expect(unblock).toHaveBeenCalledWith(4);
  });

  it('keeps the student listed and says why if unblocking fails', async () => {
    const unblock = vi.fn(async () => {
      throw new Error('Too many requests.');
    });
    renderBlockedList(list, [{ id: 4, display_name: 'loud_owl', avatar_url: null }], { unblock });

    list.querySelector('button').click();

    await vi.waitFor(() => expect(list.textContent).toContain('ERR: Too many requests.'));
    expect(list.querySelector('.blocked-name').textContent).toBe('loud_owl');
  });
});
