import { isNightInTimezone, nextTransitionInTimezone, formatCountdown } from './nightGate.js';
import { logout, clearSession } from './api.js';

export function renderClosedScreen(container, timezone) {
  // This replaces the whole page shell, including whatever topbar/logout
  // button the surrounding page had -- so the closed screen needs its own,
  // self-contained way out. Otherwise someone who signed up with the wrong
  // account (or just wants a different one) is stuck staring at a countdown
  // with no way to sign out.
  container.innerHTML = `
    <div class="stack">
      <h1 class="center-text">NIGHTCORD<span class="blink">_</span></h1>
      <div class="panel closed-panel">
        <h2 class="center-text">closed right now</h2>
        <p class="center-text closed-sub">nightcord only opens after dark at your school — come back tonight.</p>
        <p class="center-text closed-label">opens in</p>
        <div class="countdown center-text" id="gate-countdown">00:00:00</div>
      </div>
      <p class="center-text hint">
        wrong account? <button type="button" class="btn-link" id="closed-logout-btn">sign out</button>
      </p>
    </div>
  `;

  const countdownEl = container.querySelector('#gate-countdown');

  container.querySelector('#closed-logout-btn').addEventListener('click', async () => {
    try {
      await logout();
    } catch {
      // Sign the browser out locally either way -- a failed logout request
      // shouldn't strand someone who's trying to leave.
    } finally {
      clearSession();
      window.location.href = '/index.html';
    }
  });

  function tick() {
    const ms = nextTransitionInTimezone(timezone) - Date.now();
    if (ms <= 0) {
      window.location.reload();
      return;
    }
    countdownEl.textContent = formatCountdown(ms);
  }

  tick();
  const intervalId = setInterval(tick, 1000);
  return () => clearInterval(intervalId);
}

// While the gate is open, poll for it swinging shut (e.g. it turns 6am
// mid-session at the student's school) and reload so the closed screen
// takes over cleanly. This is a UX nicety, not enforcement -- the backend
// rejects the actual API calls regardless of whether this fires.
export function watchForClose(timezone) {
  const intervalId = setInterval(() => {
    if (!isNightInTimezone(timezone)) window.location.reload();
  }, 30000);
  return () => clearInterval(intervalId);
}
