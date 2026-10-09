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

// A 12x12 pixel-art desk lamp. Its bulb and rays light up while Lamp is on
// (colors in style.css). Static markup -- no user content goes in here.
const LAMP_ICON = `<svg class="lamp-icon" viewBox="0 0 12 12" width="24" height="24" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
  <rect x="3" y="0" width="6" height="1"/>
  <rect x="2" y="1" width="8" height="1"/>
  <rect x="1" y="2" width="10" height="1"/>
  <rect class="lamp-bulb" x="5" y="3" width="2" height="1"/>
  <rect class="lamp-light" x="4" y="3" width="1" height="1"/>
  <rect class="lamp-light" x="7" y="3" width="1" height="1"/>
  <rect class="lamp-light" x="1" y="4" width="1" height="1"/>
  <rect class="lamp-light" x="0" y="5" width="1" height="1"/>
  <rect class="lamp-light" x="10" y="4" width="1" height="1"/>
  <rect class="lamp-light" x="11" y="5" width="1" height="1"/>
  <rect x="5" y="4" width="2" height="6"/>
  <rect x="3" y="10" width="6" height="1"/>
  <rect x="2" y="11" width="8" height="1"/>
</svg>`;

// The Lamp switch: pressed, with the lamp lit, while Lamp is on.
export function initThemeToggle(buttonEl) {
  buttonEl.innerHTML = LAMP_ICON;
  buttonEl.setAttribute('aria-label', 'Lamp');
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
