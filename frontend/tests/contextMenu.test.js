import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initContextMenu } from '../src/contextMenu.js';

let area;
let menu;
let actions;

function rightClick(target, options = {}) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50, ...options });
  target.dispatchEvent(event);
  return event;
}

const openMenu = () => document.querySelector('.context-menu');
const items = () => [...openMenu().querySelectorAll('[role="menuitem"]')];
const press = (key) => openMenu().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = `
    <div class="screen">
      <p class="spot">empty space</p>
      <input class="field" />
      <a class="link" href="/rooms.html">rooms</a>
    </div>`;
  area = document.querySelector('.screen');
  actions = { one: vi.fn(), two: vi.fn(), off: vi.fn(), risky: vi.fn() };
  menu = initContextMenu(area, () => [
    { label: 'One', action: actions.one },
    { label: 'Off', action: actions.off, disabled: true },
    { label: 'Two', action: actions.two },
    { label: 'Risky', confirmLabel: 'Sure? Risky', action: actions.risky },
  ]);
});

afterEach(() => {
  menu.close();
  window.getSelection().removeAllRanges();
});

describe('the right-click menu', () => {
  it("replaces the browser's menu with ours", () => {
    const event = rightClick(document.querySelector('.spot'));

    expect(event.defaultPrevented).toBe(true);
    expect(openMenu().getAttribute('role')).toBe('menu');
    expect(items().map((item) => item.textContent)).toEqual(['One', 'Off', 'Two', 'Risky']);
    expect(document.activeElement).toBe(items()[0]); // keyboard users land in it
  });

  it("keeps the browser's menu in text fields, on links, with a selection, and on Shift", () => {
    expect(rightClick(document.querySelector('.field')).defaultPrevented).toBe(false);
    expect(rightClick(document.querySelector('.link')).defaultPrevented).toBe(false);
    expect(rightClick(document.querySelector('.spot'), { shiftKey: true }).defaultPrevented).toBe(false);

    window.getSelection().selectAllChildren(document.querySelector('.spot'));
    expect(rightClick(document.querySelector('.spot')).defaultPrevented).toBe(false);
    expect(openMenu()).toBeNull();
  });

  it('runs an item and closes', () => {
    rightClick(document.querySelector('.spot'));
    items()[0].click();

    expect(actions.one).toHaveBeenCalled();
    expect(openMenu()).toBeNull();
  });

  it('moves with the arrow keys, skipping disabled items, and picks with Enter', () => {
    rightClick(document.querySelector('.spot'));

    press('ArrowDown');
    expect(document.activeElement.textContent).toBe('Two'); // "Off" is skipped
    press('ArrowUp');
    expect(document.activeElement.textContent).toBe('One');
    press('ArrowUp');
    expect(document.activeElement.textContent).toBe('Risky'); // wraps around

    press('ArrowDown');
    press('Enter');
    expect(actions.one).toHaveBeenCalled();
  });

  it('closes with Esc and puts focus back', () => {
    const spot = document.querySelector('.spot');
    spot.tabIndex = 0;
    spot.focus();
    rightClick(spot);

    press('Escape');

    expect(openMenu()).toBeNull();
    expect(document.activeElement).toBe(spot);
  });

  it('closes when you click elsewhere', () => {
    rightClick(document.querySelector('.spot'));
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(openMenu()).toBeNull();
  });

  it('does nothing for a disabled item', () => {
    rightClick(document.querySelector('.spot'));
    items()[1].click();
    expect(actions.off).not.toHaveBeenCalled();
  });

  it('asks again before a risky item runs', () => {
    rightClick(document.querySelector('.spot'));

    items()[3].click();
    expect(actions.risky).not.toHaveBeenCalled();
    expect(items()[3].textContent).toBe('Sure? Risky');

    items()[3].click();
    expect(actions.risky).toHaveBeenCalled();
  });

  it('shows nothing when there are no items', () => {
    const quiet = document.createElement('div');
    document.body.append(quiet);
    initContextMenu(quiet, () => []);

    expect(rightClick(quiet).defaultPrevented).toBe(false);
    expect(openMenu()).toBeNull();
  });
});
