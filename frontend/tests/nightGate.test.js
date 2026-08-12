import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isNightInTimezone, nextTransitionInTimezone, formatCountdown, devSkipGateActive, getBrowserTimezone } from '../src/nightGate.js';

describe('isNightInTimezone', () => {
  it('is night at 9pm UTC (start of window)', () => {
    expect(isNightInTimezone('UTC', new Date('2026-01-01T21:00:00Z'))).toBe(true);
  });

  it('is night at 11:59pm UTC', () => {
    expect(isNightInTimezone('UTC', new Date('2026-01-01T23:59:00Z'))).toBe(true);
  });

  it('is night at 2am UTC (past midnight, still within window)', () => {
    expect(isNightInTimezone('UTC', new Date('2026-01-01T02:00:00Z'))).toBe(true);
  });

  it('is not night at exactly 6am UTC (end of window)', () => {
    expect(isNightInTimezone('UTC', new Date('2026-01-01T06:00:00Z'))).toBe(false);
  });

  it('is not night at noon UTC', () => {
    expect(isNightInTimezone('UTC', new Date('2026-01-01T12:00:00Z'))).toBe(false);
  });

  it('is not night at 8:59pm UTC (just before the window)', () => {
    expect(isNightInTimezone('UTC', new Date('2026-01-01T20:59:00Z'))).toBe(false);
  });

  it('correctly converts across real timezones, not just UTC', () => {
    // At this instant, LA local time is 3am (night) and NY local time is
    // exactly 6am (day) -- a genuine cross-zone check, not UTC math twice.
    const instant = new Date('2026-01-02T11:00:00Z');
    expect(isNightInTimezone('America/Los_Angeles', instant)).toBe(true);
    expect(isNightInTimezone('America/New_York', instant)).toBe(false);
  });
});

describe('nextTransitionInTimezone', () => {
  it('from daytime UTC, points to 9pm UTC the same day', () => {
    const now = new Date('2026-01-01T14:00:00Z');
    const nextMs = nextTransitionInTimezone('UTC', now);
    const next = new Date(nextMs);
    expect(next.toISOString()).toBe('2026-01-01T21:00:00.000Z');
  });

  it('from evening night UTC, points to 6am UTC the next day', () => {
    const now = new Date('2026-01-01T23:00:00Z');
    const nextMs = nextTransitionInTimezone('UTC', now);
    const next = new Date(nextMs);
    expect(next.toISOString()).toBe('2026-01-02T06:00:00.000Z');
  });

  it('from early-morning night UTC, points to 6am UTC the same day', () => {
    const now = new Date('2026-01-01T02:00:00Z');
    const nextMs = nextTransitionInTimezone('UTC', now);
    const next = new Date(nextMs);
    expect(next.toISOString()).toBe('2026-01-01T06:00:00.000Z');
  });

  it('the returned value is a real, usable countdown target (ms in the future)', () => {
    const now = new Date('2026-01-01T14:00:00Z');
    const nextMs = nextTransitionInTimezone('UTC', now);
    expect(nextMs).toBeGreaterThan(now.getTime());
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

describe('getBrowserTimezone', () => {
  it('returns a non-empty IANA-style string', () => {
    const tz = getBrowserTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
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

  it('is off by default', () => {
    expect(devSkipGateActive()).toBe(false);
  });

  it('?skipGate=1 turns it on', () => {
    window.history.replaceState({}, '', '/?skipGate=1');
    expect(devSkipGateActive()).toBe(true);
  });

  it('persists on a later visit with no query param', () => {
    window.history.replaceState({}, '', '/?skipGate=1');
    devSkipGateActive(); // triggers the bypass to be stored

    window.history.replaceState({}, '', '/');
    expect(devSkipGateActive()).toBe(true);
  });

  it('?skipGate=0 turns it back off', () => {
    window.history.replaceState({}, '', '/?skipGate=1');
    devSkipGateActive();

    window.history.replaceState({}, '', '/?skipGate=0');
    expect(devSkipGateActive()).toBe(false);
  });
});
