import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isNightTime, nextTransition, formatCountdown } from '../src/nightGate.js';

describe('isNightTime', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('is night at 9pm (start of window)', () => {
    expect(isNightTime(new Date(2026, 0, 1, 21, 0, 0))).toBe(true);
  });

  it('is night at 11:59pm', () => {
    expect(isNightTime(new Date(2026, 0, 1, 23, 59, 0))).toBe(true);
  });

  it('is night at 2am (past midnight, still within window)', () => {
    expect(isNightTime(new Date(2026, 0, 1, 2, 0, 0))).toBe(true);
  });

  it('is not night at exactly 6am (end of window)', () => {
    expect(isNightTime(new Date(2026, 0, 1, 6, 0, 0))).toBe(false);
  });

  it('is not night at noon', () => {
    expect(isNightTime(new Date(2026, 0, 1, 12, 0, 0))).toBe(false);
  });

  it('is not night at 8:59pm (just before the window)', () => {
    expect(isNightTime(new Date(2026, 0, 1, 20, 59, 0))).toBe(false);
  });
});

describe('nextTransition', () => {
  it('from daytime, points to 9pm the same day', () => {
    const now = new Date(2026, 0, 1, 14, 0, 0);
    const next = nextTransition(now);
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(21);
  });

  it('from evening night, points to 6am the next day', () => {
    const now = new Date(2026, 0, 1, 23, 0, 0);
    const next = nextTransition(now);
    expect(next.getDate()).toBe(2);
    expect(next.getHours()).toBe(6);
  });

  it('from early-morning night, points to 6am the same day', () => {
    const now = new Date(2026, 0, 1, 2, 0, 0);
    const next = nextTransition(now);
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(6);
  });
});

describe('formatCountdown', () => {
  it('formats hours, minutes, seconds with zero-padding', () => {
    expect(formatCountdown(3661_000)).toBe('01:01:01');
  });

  it('floors negative/zero durations to 00:00:00', () => {
    expect(formatCountdown(-5000)).toBe('00:00:00');
  });

  it('formats large durations correctly', () => {
    expect(formatCountdown((9 * 3600 + 5 * 60 + 30) * 1000)).toBe('09:05:30');
  });
});

describe('dev gate bypass', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('?skipGate=1 forces isNightTime to true regardless of the clock', () => {
    window.history.replaceState({}, '', '/?skipGate=1');
    // Noon — would normally be "closed."
    expect(isNightTime(new Date(2026, 0, 1, 12, 0, 0))).toBe(true);
  });

  it('the bypass persists on a later visit with no query param', () => {
    window.history.replaceState({}, '', '/?skipGate=1');
    isNightTime(new Date(2026, 0, 1, 12, 0, 0)); // triggers the bypass to be stored

    window.history.replaceState({}, '', '/');
    expect(isNightTime(new Date(2026, 0, 1, 12, 0, 0))).toBe(true);
  });

  it('?skipGate=0 turns the bypass back off', () => {
    window.history.replaceState({}, '', '/?skipGate=1');
    isNightTime(new Date(2026, 0, 1, 12, 0, 0));

    window.history.replaceState({}, '', '/?skipGate=0');
    expect(isNightTime(new Date(2026, 0, 1, 12, 0, 0))).toBe(false);
  });
});
