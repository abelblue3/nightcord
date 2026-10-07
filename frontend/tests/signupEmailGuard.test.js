import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { guardSignupEmail } from '../src/signupEmailGuard.js';

// A stand-in for Clerk's sign-up form: same field name, and a submit handler
// on the form that plays the part of Clerk continuing (and emailing a code).
function buildSignupForm() {
  const container = document.createElement('div');
  container.innerHTML = `
    <form>
      <input name="emailAddress" />
      <button type="submit">Continue</button>
    </form>`;
  document.body.appendChild(container);
  const form = container.querySelector('form');
  const input = container.querySelector('input');
  const clerkSubmit = vi.fn((event) => event.preventDefault());
  form.addEventListener('submit', clerkSubmit);
  return { container, form, input, clerkSubmit };
}

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const REJECTED = { allowed: false, message: 'nightcord is for college students — please sign up with your school email address.' };
const ALLOWED = { allowed: true, message: null };

describe('guardSignupEmail', () => {
  let page;
  let showError;
  let clearError;
  let checkEmail;

  beforeEach(() => {
    page = buildSignupForm();
    showError = vi.fn();
    clearError = vi.fn();
    checkEmail = vi.fn(async (email) => (email.endsWith('@gmail.com') ? REJECTED : ALLOWED));
    guardSignupEmail(page.container, { checkEmail, showError, clearError });
  });

  afterEach(() => {
    page.container.remove();
    vi.useRealTimers();
  });

  it('warns as soon as the student pauses typing a non-college address', async () => {
    vi.useFakeTimers();
    typeInto(page.input, 'someone@gmail.com');

    await vi.advanceTimersByTimeAsync(600);

    expect(checkEmail).toHaveBeenCalledWith('someone@gmail.com');
    expect(showError).toHaveBeenCalledWith(REJECTED.message);
  });

  it('never lets Clerk continue with a non-college address', async () => {
    typeInto(page.input, 'someone@gmail.com');
    page.form.requestSubmit();
    await flush();

    expect(page.clerkSubmit).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(REJECTED.message);
  });

  it('passes a college address through to Clerk exactly once', async () => {
    typeInto(page.input, 'student@harvard.edu');
    page.form.requestSubmit();
    await flush();

    expect(page.clerkSubmit).toHaveBeenCalledTimes(1);
    expect(clearError).toHaveBeenCalled();
  });

  it('clears the warning once the address is fixed', async () => {
    vi.useFakeTimers();
    typeInto(page.input, 'someone@gmail.com');
    await vi.advanceTimersByTimeAsync(600);
    typeInto(page.input, 'someone@stanford.edu');
    await vi.advanceTimersByTimeAsync(600);

    expect(showError).toHaveBeenCalledTimes(1);
    expect(clearError).toHaveBeenCalled();
  });

  it('asks the server once per address', async () => {
    typeInto(page.input, 'someone@gmail.com');
    page.form.requestSubmit();
    await flush();
    page.form.requestSubmit();
    await flush();

    expect(checkEmail).toHaveBeenCalledTimes(1);
  });

  it('lets the form through if the check itself fails -- the backend still enforces the rule', async () => {
    checkEmail.mockRejectedValue(new Error('offline'));
    typeInto(page.input, 'student@new-college.edu');
    page.form.requestSubmit();
    await flush();

    expect(page.clerkSubmit).toHaveBeenCalledTimes(1);
  });

  it('leaves other Clerk forms alone (e.g. the sign-in form)', async () => {
    const signIn = document.createElement('form');
    signIn.innerHTML = '<input name="identifier" /><button type="submit">Continue</button>';
    page.container.appendChild(signIn);
    const clerkSignIn = vi.fn((event) => event.preventDefault());
    signIn.addEventListener('submit', clerkSignIn);

    signIn.requestSubmit();
    await flush();

    expect(clerkSignIn).toHaveBeenCalledTimes(1);
    expect(checkEmail).not.toHaveBeenCalled();
  });
});
