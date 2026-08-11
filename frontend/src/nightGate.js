const NIGHT_START_HOUR = 21; // 9 PM local time
const NIGHT_END_HOUR = 6; // 6 AM local time
const DEV_BYPASS_KEY = 'nightcord_dev_skip_gate';

// Dev-only, opt-in escape hatch so you're not locked out of your own app
// while building during the day. `import.meta.env.DEV` is statically false
// in production builds, so this whole branch is dead-code-eliminated —
// there is no way for it to exist in what actually ships.
function devBypassActive() {
  if (!import.meta.env.DEV) return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get('skipGate') === '1') {
    localStorage.setItem(DEV_BYPASS_KEY, '1');
    console.info('[nightcord] dev night-gate bypass ON — visit with ?skipGate=0 to turn it back off');
  } else if (params.get('skipGate') === '0') {
    localStorage.removeItem(DEV_BYPASS_KEY);
    console.info('[nightcord] dev night-gate bypass OFF');
  }

  return localStorage.getItem(DEV_BYPASS_KEY) === '1';
}

export function isNightTime(date = new Date()) {
  if (devBypassActive()) return true;
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

// The next moment the gate flips (open -> closed, or closed -> open).
export function nextTransition(date = new Date()) {
  const next = new Date(date);
  if (isNightTime(date)) {
    next.setHours(NIGHT_END_HOUR, 0, 0, 0);
    if (next <= date) next.setDate(next.getDate() + 1);
  } else {
    next.setHours(NIGHT_START_HOUR, 0, 0, 0);
    if (next <= date) next.setDate(next.getDate() + 1);
  }
  return next;
}

export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
