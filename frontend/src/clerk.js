// Clerk runs sign-up, sign-in and email verification. This module loads it
// once per page and hands out short-lived session tokens for API calls.
//
// Clerk's script is loaded from Clerk's own CDN on the instance's Frontend
// API host rather than bundled: the npm build is ~1.5 MB, while the browser
// build is a fraction of that and fetches the sign-in screens only on pages
// that show them.
const CLERK_JS_MAJOR = 6;

// Clerk's screens in nightcord's look. Colors and fonts point at the site's
// own CSS variables, so they follow the light/dark toggle automatically; the
// thick borders and offset shadows come from style.css (the .cl-* rules).
export const appearance = {
  variables: {
    colorPrimary: 'var(--primary)',
    colorPrimaryForeground: '#ffffff',
    colorBackground: 'var(--panel)',
    colorForeground: 'var(--ink)',
    colorMutedForeground: 'var(--ink-soft)',
    colorDanger: 'var(--danger)',
    colorSuccess: 'var(--good)',
    colorInput: 'var(--panel)',
    colorInputForeground: 'var(--ink)',
    colorBorder: 'var(--ink)',
    fontFamily: 'var(--font-body)',
    fontFamilyButtons: 'var(--font-display)',
    fontSize: '1.1rem',
    borderRadius: '0',
  },
  elements: {
    card: 'panel',
    formButtonPrimary: 'btn btn-primary',
    socialButtonsBlockButton: 'btn',
  },
};

// The publishable key encodes the instance's Frontend API host:
// pk_test_<base64("<host>$")>.
export function frontendApiHost(publishableKey) {
  return atob(publishableKey.split('_')[2]).slice(0, -1);
}

function loadScript(src, publishableKey) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = publishableKey;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load Clerk.'));
    document.head.appendChild(script);
  });
}

let loading = null;

export function loadClerk() {
  if (!loading) {
    loading = (async () => {
      const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
      if (!publishableKey) {
        throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set -- add it to frontend/.env.');
      }
      const host = frontendApiHost(publishableKey);
      await loadScript(`https://${host}/npm/@clerk/clerk-js@${CLERK_JS_MAJOR}/dist/clerk.browser.js`, publishableKey);
      // With data-clerk-publishable-key set, the script creates the instance.
      const clerk = window.Clerk;
      await clerk.load({ appearance });
      return clerk;
    })();
    // A failed load (e.g. offline) can be retried on the next call.
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

// A fresh token for the backend. Clerk's tokens live about a minute and
// getToken() returns a cached one or refreshes it, so call this per request.
export async function getSessionToken() {
  const clerk = await loadClerk();
  return clerk.session ? clerk.session.getToken() : null;
}

export async function signOutOfClerk() {
  const clerk = await loadClerk();
  await clerk.signOut();
}
