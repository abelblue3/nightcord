import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/api.js', () => ({ syncConsent: vi.fn(async () => {}) }));

import { syncConsent } from '../src/api.js';
import { getConsent, saveConsent } from '../src/consent.js';
import { initConsentBanner, openCookieSettings } from '../src/consentBanner.js';

const banner = () => document.querySelector('.consent-banner');
const buttonNamed = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  document.body.innerHTML = '<a href="#" data-cookie-settings>Cookie settings</a>';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the cookie banner', () => {
  it('appears when the visitor has not decided yet', () => {
    initConsentBanner();
    expect(banner()).not.toBeNull();
    expect(banner().querySelector('a[href="/privacy.html#cookies"]')).not.toBeNull();
  });

  it('stays away once they have decided', () => {
    saveConsent({ preferences: false, diagnostics: false });
    initConsentBanner();
    expect(banner()).toBeNull();
  });

  it('offers Accept all and Reject optional as equals', () => {
    initConsentBanner();
    const accept = buttonNamed(banner(), 'Accept all');
    const reject = buttonNamed(banner(), 'Reject optional');
    expect(accept.className).toBe(reject.className);
  });

  it('Accept all turns on every optional category', () => {
    initConsentBanner();
    buttonNamed(banner(), 'Accept all').click();

    expect(getConsent().choices).toEqual({ preferences: true, diagnostics: true });
    expect(banner()).toBeNull();
    expect(syncConsent).toHaveBeenCalled();
  });

  it('Reject optional keeps only the essentials', () => {
    initConsentBanner();
    buttonNamed(banner(), 'Reject optional').click();

    expect(getConsent().choices).toEqual({ preferences: false, diagnostics: false });
    expect(banner()).toBeNull();
  });
});

describe('cookie settings', () => {
  it('shows essential as always on and locked', () => {
    const dialog = openCookieSettings();
    const essential = dialog.querySelector('input[name="essential"]');
    expect(essential.checked).toBe(true);
    expect(essential.disabled).toBe(true);
  });

  it('saves a custom choice', () => {
    initConsentBanner();
    buttonNamed(banner(), 'Customize').click();
    const dialog = document.querySelector('.consent-dialog');

    dialog.querySelector('input[name="diagnostics"]').checked = true;
    buttonNamed(dialog, 'Save choices').click();

    expect(getConsent().choices).toEqual({ preferences: false, diagnostics: true });
    expect(banner()).toBeNull();
    expect(document.querySelector('.consent-dialog')).toBeNull();
  });

  it('shows the current choices when reopened from the footer link', () => {
    saveConsent({ preferences: true, diagnostics: false });
    initConsentBanner();

    document.querySelector('[data-cookie-settings]').click();
    const dialog = document.querySelector('.consent-dialog');

    expect(dialog.querySelector('input[name="preferences"]').checked).toBe(true);
    expect(dialog.querySelector('input[name="diagnostics"]').checked).toBe(false);
  });

  it('Cancel changes nothing', () => {
    saveConsent({ preferences: true, diagnostics: false });
    const dialog = openCookieSettings();
    dialog.querySelector('input[name="diagnostics"]').checked = true;
    buttonNamed(dialog, 'Cancel').click();

    expect(getConsent().choices).toEqual({ preferences: true, diagnostics: false });
  });
});
