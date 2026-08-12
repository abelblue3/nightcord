import './sentry.js';
import './style.css';
import { saveSession, verifyEmail, resendVerification } from './api.js';
import { PENDING_VERIFICATION_KEY } from './verifyState.js';

const RESEND_COOLDOWN_MS = 15_000;

const errorBox = document.getElementById('error-box');
const emailInput = document.getElementById('verify-email');
const codeInput = document.getElementById('verify-code');
const verifyForm = document.getElementById('verify-form');
const verifySubmit = document.getElementById('verify-submit');
const resendBtn = document.getElementById('resend-btn');

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.remove('visible');
}

function readPending() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_VERIFICATION_KEY) || 'null');
  } catch {
    return null;
  }
}

function writePending(email, sentAt) {
  sessionStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify({ email, sentAt }));
}

const pending = readPending();
if (pending?.email) {
  emailInput.value = pending.email;
}

let cooldownInterval;

function startCooldown(msRemaining) {
  clearInterval(cooldownInterval);
  resendBtn.disabled = true;

  function tick() {
    const secondsLeft = Math.ceil(msRemaining / 1000);
    if (secondsLeft <= 0) {
      clearInterval(cooldownInterval);
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend code';
      return;
    }
    resendBtn.textContent = `Resend code (${secondsLeft}s)`;
    msRemaining -= 1000;
  }

  tick();
  cooldownInterval = setInterval(tick, 1000);
}

if (pending?.sentAt) {
  const msRemaining = RESEND_COOLDOWN_MS - (Date.now() - pending.sentAt);
  if (msRemaining > 0) startCooldown(msRemaining);
}

verifyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  verifySubmit.disabled = true;

  const email = emailInput.value.trim();
  const code = codeInput.value.trim();

  try {
    const user = await verifyEmail(email, code);
    sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
    saveSession(user);
    window.location.href = '/rooms.html';
  } catch (err) {
    showError(err.message);
    verifySubmit.disabled = false;
  }
});

resendBtn.addEventListener('click', async () => {
  clearError();
  const email = emailInput.value.trim();
  if (!email) {
    showError('Enter your email first.');
    return;
  }

  resendBtn.disabled = true;
  try {
    await resendVerification(email);
    writePending(email, Date.now());
    startCooldown(RESEND_COOLDOWN_MS);
  } catch (err) {
    showError(err.message);
    resendBtn.disabled = false;
  }
});
