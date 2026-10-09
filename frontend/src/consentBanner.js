import { getConsent, hasConsent, saveConsent } from './consent.js';
import { syncConsent } from './api.js';

// The cookie banner (first visit, or after the policy changes) and the
// "Cookie settings" dialog behind the footer link. Refusing is exactly as
// easy as accepting: same-sized buttons, one click either way.

const CATEGORIES = [
  {
    key: 'essential',
    label: 'Essential',
    description:
      'Keeps you signed in (Clerk), protects sign-up from bots (Cloudflare), and remembers who you are on these pages. nightcord can’t work without these, so they’re always on.',
    locked: true,
  },
  {
    key: 'preferences',
    label: 'Preferences',
    description: 'Remembers your Night/Lamp theme choice between visits.',
  },
  {
    key: 'diagnostics',
    label: 'Diagnostics',
    description: 'Sends crash reports to Sentry so we can fix bugs. No names or email addresses are included.',
  },
];

function save(choices) {
  saveConsent(choices);
  // Logged on the server too if signed in; the browser copy counts either way.
  syncConsent().catch(() => {});
}

function button(label, className, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

let banner = null;

function closeBanner() {
  banner?.remove();
  banner = null;
}

function showBanner() {
  if (banner?.isConnected) return;
  banner = document.createElement('section');
  banner.className = 'consent-banner panel';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Cookie choices');

  const text = document.createElement('p');
  text.className = 'consent-text';
  text.innerHTML =
    'nightcord uses essential cookies and storage to keep you signed in. With your OK, we’d also remember your theme and send crash reports so we can fix bugs. <a href="/privacy.html#cookies">Privacy &amp; cookies</a>';

  const actions = document.createElement('div');
  actions.className = 'consent-actions';
  actions.append(
    button('Accept all', 'btn btn-small', () => {
      save({ preferences: true, diagnostics: true });
      closeBanner();
    }),
    button('Reject optional', 'btn btn-small', () => {
      save({ preferences: false, diagnostics: false });
      closeBanner();
    }),
    button('Customize', 'btn btn-small', () => openCookieSettings()),
  );

  banner.append(text, actions);
  document.body.appendChild(banner);
}

// The per-category settings. Opened from the banner or any
// [data-cookie-settings] link (the footer's "Cookie settings").
export function openCookieSettings() {
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'consent-dialog panel';
  dialog.setAttribute('aria-labelledby', 'consent-dialog-title');

  const form = document.createElement('form');
  form.method = 'dialog';

  const title = document.createElement('h2');
  title.id = 'consent-dialog-title';
  title.textContent = 'Cookie settings';
  form.appendChild(title);

  for (const category of CATEGORIES) {
    const row = document.createElement('label');
    row.className = 'consent-category';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.name = category.key;
    box.checked = category.locked || hasConsent(category.key);
    box.disabled = Boolean(category.locked);

    const words = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = category.locked ? `${category.label} (always on)` : category.label;
    const detail = document.createElement('span');
    detail.className = 'consent-detail';
    detail.textContent = category.description;
    words.append(name, detail);

    row.append(box, words);
    form.appendChild(row);
  }

  const actions = document.createElement('div');
  actions.className = 'consent-actions';
  function finish() {
    dialog.remove();
    if (opener?.focus) opener.focus(); // back to where they were
  }

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close(); // fires 'close' -> finish
    else finish();
  }

  const saveButton = button('Save choices', 'btn btn-primary btn-small', () => {
    save({ preferences: form.elements.preferences.checked, diagnostics: form.elements.diagnostics.checked });
    closeBanner();
    closeDialog();
  });
  actions.append(saveButton, button('Cancel', 'btn btn-small', closeDialog));
  form.appendChild(actions);
  dialog.appendChild(form);

  dialog.addEventListener('close', finish);

  document.body.appendChild(dialog);
  if (dialog.showModal) dialog.showModal(); // Escape closes it; focus moves inside
  else dialog.setAttribute('open', '');
  return dialog;
}

export function initConsentBanner() {
  if (!getConsent()) showBanner();
  for (const link of document.querySelectorAll('[data-cookie-settings]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openCookieSettings();
    });
  }
}
