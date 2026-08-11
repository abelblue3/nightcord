const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function renderGoogleButton(containerEl, onCredential) {
  if (!CLIENT_ID) return;

  function attemptRender() {
    if (!window.google?.accounts?.id) {
      setTimeout(attemptRender, 100);
      return;
    }

    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: (response) => onCredential(response.credential),
    });

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    window.google.accounts.id.renderButton(containerEl, {
      theme: isDark ? 'filled_black' : 'outline',
      size: 'large',
      shape: 'square',
      logo_alignment: 'center',
      text: 'continue_with',
      width: Math.round(containerEl.getBoundingClientRect().width) || 300,
    });
  }

  attemptRender();
}
