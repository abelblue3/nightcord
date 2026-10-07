// Checks the email typed into Clerk's sign-up form against nightcord's
// "college students only" rule as soon as it's entered, and holds back the
// form's submit until it passes -- so nobody goes through the emailed code
// only to be turned away afterwards.
//
// This is a courtesy, not the enforcement: POST /auth/session still checks
// the verified address when the account is linked, and anything in the
// browser can be bypassed.

const EMAIL_FIELD = 'input[name="emailAddress"]'; // Clerk's sign-up email input
const TYPING_PAUSE_MS = 500;

// `container`: the element Clerk's screen is mounted in.
// `checkEmail(email)`: resolves to { allowed, message }.
// `showError(message)` / `clearError()`: how the page reports the result.
export function guardSignupEmail(container, { checkEmail, showError, clearError }) {
  const verdicts = new Map();

  function verdictFor(email) {
    if (!verdicts.has(email)) {
      // A failed check (offline, rate-limited, not an email yet) lets the form
      // through: Clerk validates the format, and the backend enforces the rule.
      verdicts.set(email, checkEmail(email).catch(() => ({ allowed: true, message: null })));
    }
    return verdicts.get(email);
  }

  function currentEmail() {
    return container.querySelector(EMAIL_FIELD)?.value.trim().toLowerCase() ?? '';
  }

  async function check(email) {
    if (!email.includes('@') || !email.split('@')[1]?.includes('.')) return true;
    const { allowed, message } = await verdictFor(email);
    if (email === currentEmail()) {
      if (allowed) clearError();
      else showError(message);
    }
    return allowed;
  }

  let typingTimer;
  container.addEventListener('input', (event) => {
    if (!event.target.matches?.(EMAIL_FIELD)) return;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => check(currentEmail()), TYPING_PAUSE_MS);
  });

  container.addEventListener('focusout', (event) => {
    if (event.target.matches?.(EMAIL_FIELD)) check(currentEmail());
  });

  // Capture phase, so this runs before Clerk's own submit handler and can
  // stop it; an allowed address is then submitted again, untouched.
  let resubmitting = false;
  container.addEventListener(
    'submit',
    async (event) => {
      const form = event.target;
      if (resubmitting || !form.querySelector?.(EMAIL_FIELD)) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      if (await check(currentEmail())) {
        resubmitting = true;
        try {
          form.requestSubmit();
        } finally {
          resubmitting = false;
        }
      }
    },
    true,
  );
}
