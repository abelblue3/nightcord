import { describe, it, expect, beforeEach } from 'vitest';
import { getTheme, setTheme, applyTheme, initThemeToggle } from '../src/theme.js';
import { saveConsent } from '../src/consent.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('getTheme', () => {
  it('defaults to night when nothing is stored', () => {
    expect(getTheme()).toBe('night');
  });

  it('returns a remembered theme', () => {
    localStorage.setItem('nightcord_theme', 'lamp');
    expect(getTheme()).toBe('lamp');
  });

  it("prefers this visit's choice over a remembered one", () => {
    localStorage.setItem('nightcord_theme', 'lamp');
    sessionStorage.setItem('nightcord_theme', 'night');
    expect(getTheme()).toBe('night');
  });

  it('treats anything else saved (e.g. the old light/dark values) as night', () => {
    localStorage.setItem('nightcord_theme', 'light');
    expect(getTheme()).toBe('night');
  });
});

describe('applyTheme', () => {
  it('sets data-theme=lamp on <html> for lamp', () => {
    applyTheme('lamp');
    expect(document.documentElement.getAttribute('data-theme')).toBe('lamp');
  });

  it('removes the attribute entirely for night, the default palette', () => {
    document.documentElement.setAttribute('data-theme', 'lamp');
    applyTheme('night');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('setTheme and the Preferences consent', () => {
  it('without consent, the theme lasts for this visit only', () => {
    setTheme('lamp');
    expect(sessionStorage.getItem('nightcord_theme')).toBe('lamp');
    expect(localStorage.getItem('nightcord_theme')).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('lamp');
  });

  it('with consent, the theme is remembered between visits', () => {
    saveConsent({ preferences: true });
    setTheme('lamp');
    expect(localStorage.getItem('nightcord_theme')).toBe('lamp');
    expect(sessionStorage.getItem('nightcord_theme')).toBeNull();
  });

  it('withdrawing consent stops remembering it (but keeps it for this visit)', () => {
    saveConsent({ preferences: true });
    setTheme('lamp');

    saveConsent({ preferences: false });

    expect(localStorage.getItem('nightcord_theme')).toBeNull();
    expect(sessionStorage.getItem('nightcord_theme')).toBe('lamp');
    expect(getTheme()).toBe('lamp');
  });

  it('granting consent later starts remembering the current theme', () => {
    setTheme('lamp');
    saveConsent({ preferences: true });
    expect(localStorage.getItem('nightcord_theme')).toBe('lamp');
  });
});

describe('initThemeToggle', () => {
  it('is a Lamp switch: off at first, on (pressed) after a click', () => {
    const btn = document.createElement('button');
    initThemeToggle(btn);

    expect(btn.getAttribute('aria-label')).toBe('Lamp'); // the visible label is a pixel-art lamp
    expect(btn.querySelector('svg.lamp-icon')).not.toBeNull();
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    btn.click();

    expect(getTheme()).toBe('lamp');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('lamp');
  });

  it('switches back to night on a second click', () => {
    const btn = document.createElement('button');
    initThemeToggle(btn);

    btn.click();
    btn.click();

    expect(getTheme()).toBe('night');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('picks up a theme already set before init (e.g. by the head script)', () => {
    setTheme('lamp');
    const btn = document.createElement('button');
    initThemeToggle(btn);

    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});
