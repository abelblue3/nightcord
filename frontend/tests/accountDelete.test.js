import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initAccountDelete } from '../src/accountDelete.js';

let section;
let deleteAccount;
let onDeleted;

const field = () => section.querySelector('#delete-confirm');
const button = () => section.querySelector('#delete-account');
const error = () => section.querySelector('#delete-error');

function type(value) {
  field().value = value;
  field().dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = `
    <section id="delete-section">
      <input id="delete-confirm" />
      <button id="delete-account" type="button">Delete my account</button>
      <p id="delete-error"></p>
    </section>`;
  section = document.getElementById('delete-section');
  deleteAccount = vi.fn(async () => ({}));
  onDeleted = vi.fn();
  initAccountDelete(section, { deleteAccount, onDeleted });
});

describe('deleting your account', () => {
  it('stays greyed out until DELETE is typed exactly', () => {
    expect(button().disabled).toBe(true);
    type('delete');
    expect(button().disabled).toBe(true);
    type('DELETE please');
    expect(button().disabled).toBe(true);
    type('  DELETE ');
    expect(button().disabled).toBe(false);
  });

  it('deletes once, then hands over to sign-out', async () => {
    type('DELETE');
    button().click();
    button().click(); // a second click while busy does nothing

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('says why and lets you retry if it fails', async () => {
    deleteAccount.mockRejectedValueOnce(new Error("Couldn't reach the sign-in service. Please try again."));
    type('DELETE');
    button().click();

    await vi.waitFor(() => expect(error().textContent).toBe("ERR: Couldn't reach the sign-in service. Please try again."));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe('Delete my account');
  });
});
