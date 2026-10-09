import { CONSENT_EVENT, hasConsent } from './consent.js';

const THEME_KEY = 'nightcord_theme';

// Night (the default) or Lamp. The choice is always applied; it's only
// *remembered between visits* (localStorage) with the visitor's "Preferences"
// consent; without it, it lasts for this browser session (sessionStorage).
export function getTheme() {
  const saved = sessionStorage.getItem(THEME_KEY) || localStorage.getItem(THEME_KEY);
  return saved === 'lamp' ? 'lamp' : 'night';
}

export function applyTheme(theme) {
  if (theme === 'lamp') {
    document.documentElement.setAttribute('data-theme', 'lamp');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function setTheme(theme) {
  if (hasConsent('preferences')) {
    localStorage.setItem(THEME_KEY, theme);
    sessionStorage.removeItem(THEME_KEY);
  } else {
    sessionStorage.setItem(THEME_KEY, theme);
    localStorage.removeItem(THEME_KEY);
  }
  applyTheme(theme);
}

// When the Preferences choice changes, move the saved theme to match: keep it
// for this session only if consent was withdrawn, remember it if granted.
window.addEventListener(CONSENT_EVENT, () => {
  const current = sessionStorage.getItem(THEME_KEY) || localStorage.getItem(THEME_KEY);
  if (current) setTheme(current);
});

// A "Lamp" switch: pressed (and lit) while Lamp is on.
export function initThemeToggle(buttonEl) {
  buttonEl.textContent = 'Lamp';
  buttonEl.title = 'Lamp: warmer colors';

  function render() {
    buttonEl.setAttribute('aria-pressed', String(getTheme() === 'lamp'));
  }

  render();
  buttonEl.addEventListener('click', () => {
    setTheme(getTheme() === 'lamp' ? 'night' : 'lamp');
    render();
  });
}
