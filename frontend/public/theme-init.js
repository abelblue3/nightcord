// Applied before first paint so there's no flash of the wrong theme. The
// theme is kept in sessionStorage (this visit) or localStorage (remembered,
// with the visitor's Preferences consent) -- see src/theme.js.
if ((sessionStorage.getItem('nightcord_theme') || localStorage.getItem('nightcord_theme')) === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
}
