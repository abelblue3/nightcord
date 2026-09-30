import './sentry.js';
import './style.css';
import { loadClerk } from './clerk.js';
import { clearSession, startSession } from './api.js';
import { getBrowserTimezone } from './nightGate.js';

// Login/signup are never time-gated -- only room access is. Clerk runs the
// screens (including the emailed code that proves the student owns the
// address); this page then asks the backend to link that sign-in to a
// nightcord account, which is where the .edu rule is enforced.

// Clerk may reload this page after signing someone in or out, so a message
// from a refused sign-in is carried across the reload.
const PENDING_ERROR_KEY = 'nightcord_auth_error';

init();

async function init() {
  const errorBox = document.getElementById('error-box');
  const mountPoint = document.getElementById('clerk-auth');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('visible');
  }

  const pending = sessionStorage.getItem(PENDING_ERROR_KEY);
  if (pending) {
    sessionStorage.removeItem(PENDING_ERROR_KEY);
    showError(pending);
  }

  let clerk;
  try {
    clerk = await loadClerk();
  } catch (err) {
    console.error(err);
    showError('Sign-in is unavailable right now. Please try again in a moment.');
    return;
  }

  let entering = false;

  // Links the Clerk sign-in to a nightcord account, then goes to the rooms.
  // Returns false (and signs back out) if the backend refuses it -- e.g. not
  // a .edu address.
  async function enter() {
    if (entering || !clerk.user) return true;
    entering = true;
    try {
      await startSession(getBrowserTimezone());
      window.location.href = '/rooms.html';
      return true;
    } catch (err) {
      clearSession();
      sessionStorage.setItem(PENDING_ERROR_KEY, err.message);
      showError(err.message);
      await clerk.signOut();
      entering = false;
      return false;
    }
  }

  if (clerk.user && (await enter())) return;

  clerk.mountSignIn(mountPoint, {
    withSignUp: true, // one screen for both: new addresses go straight into sign-up
    fallbackRedirectUrl: '/index.html',
    signUpFallbackRedirectUrl: '/index.html',
  });

  // Signing in without a page reload (e.g. entering the emailed code).
  clerk.addListener(({ user }) => {
    if (user) enter();
  });
}
