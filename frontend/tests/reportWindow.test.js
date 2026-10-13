import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({ reportStudent: null, blockStudent: null }));
vi.mock('../src/api.js', () => ({
  reportStudent: (...args) => api.reportStudent(...args),
  blockStudent: (...args) => api.blockStudent(...args),
}));

import { openReportWindow } from '../src/reportWindow.js';

const STUDENT = { userId: 2, name: 'night_owl' };

let win;
const form = () => win.body.querySelector('form');
const send = () => win.body.querySelector('.report-send');
const pick = (reason) => {
  const radio = win.body.querySelector(`input[value="${reason}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = '<div class="screen"></div>';
  api.reportStudent = vi.fn(async () => ({ message: 'Report received.' }));
  api.blockStudent = vi.fn(async () => ({}));
});

describe('the report window', () => {
  it('offers the six reasons, and Send waits for one', () => {
    win = openReportWindow(STUDENT, { roomId: 7 });

    expect(win.element.getAttribute('aria-label')).toBe('Report night_owl');
    expect([...win.body.querySelectorAll('input[name="reason"]')].map((r) => r.value)).toEqual([
      'harassment',
      'hate',
      'sexual',
      'spam',
      'self_harm',
      'other',
    ]);
    expect(win.body.querySelector('textarea').maxLength).toBe(500);
    expect(send().disabled).toBe(true);
    pick('spam');
    expect(send().disabled).toBe(false);
  });

  it('sends the reason, details, room and message', async () => {
    win = openReportWindow(STUDENT, { roomId: 7, messageId: 55 });
    pick('harassment');
    win.body.querySelector('textarea').value = 'keeps insulting people';
    form().requestSubmit();

    await vi.waitFor(() => expect(win.body.textContent).toContain('Report received.'));
    expect(api.reportStudent).toHaveBeenCalledWith({
      reportedId: 2,
      reason: 'harassment',
      roomId: 7,
      messageId: 55,
      details: 'keeps insulting people',
    });
  });

  it('offers to block them too, once the report is in', async () => {
    const onBlock = vi.fn();
    win = openReportWindow(STUDENT, { roomId: 7, onBlock });
    pick('spam');
    form().requestSubmit();

    await vi.waitFor(() => expect(win.body.querySelector('.report-block')).not.toBeNull());
    const block = win.body.querySelector('.report-block');
    expect(block.textContent).toBe('Block night_owl too');
    block.click();

    await vi.waitFor(() => expect(onBlock).toHaveBeenCalledWith(2));
    expect(api.blockStudent).toHaveBeenCalledWith(2);
    expect(win.body.textContent).toContain('Blocked.');
  });

  it("doesn't offer Block for someone already blocked", async () => {
    win = openReportWindow(STUDENT, { isBlocked: () => true });
    pick('spam');
    form().requestSubmit();

    await vi.waitFor(() => expect(win.body.textContent).toContain('Report received.'));
    expect(win.body.querySelector('.report-block')).toBeNull();
  });

  it('points to 988 when self-harm is picked', () => {
    win = openReportWindow(STUDENT, {});
    const note = win.body.querySelector('.report-crisis');
    expect(note.hidden).toBe(true);

    pick('self_harm');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('988');
  });

  it('keeps the form and says why if sending fails', async () => {
    api.reportStudent = vi.fn(async () => {
      throw new Error('Too many requests.');
    });
    win = openReportWindow(STUDENT, {});
    pick('spam');
    form().requestSubmit();

    await vi.waitFor(() => expect(win.body.textContent).toContain('ERR: Too many requests.'));
    expect(form()).not.toBeNull();
    expect(send().disabled).toBe(false);
  });
});
