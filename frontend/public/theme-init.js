// Applied before first paint so there's no flash of the wrong theme.
if (localStorage.getItem('nightcord_theme') === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
}
