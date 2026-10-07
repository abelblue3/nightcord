import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const sentrySdk = vi.hoisted(() => ({ init: vi.fn(), close: vi.fn(async () => true) }));
vi.mock('@sentry/browser', () => sentrySdk);

let consent;
let sentry;

beforeAll(async () => {
  // The DSN is read when the module loads, so set it first.
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');
  consent = await import('../src/consent.js');
  sentry = await import('../src/sentry.js');
});

beforeEach(async () => {
  localStorage.clear();
  await sentry.applyDiagnosticsConsent(); // back to "off" between tests
  vi.clearAllMocks();
});

describe('Sentry and the Diagnostics consent', () => {
  it('stays off without consent', async () => {
    await sentry.applyDiagnosticsConsent();
    expect(sentrySdk.init).not.toHaveBeenCalled();
  });

  it('starts once the visitor agrees', async () => {
    consent.saveConsent({ diagnostics: true });
    await sentry.applyDiagnosticsConsent();

    expect(sentrySdk.init).toHaveBeenCalledTimes(1);
    expect(sentrySdk.init.mock.calls[0][0].sendDefaultPii).toBe(false);
  });

  it('stops again if they change their mind', async () => {
    consent.saveConsent({ diagnostics: true });
    await sentry.applyDiagnosticsConsent();

    consent.saveConsent({ diagnostics: false });
    await sentry.applyDiagnosticsConsent();

    expect(sentrySdk.close).toHaveBeenCalledTimes(1);
  });

  it('only other categories changing does not start it', async () => {
    consent.saveConsent({ preferences: true, diagnostics: false });
    await sentry.applyDiagnosticsConsent();
    expect(sentrySdk.init).not.toHaveBeenCalled();
  });
});
