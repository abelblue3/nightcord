import { CONSENT_EVENT, hasConsent } from './consent.js';

const THEME_KEY = 'nightcord_theme';

// The light/dark choice is always applied. It's only *remembered between
// visits* (localStorage) with the visitor's "Preferences" consent; without
// it, it lasts for this browser session (sessionStorage).
export function getTheme() {
  return sessionStorage.getItem(THEME_KEY) || localStorage.getItem(THEME_KEY) || 'light';
}

export function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
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

export function initThemeToggle(buttonEl) {
  function render() {
    const theme = getTheme();
    buttonEl.textContent = theme === 'dark' ? '☀' : '☾';
    buttonEl.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    buttonEl.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  render();
  buttonEl.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    render();
  });
}
