import { CONSENT_EVENT, hasConsent } from './consent.js';

// Crash reporting is optional ("Diagnostics" in the cookie settings): the
// Sentry SDK is only downloaded and started once the visitor agrees, and is
// shut down again if they change their mind.
const DSN = import.meta.env.VITE_SENTRY_DSN;

let active = null; // the started Sentry module
let pending = Promise.resolve();

export function applyDiagnosticsConsent() {
  // Serialized, so a quick yes-no-yes can't start Sentry twice.
  pending = pending.then(async () => {
    if (!DSN) return;
    if (hasConsent('diagnostics') && !active) {
      const Sentry = await import('@sentry/browser');
      Sentry.init({ dsn: DSN, environment: import.meta.env.MODE, sendDefaultPii: false });
      active = Sentry;
    } else if (!hasConsent('diagnostics') && active) {
      await active.close();
      active = null;
    }
  });
  return pending;
}

applyDiagnosticsConsent();
window.addEventListener(CONSENT_EVENT, applyDiagnosticsConsent);
