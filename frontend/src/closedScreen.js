import { isNightInTimezone, nextTransitionInTimezone, formatCountdown } from './nightGate.js';

export function renderClosedScreen(container, timezone) {
  container.innerHTML = `
    <div class="stack">
      <h1 class="center-text">NIGHTCORD<span class="blink">_</span></h1>
      <div class="panel closed-panel">
        <h2 class="center-text">closed right now</h2>
        <p class="center-text closed-sub">nightcord only opens after dark at your school — come back tonight.</p>
        <p class="center-text closed-label">opens in</p>
        <div class="countdown center-text" id="gate-countdown">00:00:00</div>
      </div>
    </div>
  `;

  const countdownEl = container.querySelector('#gate-countdown');

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
