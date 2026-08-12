// Shared between auth.js (writes it right after a successful signup) and
// verify.js (reads it to pre-fill the email field and to know when the
// last code was sent, so a page refresh doesn't reset the resend cooldown).
export const PENDING_VERIFICATION_KEY = 'nightcord_pending_verification';
