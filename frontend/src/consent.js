// What a visitor has agreed to nightcord storing or collecting beyond the
// essentials. The choice lives in this browser (and, once they sign in, is
// also logged on the server -- see syncConsent in api.js).
//
// Categories (the cookie banner and the Privacy Policy describe the same):
//   essential   -- always on: sign-in (Clerk), bot protection, session info
//   preferences -- remembering the Night/Lamp theme between visits
//   diagnostics -- crash reports to Sentry

// Bump this whenever the Privacy Policy's cookie section changes, so
// everyone is asked again.
export const CONSENT_VERSION = '2026-10-01';
export const CONSENT_EVENT = 'nightcord:consent';
const CONSENT_KEY = 'nightcord_consent'; // itself essential: it's how "no" is remembered

function read() {
  try {
    return JSON.parse(localStorage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

// The current decision, or null if the visitor hasn't decided under the
// current policy version.
export function getConsent() {
  const state = read();
  return state && state.version === CONSENT_VERSION ? state : null;
}

export function hasConsent(category) {
  if (category === 'essential') return true;
  return Boolean(getConsent()?.choices?.[category]);
}

export function saveConsent({ preferences = false, diagnostics = false } = {}) {
  const state = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    choices: { preferences: Boolean(preferences), diagnostics: Boolean(diagnostics) },
    recordedFor: null, // a new choice hasn't been logged on the server yet
  };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
  return state;
}

// Notes that the current choice has been logged on the server for this
// account, so it isn't sent again.
export function markConsentRecorded(userId) {
  const state = getConsent();
  if (!state) return;
  state.recordedFor = userId;
  localStorage.setItem(CONSENT_KEY, JSON.stringify(state));
}
