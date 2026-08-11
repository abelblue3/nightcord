import { describe, expect, it } from 'vitest';
import { formatCountdown, isNightTime, nextTransition } from '../src/nightGate.js';

function at(hour, minute = 0) {
  return new Date(2026, 0, 15, hour, minute, 0, 0);
}

describe('isNightTime', () => {
  it('is night at 9pm (start of window)', () => {
    expect(isNightTime(at(21))).toBe(true);
  });

  it('is night at 11:59pm', () => {
    expect(isNightTime(at(23, 59))).toBe(true);
  });

  it('is night just after midnight', () => {
    expect(isNightTime(at(0, 1))).toBe(true);
  });

  it('is night at 5:59am (last minute of the window)', () => {
    expect(isNightTime(at(5, 59))).toBe(true);
  });

  it('is not night at 6am (end of window)', () => {
    expect(isNightTime(at(6))).toBe(false);
  });

  it('is not night at 2pm', () => {
    expect(isNightTime(at(14))).toBe(false);
  });

  it('is not night at 8:59pm (last minute before opening)', () => {
    expect(isNightTime(at(20, 59))).toBe(false);
  });
});

describe('nextTransition', () => {
  it('during the day, points to 9pm the same day', () => {
    const now = at(14);
    const next = nextTransition(now);
    expect(next.getHours()).toBe(21);
    expect(next.getDate()).toBe(now.getDate());
  });

  it('during the evening portion of the night, points to 6am the next day', () => {
    const now = at(22);
    const next = nextTransition(now);
    expect(next.getHours()).toBe(6);
    expect(next.getDate()).toBe(now.getDate() + 1);
  });

  it('during the early-morning portion of the night, points to 6am the same day', () => {
    const now = at(2);
    const next = nextTransition(now);
    expect(next.getHours()).toBe(6);
    expect(next.getDate()).toBe(now.getDate());
  });
});

describe('formatCountdown', () => {
  it('formats hours, minutes, seconds with zero padding', () => {
    expect(formatCountdown(3661000)).toBe('01:01:01');
  });

  it('formats zero as 00:00:00', () => {
    expect(formatCountdown(0)).toBe('00:00:00');
  });

  it('clamps negative durations to zero instead of going negative', () => {
    expect(formatCountdown(-5000)).toBe('00:00:00');
  });

  it('rounds down partial seconds', () => {
    expect(formatCountdown(1999)).toBe('00:00:01');
  });
});
