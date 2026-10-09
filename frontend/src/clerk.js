// Clerk runs sign-up, sign-in and email verification. This module loads it
// once per page and hands out short-lived session tokens for API calls.
//
// Clerk's scripts are loaded from Clerk's own CDN on the instance's Frontend
// API host rather than bundled (the npm build is ~1.5 MB). The core script
// handles sessions and tokens; the prebuilt screens are a separate UI script,
// loaded only on the page that shows them (the sign-in page).
const CLERK_JS_MAJOR = 6;
const CLERK_UI_MAJOR = 1;

// Clerk's screens in nightcord's look. Colors and fonts point at the site's
// own CSS variables, so they follow the Night/Lamp toggle automatically; the
// thick borders and offset shadows come from style.css (the .cl-* rules).
export const appearance = {
  variables: {
    colorPrimary: 'var(--primary)',
    colorPrimaryForeground: 'var(--bg)',
    colorBackground: 'var(--panel)',
    colorForeground: 'var(--ink)',
    colorMutedForeground: 'var(--ink-soft)',
    colorDanger: 'var(--danger)',
    colorSuccess: 'var(--good)',
    colorInput: 'var(--panel)',
    colorInputForeground: 'var(--ink)',
    colorBorder: 'var(--ink)',
    // Clerk shades the Google/Microsoft button text from this (black by
    // default, which disappears on the dark themes).
    colorNeutral: 'var(--ink)',
    fontFamily: 'var(--font-body)',
    // Clerk also uses the "button" font for the Google/Microsoft buttons and
    // the "Secured by" / "Development mode" footer, so this is the body font;
    // style.css puts the main Continue button back in the display font.
    fontFamilyButtons: 'var(--font-body)',
    fontSize: '1.1rem',
    borderRadius: '0',
  },
  elements: {
    // Clerk caps its card at 25rem; fill the page's 480px column instead so
    // it lines up (and centers) with the title and the site's other panels.
    rootBox: { width: '100%' },
    cardBox: { width: '100%', maxWidth: '100%' },
    card: 'panel',
    formButtonPrimary: 'btn btn-primary',
    // Styled in style.css to match the form labels (not .btn's display font).
    socialButtonsBlockButton: 'clerk-social-button',
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
    if (publishableKey) script.dataset.clerkPublishableKey = publishableKey;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

let loading = null;

// `withUi: true` also loads Clerk's prebuilt screens (needed for
// mountSignIn). The first call on a page decides, so the sign-in page must
// ask for the UI before anything else loads Clerk.
export function loadClerk({ withUi = false } = {}) {
  if (!loading) {
    loading = (async () => {
      const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
      if (!publishableKey) {
        throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set -- add it to frontend/.env.');
      }
      const host = frontendApiHost(publishableKey);
      await Promise.all([
        loadScript(`https://${host}/npm/@clerk/clerk-js@${CLERK_JS_MAJOR}/dist/clerk.browser.js`, publishableKey),
        withUi && loadScript(`https://${host}/npm/@clerk/ui@${CLERK_UI_MAJOR}/dist/ui.browser.js`),
      ]);
      // With data-clerk-publishable-key set, the core script creates the instance.
      const clerk = window.Clerk;
      await clerk.load({
        appearance,
        telemetry: false, // no usage data to Clerk (see the Privacy Policy)
        ...(withUi && { ui: { ClerkUI: window.__internal_ClerkUICtor } }),
      });
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
