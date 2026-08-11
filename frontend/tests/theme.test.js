import { describe, it, expect, beforeEach } from 'vitest';
import { getTheme, setTheme, applyTheme, initThemeToggle } from '../src/theme.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('getTheme', () => {
  it('defaults to light when nothing is stored', () => {
    expect(getTheme()).toBe('light');
  });

  it('returns whatever was stored', () => {
    localStorage.setItem('nightcord_theme', 'dark');
    expect(getTheme()).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('sets data-theme=dark on <html> for dark', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('removes the attribute entirely for light (so it never overrides CSS)', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    applyTheme('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('setTheme', () => {
  it('persists to localStorage and applies immediately', () => {
    setTheme('dark');
    expect(localStorage.getItem('nightcord_theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('initThemeToggle', () => {
  it('renders the moon glyph for light mode and toggles to sun on click', () => {
    const btn = document.createElement('button');
    initThemeToggle(btn);

    expect(btn.textContent).toBe('☾');
    expect(getTheme()).toBe('light');

    btn.click();

    expect(getTheme()).toBe('dark');
    expect(btn.textContent).toBe('☀');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggles back to light on a second click', () => {
    const btn = document.createElement('button');
    initThemeToggle(btn);

    btn.click();
    btn.click();

    expect(getTheme()).toBe('light');
    expect(btn.textContent).toBe('☾');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('picks up a theme already set before init (e.g. by the head script)', () => {
    setTheme('dark');
    const btn = document.createElement('button');
    initThemeToggle(btn);

    expect(btn.textContent).toBe('☀');
  });
});
