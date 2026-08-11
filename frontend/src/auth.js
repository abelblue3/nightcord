import './style.css';
import { signup, login, saveSession, getToken } from './api.js';
import { isNightTime } from './nightGate.js';
import { renderClosedScreen, watchForClose } from './closedScreen.js';

if (!isNightTime()) {
  renderClosedScreen(document.querySelector('.screen'));
} else {
  init();
}

function init() {
  watchForClose();

  if (getToken()) {
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

  async function afterAuth(token, user) {
    saveSession(token, user);
    window.location.href = '/rooms.html';
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const submitBtn = document.getElementById('login-submit');
    submitBtn.disabled = true;

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const { access_token } = await login({ email, password });
      await afterAuth(access_token, { email });
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
      const user = await signup({ email, password, displayName });
      const { access_token } = await login({ email, password });
      await afterAuth(access_token, user);
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}
