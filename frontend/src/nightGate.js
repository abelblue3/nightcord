const NIGHT_START_HOUR = 21; // 9 PM
const NIGHT_END_HOUR = 6; // 6 AM
const DEV_BYPASS_KEY = 'nightcord_dev_skip_gate';

// The actual gate decision is made server-side, per-account, using the
// student's *school* timezone rather than anything this browser reports --
// see the backend's app/gate.py for why. Everything in this file is either
// (a) a UX nicety for showing an accurate countdown once the server has told
// us which timezone applies, or (b) the one-time browser-timezone capture
// sent at signup as a fallback for schools we don't have location data for.

export function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// Reduces "what's the wall-clock time in an arbitrary IANA zone right now"
// to a Date whose UTC-getters return that wall-clock time -- a standard
// trick for doing calendar arithmetic in a foreign zone without a library.
function wallTimeInZone(tzName, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  let hour = get('hour');
  if (hour === '24') hour = '00'; // ICU quirk: midnight can format as "24" with hour12:false

  return new Date(
    Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), Number(hour), Number(get('minute')), Number(get('second')))
  );
}

export function isNightInTimezone(tzName, date = new Date()) {
  const hour = wallTimeInZone(tzName, date).getUTCHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

// Returns a real timestamp (ms since epoch) for the next open/close moment
// in the given zone, accurate to within a DST shift landing between now and
// then (rare, and this is a UX countdown, not the enforcement).
export function nextTransitionInTimezone(tzName, date = new Date()) {
  const wallNow = wallTimeInZone(tzName, date);
  const wallTarget = new Date(wallNow);

  if (isNightInTimezone(tzName, date)) {
    wallTarget.setUTCHours(NIGHT_END_HOUR, 0, 0, 0);
    if (wallTarget <= wallNow) wallTarget.setUTCDate(wallTarget.getUTCDate() + 1);
  } else {
    wallTarget.setUTCHours(NIGHT_START_HOUR, 0, 0, 0);
    if (wallTarget <= wallNow) wallTarget.setUTCDate(wallTarget.getUTCDate() + 1);
  }

  return date.getTime() + (wallTarget.getTime() - wallNow.getTime());
}

export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

// Dev-only, opt-in escape hatch (?skipGate=1) so building during the day
// doesn't lock us out of our own app. `import.meta.env.DEV` is statically
// false in production builds, so this whole branch is dead-code-eliminated.
// As of the server-side gate, this flag is also sent to the backend (as a
// header/query param) so it actually affects enforcement, not just the UI.
export function devSkipGateActive() {
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
