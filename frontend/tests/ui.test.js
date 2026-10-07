import { describe, it, expect, beforeEach } from 'vitest';
import { clearFieldError, loadingLine, setBusy, showFieldError } from '../src/ui.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('loadingLine', () => {
  it('is an announced status line with the blinking cursor', () => {
    const line = loadingLine('LOADING ROOMS');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.textContent).toBe('LOADING ROOMS_');
    expect(line.querySelector('.blink').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('setBusy', () => {
  it('disables the button and shows what it is doing, then restores it', () => {
    const button = document.createElement('button');
    button.textContent = 'Create Room';

    const restore = setBusy(button, 'CREATING...');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('CREATING...');
    expect(button.getAttribute('aria-busy')).toBe('true');

    restore();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Create Room');
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('field errors', () => {
  function field() {
    document.body.innerHTML = '<div class="field"><label for="room-name">Room name</label><input id="room-name" /></div>';
    return document.getElementById('room-name');
  }

  it('shows the message under the field, tied to it for screen readers', () => {
    const input = field();
    showFieldError(input, 'Room name already taken.');

    const error = document.querySelector('.field-error');
    expect(error.textContent).toBe('Room name already taken.');
    expect(input.closest('.field').classList.contains('has-error')).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('replaces rather than stacks messages', () => {
    const input = field();
    showFieldError(input, 'first');
    showFieldError(input, 'second');
    expect([...document.querySelectorAll('.field-error')].map((e) => e.textContent)).toEqual(['second']);
  });

  it('clears everything again', () => {
    const input = field();
    showFieldError(input, 'oops');
    clearFieldError(input);

    expect(document.querySelector('.field-error')).toBeNull();
    expect(input.closest('.field').classList.contains('has-error')).toBe(false);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });
});
