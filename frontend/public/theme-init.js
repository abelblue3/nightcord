// Applied before first paint so there's no flash of the wrong theme or
// cursor. Each is kept in sessionStorage (this visit) or localStorage
// (remembered, with the visitor's Preferences consent) -- see src/theme.js
// and src/cursor.js.
if ((sessionStorage.getItem('nightcord_theme') || localStorage.getItem('nightcord_theme')) === 'lamp') {
  document.documentElement.setAttribute('data-theme', 'lamp');
}
if ((sessionStorage.getItem('nightcord_cursor') || localStorage.getItem('nightcord_cursor')) === 'system') {
  document.documentElement.setAttribute('data-cursor', 'system');
}
