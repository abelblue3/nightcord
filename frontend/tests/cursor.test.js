import { describe, it, expect, beforeEach } from 'vitest';
import { getCursor, setCursor, initCursorSetting } from '../src/cursor.js';
import { saveConsent } from '../src/consent.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.removeAttribute('data-cursor');
});

describe('the pixel cursor setting', () => {
  it('is on by default', () => {
    expect(getCursor()).toBe('pixel');
  });

  it("switching it off gives the system cursor, for this visit only without consent", () => {
    setCursor('system');

    expect(document.documentElement.getAttribute('data-cursor')).toBe('system');
    expect(sessionStorage.getItem('nightcord_cursor')).toBe('system');
    expect(localStorage.getItem('nightcord_cursor')).toBeNull();
    expect(getCursor()).toBe('system');
  });

  it('is remembered between visits with Preferences consent', () => {
    saveConsent({ preferences: true });
    setCursor('system');

    expect(localStorage.getItem('nightcord_cursor')).toBe('system');
    expect(sessionStorage.getItem('nightcord_cursor')).toBeNull();
  });

  it('switching it back on removes the attribute', () => {
    setCursor('system');
    setCursor('pixel');
    expect(document.documentElement.hasAttribute('data-cursor')).toBe(false);
  });

  it('the Settings checkbox shows and changes it', () => {
    document.body.innerHTML = '<input type="checkbox" id="cursor-setting" />';
    const box = document.getElementById('cursor-setting');
    initCursorSetting(box);
    expect(box.checked).toBe(true);

    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(getCursor()).toBe('system');
  });
});
