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

    window.google.accounts.id.renderButton(containerEl, {
      theme: 'outline',
      size: 'large',
      width: 300,
      text: 'continue_with',
    });
  }

  attemptRender();
}
