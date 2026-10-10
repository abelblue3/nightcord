import { isNightInTimezone, nextTransitionInTimezone, formatCountdown } from './nightGate.js';
import { signOut } from './api.js';
import { initAvatarMenu } from './avatarMenu.js';
import { initThemeToggle } from './theme.js';

export function renderClosedScreen(container, timezone) {
  // This replaces the whole page shell, including whatever topbar/logout
  // button the surrounding page had -- so the closed screen needs its own,
  // self-contained way out. Otherwise someone who signed up with the wrong
  // account (or just wants a different one) is stuck staring at a countdown
  // with no way to sign out.
  // The top bar stays: profiles aren't night-gated, so Profile, Settings and
  // Log out (the avatar menu) and Lamp work in the daytime too.
  container.innerHTML = `
    <div class="topbar">
      <span class="logo">NIGHTCORD</span>
      <div class="topbar-actions">
        <button class="btn theme-toggle" id="theme-toggle" type="button"></button>
        <div id="avatar-menu"></div>
      </div>
    </div>
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

  initThemeToggle(container.querySelector('#theme-toggle'));
  initAvatarMenu(container.querySelector('#avatar-menu'));
  container.querySelector('#closed-logout-btn').addEventListener('click', signOut);

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
// rejects the actual API calls regardless of whether this fires. Only night
// turning to day counts: beta stays open around the clock, so a page opened
// there in the daytime must not reload over and over.
export function watchForClose(timezone) {
  let wasNight = isNightInTimezone(timezone);
  const intervalId = setInterval(() => {
    const night = isNightInTimezone(timezone);
    if (wasNight && !night) window.location.reload();
    wasNight = night;
  }, 30000);
  return () => clearInterval(intervalId);
}
