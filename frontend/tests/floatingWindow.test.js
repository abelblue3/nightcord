import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWindow } from '../src/floatingWindow.js';

function pointer(type, target, clientX, clientY) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
}

function position(win) {
  return { x: parseFloat(win.element.style.left), y: parseFloat(win.element.style.top) };
}

let win;
let onHide;

beforeEach(() => {
  document.body.innerHTML = '';
  onHide = vi.fn();
  win = createWindow({ title: 'Sam', onHide });
  document.body.appendChild(win.element);
});

const titlebar = () => win.element.querySelector('.retro-titlebar');
const button = (label) => win.element.querySelector(`[aria-label="${label}"]`);

describe('a floating window', () => {
  it('shows its title in the title bar, with the three title buttons', () => {
    expect(titlebar().textContent).toContain('Sam');
    expect(button('Minimize Sam')).not.toBeNull();
    expect(button('Make Sam bigger')).not.toBeNull();
    expect(button('Hide Sam')).not.toBeNull();
  });

  it('drags by its title bar', () => {
    const start = position(win);

    pointer('pointerdown', titlebar(), 500, 100);
    pointer('pointermove', titlebar(), 400, 160);
    pointer('pointerup', titlebar(), 400, 160);

    expect(position(win)).toEqual({ x: start.x - 100, y: start.y + 60 });
  });

  it('stays on screen when dragged past the edge', () => {
    pointer('pointerdown', titlebar(), 500, 100);
    pointer('pointermove', titlebar(), -5000, -5000);

    expect(position(win)).toEqual({ x: 0, y: 0 });
  });

  it('moves with the arrow keys, further with Shift', () => {
    const start = position(win);

    titlebar().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(position(win).x).toBe(start.x - 16);

    titlebar().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    expect(position(win).y).toBe(start.y + 64);
  });

  it('minimizes to its title bar and back', () => {
    button('Minimize Sam').click();
    expect(win.element.classList.contains('is-minimized')).toBe(true);

    button('Restore Sam').click();
    expect(win.element.classList.contains('is-minimized')).toBe(false);
  });

  it('switches between small and large', () => {
    button('Make Sam bigger').click();
    expect(win.element.classList.contains('is-large')).toBe(true);
    expect(button('Make Sam smaller')).not.toBeNull();
  });

  it('hides, tells its owner, and shows again', () => {
    button('Hide Sam').click();
    expect(win.element.hidden).toBe(true);
    expect(onHide).toHaveBeenCalledTimes(1);

    win.show();
    expect(win.element.hidden).toBe(false);
  });

  it('can open at a given spot, with a style modifier', () => {
    const chat = createWindow({ title: 'ROOM', at: { left: 40, top: 120 }, className: 'chat-window' });

    expect(chat.element.style.left).toBe('40px');
    expect(chat.element.style.top).toBe('120px');
    expect(chat.element.classList.contains('chat-window')).toBe(true);
    expect(chat.element.classList.contains('retro-window')).toBe(true);
  });

  it('comes to the front when touched', () => {
    const other = createWindow({ title: 'Alex' });
    document.body.appendChild(other.element);
    expect(Number(other.element.style.zIndex)).toBeGreaterThan(Number(win.element.style.zIndex));

    pointer('pointerdown', win.element, 10, 10);

    expect(Number(win.element.style.zIndex)).toBeGreaterThan(Number(other.element.style.zIndex));
  });
});
