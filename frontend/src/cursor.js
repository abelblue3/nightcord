import { CONSENT_EVENT, hasConsent } from './consent.js';

const CURSOR_KEY = 'nightcord_cursor';

// The pixel cursor (the default) or the system one, for people who rely on a
// large or high-contrast system cursor. Stored like the theme: remembered
// between visits only with "Preferences" consent, otherwise for this visit.
export function getCursor() {
  const saved = sessionStorage.getItem(CURSOR_KEY) || localStorage.getItem(CURSOR_KEY);
  return saved === 'system' ? 'system' : 'pixel';
}

export function setCursor(cursor) {
  if (hasConsent('preferences')) {
    localStorage.setItem(CURSOR_KEY, cursor);
    sessionStorage.removeItem(CURSOR_KEY);
  } else {
    sessionStorage.setItem(CURSOR_KEY, cursor);
    localStorage.removeItem(CURSOR_KEY);
  }
  if (cursor === 'system') {
    document.documentElement.setAttribute('data-cursor', 'system');
  } else {
    document.documentElement.removeAttribute('data-cursor');
  }
}

window.addEventListener(CONSENT_EVENT, () => {
  const current = sessionStorage.getItem(CURSOR_KEY) || localStorage.getItem(CURSOR_KEY);
  if (current) setCursor(current);
});

// The "Pixel cursor" checkbox in Settings.
export function initCursorSetting(box) {
  box.checked = getCursor() === 'pixel';
  box.addEventListener('change', () => setCursor(box.checked ? 'pixel' : 'system'));
}
