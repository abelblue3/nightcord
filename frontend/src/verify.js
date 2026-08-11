import './style.css';
import { saveSession, verifyEmail } from './api.js';

const heading = document.getElementById('verify-heading');
const text = document.getElementById('verify-text');
const errorBox = document.getElementById('error-box');
const action = document.getElementById('verify-action');

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}

async function run() {
  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    heading.textContent = 'Missing link';
    text.textContent = 'This verification link is missing its token.';
    action.style.display = 'block';
    return;
  }

  try {
    const { access_token, user } = await verifyEmail(token);
    saveSession(access_token, user);
    heading.textContent = "You're verified!";
    text.textContent = 'Taking you in…';
    window.location.href = '/rooms.html';
  } catch (err) {
    heading.textContent = 'Verification failed';
    text.textContent = '';
    showError(err.message);
    action.style.display = 'block';
  }
}

run();
