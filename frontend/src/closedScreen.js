import { isNightTime, nextTransition, formatCountdown } from './nightGate.js';

export function renderClosedScreen(container) {
  container.innerHTML = `
    <div class="stack">
      <h1 class="center-text">NIGHTCORD<span class="blink">_</span></h1>
      <div class="panel closed-panel">
        <h2 class="center-text">closed right now</h2>
        <p class="center-text closed-sub">nightcord only opens after dark for night owls studying late — come back tonight.</p>
        <p class="center-text closed-label">opens in</p>
        <div class="countdown center-text" id="gate-countdown">00:00:00</div>
      </div>
    </div>
  `;

  const countdownEl = container.querySelector('#gate-countdown');

  function tick() {
    const ms = nextTransition() - new Date();
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
// mid-session) and reload so the closed screen takes over cleanly.
export function watchForClose() {
  const intervalId = setInterval(() => {
    if (!isNightTime()) window.location.reload();
  }, 30000);
  return () => clearInterval(intervalId);
}
