import './sentry.js';
import './style.css';
import { loadClerk } from './clerk.js';
import { checkSignupEmail, clearSession, startSession } from './api.js';
import { getBrowserTimezone } from './nightGate.js';
import { guardSignupEmail } from './signupEmailGuard.js';
import { initConsentBanner } from './consentBanner.js';
import { loadingLine } from './ui.js';

// Login/signup are never time-gated -- only room access is. Clerk runs the
// screens (including the emailed code that proves the student owns the
// address); this page then asks the backend to link that sign-in to a
// nightcord account, which is where the college-email rule is enforced.

// Clerk may reload this page after signing someone in or out, so a message
// from a refused sign-in is carried across the reload.
const PENDING_ERROR_KEY = 'nightcord_auth_error';

init();

async function init() {
  initConsentBanner();

  const errorBox = document.getElementById('error-box');
  const mountPoint = document.getElementById('clerk-auth');
  mountPoint.replaceChildren(loadingLine('LOADING'));

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('visible');
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.remove('visible');
  }

  const pending = sessionStorage.getItem(PENDING_ERROR_KEY);
  if (pending) {
    sessionStorage.removeItem(PENDING_ERROR_KEY);
    showError(pending);
  }

  let clerk;
  try {
    clerk = await loadClerk({ withUi: true }); // this page shows Clerk's screens
  } catch (err) {
    console.error(err);
    mountPoint.replaceChildren();
    showError(`Sign-in is unavailable right now (${err.message}). Please try again in a moment.`);
    return;
  }

  let entering = false;
  const signingIn = loadingLine('SIGNING YOU IN');

  // Links the Clerk sign-in to a nightcord account, then goes to the rooms.
  // Returns false (and signs back out) if the backend refuses it -- e.g. not
  // a .edu address.
  async function enter() {
    if (entering || !clerk.user) return true;
    entering = true;
    // Hide (not clear) Clerk's screen -- it may be needed again if refused.
    mountPoint.hidden = true;
    mountPoint.before(signingIn);
    try {
      await startSession(getBrowserTimezone());
      window.location.href = '/rooms.html';
      return true;
    } catch (err) {
      signingIn.remove();
      mountPoint.hidden = false;
      clearSession();
      sessionStorage.setItem(PENDING_ERROR_KEY, err.message);
      showError(err.message);
      await clerk.signOut();
      entering = false;
      return false;
    }
  }

  if (clerk.user && (await enter())) return;

  // Clerk's "Don't have an account? Sign up" / "Already have an account? Sign
  // in" links navigate to signUpUrl / signInUrl; ?mode=signup tells this page
  // which of its two screens to show.
  function urlForMode(mode) {
    const params = new URLSearchParams(window.location.search);
    if (mode === 'signup') params.set('mode', 'signup');
    else params.delete('mode');
    const query = params.toString();
    return `/index.html${query ? `?${query}` : ''}`;
  }

  function showMode(mode) {
    mountPoint.replaceChildren(); // clears the loading line; Clerk renders here
    const links = {
      signInUrl: urlForMode('login'),
      signUpUrl: urlForMode('signup'),
      fallbackRedirectUrl: '/index.html',
    };
    if (mode === 'signup') {
      clerk.mountSignUp(mountPoint, { ...links, signInFallbackRedirectUrl: '/index.html' });
    } else {
      clerk.mountSignIn(mountPoint, { ...links, signUpFallbackRedirectUrl: '/index.html' });
    }
  }

  // Attached before Clerk's screen mounts, so its submit check runs first.
  guardSignupEmail(mountPoint, { checkEmail: checkSignupEmail, showError, clearError });

  try {
    showMode(new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'login');
  } catch (err) {
    console.error(err);
    showError(`Couldn't show the sign-in form: ${err.message}`);
    return;
  }

  // Signing in without a page reload (e.g. entering the emailed code).
  clerk.addListener(({ user }) => {
    if (user) enter();
  });
}
