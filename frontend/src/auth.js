import './sentry.js';
import './style.css';
import { signup, login, saveSession, getUser, googleAuth } from './api.js';
import { getBrowserTimezone } from './nightGate.js';
import { renderGoogleButton } from './googleAuth.js';
import { PENDING_VERIFICATION_KEY } from './verifyState.js';

// Login/signup are never time-gated -- only room access is. See the
// handoff doc's Decisions for why (in short: gating the account itself
// serves no purpose, and school-timezone lookup only has an email to work
// with once someone's actually signing up).
init();

function init() {
  if (getUser()) {
    window.location.href = '/rooms.html';
    return;
  }

  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const errorBox = document.getElementById('error-box');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('visible');
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.classList.remove('visible');
  }

  function showTab(which) {
    clearError();
    const isLogin = which === 'login';
    tabLogin.classList.toggle('active', isLogin);
    tabSignup.classList.toggle('active', !isLogin);
    loginForm.style.display = isLogin ? 'block' : 'none';
    signupForm.style.display = isLogin ? 'none' : 'block';
  }

  tabLogin.addEventListener('click', () => showTab('login'));
  tabSignup.addEventListener('click', () => showTab('signup'));

  async function afterAuth(user) {
    saveSession(user);
    window.location.href = '/rooms.html';
  }

  renderGoogleButton(document.getElementById('google-signin-btn'), async (credential) => {
    clearError();
    try {
      const user = await googleAuth(credential, getBrowserTimezone());
      await afterAuth(user);
    } catch (err) {
      showError(err.message);
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const submitBtn = document.getElementById('login-submit');
    submitBtn.disabled = true;

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const user = await login({ email, password });
      await afterAuth(user);
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const submitBtn = document.getElementById('signup-submit');
    submitBtn.disabled = true;

    const displayName = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;

    try {
      await signup({ email, password, displayName, timezone: getBrowserTimezone() });
      sessionStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify({ email, sentAt: Date.now() }));
      window.location.href = '/verify.html';
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
    }
  });
}
