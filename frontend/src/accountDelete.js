import { setBusy } from './ui.js';

// Settings: deleting your account. The button stays greyed out until the
// student types DELETE, so it can't happen by a stray click.
// `deleteAccount()` asks the server; `onDeleted()` signs out of this browser.

const CONFIRM_WORD = 'DELETE';

export function initAccountDelete(section, { deleteAccount, onDeleted }) {
  const field = section.querySelector('#delete-confirm');
  const button = section.querySelector('#delete-account');
  const error = section.querySelector('#delete-error');
  let busy = false;

  const confirmed = () => field.value.trim() === CONFIRM_WORD;
  button.disabled = true;
  field.addEventListener('input', () => {
    if (!busy) button.disabled = !confirmed();
  });

  button.addEventListener('click', async () => {
    if (busy || !confirmed()) return;
    busy = true;
    error.textContent = '';
    const restore = setBusy(button, 'DELETING...');
    try {
      await deleteAccount();
    } catch (err) {
      restore();
      busy = false;
      error.textContent = `ERR: ${err.message}`;
      return;
    }
    onDeleted();
  });
}
