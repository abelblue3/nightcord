import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, getTheme, initThemeToggle, setTheme } from '../src/theme.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('getTheme', () => {
  it('defaults to light when nothing is stored', () => {
    expect(getTheme()).toBe('light');
  });

  it('reflects whatever was stored', () => {
    localStorage.setItem('nightcord_theme', 'dark');
    expect(getTheme()).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('sets data-theme=dark on <html> for dark', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('removes the attribute entirely for light (so it matches the un-stamped default)', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    applyTheme('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('setTheme', () => {
  it('persists to localStorage and applies to the document together', () => {
    setTheme('dark');
    expect(localStorage.getItem('nightcord_theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('initThemeToggle', () => {
  it('renders the moon glyph when starting in light mode', () => {
    const btn = document.createElement('button');
    initThemeToggle(btn);
    expect(btn.textContent).toBe('☾');
    expect(btn.getAttribute('aria-label')).toMatch(/dark/i);
  });

  it('renders the sun glyph when starting in dark mode', () => {
    setTheme('dark');
    const btn = document.createElement('button');
    initThemeToggle(btn);
    expect(btn.textContent).toBe('☀');
    expect(btn.getAttribute('aria-label')).toMatch(/light/i);
  });

  it('toggles the theme and label on click', () => {
    const btn = document.createElement('button');
    initThemeToggle(btn);

    btn.click();
    expect(getTheme()).toBe('dark');
    expect(btn.textContent).toBe('☀');

    btn.click();
    expect(getTheme()).toBe('light');
    expect(btn.textContent).toBe('☾');
  });
});
