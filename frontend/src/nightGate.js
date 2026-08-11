const NIGHT_START_HOUR = 21; // 9 PM local time
const NIGHT_END_HOUR = 6; // 6 AM local time

export function isNightTime(date = new Date()) {
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
