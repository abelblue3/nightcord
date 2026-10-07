import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CONSENT_EVENT,
  CONSENT_VERSION,
  getConsent,
  hasConsent,
  markConsentRecorded,
  saveConsent,
} from '../src/consent.js';

beforeEach(() => {
  localStorage.clear();
});

describe('consent', () => {
  it('is undecided at first -- only essential counts as agreed', () => {
    expect(getConsent()).toBeNull();
    expect(hasConsent('essential')).toBe(true);
    expect(hasConsent('preferences')).toBe(false);
    expect(hasConsent('diagnostics')).toBe(false);
  });

  it('saves and reads back each category', () => {
    saveConsent({ preferences: true, diagnostics: false });

    expect(getConsent()).toMatchObject({
      version: CONSENT_VERSION,
      choices: { preferences: true, diagnostics: false },
      recordedFor: null,
    });
    expect(hasConsent('preferences')).toBe(true);
    expect(hasConsent('diagnostics')).toBe(false);
  });

  it('asks again after the policy version changes', () => {
    localStorage.setItem(
      'nightcord_consent',
      JSON.stringify({ version: '2000-01-01', choices: { preferences: true, diagnostics: true } }),
    );
    expect(getConsent()).toBeNull();
    expect(hasConsent('diagnostics')).toBe(false);
  });

  it('tells the page when the choice changes', () => {
    const listener = vi.fn();
    window.addEventListener(CONSENT_EVENT, listener);

    saveConsent({ diagnostics: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail.choices.diagnostics).toBe(true);
    window.removeEventListener(CONSENT_EVENT, listener);
  });

  it('a new choice needs logging on the server again', () => {
    saveConsent({ preferences: true });
    markConsentRecorded(7);
    expect(getConsent().recordedFor).toBe(7);

    saveConsent({ preferences: false });
    expect(getConsent().recordedFor).toBeNull();
  });

  it('survives a corrupted stored value', () => {
    localStorage.setItem('nightcord_consent', '{not json');
    expect(getConsent()).toBeNull();
  });
});
