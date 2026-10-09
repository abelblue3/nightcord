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
    expect(button('Maximize Sam')).not.toBeNull();
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

  it('maximizes, and restores its previous size and spot', () => {
    win.element.style.width = '300px';
    const before = position(win);

    button('Maximize Sam').click();
    expect(win.element.style.width).not.toBe('300px');

    button('Restore Sam size').click();
    expect(win.element.style.width).toBe('300px');
    expect(position(win)).toEqual(before);
  });

  it('can put extra buttons before _ □ ×, and give × another job', () => {
    const extra = document.createElement('button');
    extra.textContent = 'mic';
    const leave = vi.fn();
    const own = createWindow({ title: 'You', extraButtons: [extra], close: { label: 'Leave video call', action: leave } });

    const titleButtons = [...own.element.querySelectorAll('.retro-title-buttons > button')];
    expect(titleButtons[0]).toBe(extra);
    own.element.querySelector('[aria-label="Leave video call"]').click();
    expect(leave).toHaveBeenCalled();
    expect(own.element.hidden).toBe(false);
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

  it('resizes freely from the corner grip (width and height), down to a minimum', () => {
    const chat = createWindow({ title: 'ROOM', at: { left: 0, top: 0 }, resize: 'free' });
    document.body.appendChild(chat.element);
    chat.element.style.width = '400px';
    chat.element.style.height = '300px';
    const grip = chat.element.querySelector('.retro-grip');

    pointer('pointerdown', grip, 400, 300);
    pointer('pointermove', grip, 500, 380);
    expect(chat.element.style.width).toBe('500px');
    expect(chat.element.style.height).toBe('380px');

    pointer('pointermove', grip, 0, 0); // dragged far past the minimum
    expect(chat.element.style.width).toBe('280px');
    expect(chat.element.style.height).toBe('220px');
  });

  it('aspect-locked windows resize by width only (the height follows the video)', () => {
    const video = createWindow({ title: 'Sam', at: { left: 0, top: 0 }, resize: 'aspect' });
    document.body.appendChild(video.element);
    video.element.style.width = '240px';
    const grip = video.element.querySelector('.retro-grip');

    pointer('pointerdown', grip, 240, 160);
    pointer('pointermove', grip, 400, 900);
    expect(video.element.style.width).toBe('400px');
    expect(video.element.style.height).toBe('');

    video.setAspectRatio(9, 16);
    expect(video.body.style.aspectRatio).toBe('9 / 16');
  });

  it('the grip resizes with the arrow keys too', () => {
    const chat = createWindow({ title: 'ROOM', at: { left: 0, top: 0 }, resize: 'free' });
    document.body.appendChild(chat.element);
    chat.element.style.width = '400px';
    chat.element.style.height = '300px';

    chat.element.querySelector('.retro-grip').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(chat.element.style.width).toBe('416px');
  });

  it('has no grip unless resizing is asked for', () => {
    expect(win.element.querySelector('.retro-grip')).toBeNull();
  });

  it('comes to the front when touched', () => {
    const other = createWindow({ title: 'Alex' });
    document.body.appendChild(other.element);
    expect(Number(other.element.style.zIndex)).toBeGreaterThan(Number(win.element.style.zIndex));

    pointer('pointerdown', win.element, 10, 10);

    expect(Number(win.element.style.zIndex)).toBeGreaterThan(Number(other.element.style.zIndex));
  });
});
