// Small shared pieces for loading and error states.

// "LOADING ROOMS_" in the pixel font, with the same blinking cursor as the
// NIGHTCORD_ title. Screen readers announce it once.
export function loadingLine(text) {
  const line = document.createElement('p');
  line.className = 'loading-line';
  line.setAttribute('role', 'status');
  line.setAttribute('aria-live', 'polite');
  line.textContent = text;
  const cursor = document.createElement('span');
  cursor.className = 'blink';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.textContent = '_';
  line.appendChild(cursor);
  return line;
}

// Disables a button and shows what it's doing ("CREATING..."). Returns a
// function that puts it back.
export function setBusy(button, busyText) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  button.setAttribute('aria-busy', 'true');
  return () => {
    button.disabled = false;
    button.textContent = original;
    button.removeAttribute('aria-busy');
  };
}

// An error message under a form field, tied to it for screen readers.
export function showFieldError(input, message) {
  clearFieldError(input);
  const field = input.closest('.field') || input.parentElement;
  field.classList.add('has-error');
  const error = document.createElement('p');
  error.className = 'field-error';
  error.id = `${input.id || input.name}-error`;
  error.textContent = message;
  field.appendChild(error);
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', error.id);
}

export function clearFieldError(input) {
  const field = input.closest('.field') || input.parentElement;
  field.classList.remove('has-error');
  field.querySelector('.field-error')?.remove();
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
}
