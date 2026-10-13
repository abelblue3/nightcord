// A Win95-style menu in place of the browser's right-click menu, inside
// `area` only. `itemsFor(target)` returns the items for what was clicked:
// { label, action, disabled?, confirmLabel? } -- an item with a confirmLabel
// takes a second pick before it runs. No items: the browser's menu shows.
//
// The browser's own menu stays where people rely on it: text fields (paste,
// spellcheck), links (open in a new tab), selected text (copy), and on
// Shift+right-click.

const NATIVE_TARGETS = 'input, textarea, select, [contenteditable], a[href]';

export function initContextMenu(area, itemsFor) {
  let menu = null;
  let returnFocus = null;

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('pointerdown', closeOnOutside, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
    document.removeEventListener('scroll', close, true);
  }

  function closeOnOutside(event) {
    if (menu && !menu.contains(event.target)) close();
  }

  function enabledItems() {
    return [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  }

  function move(step) {
    const enabled = enabledItems();
    const at = enabled.indexOf(document.activeElement);
    enabled[(at + step + enabled.length) % enabled.length]?.focus();
  }

  function itemButton(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retro-menu-item';
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    let armed = !item.confirmLabel;
    button.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        button.textContent = item.confirmLabel;
        return;
      }
      const focusBack = returnFocus;
      close();
      focusBack?.focus?.();
      item.action();
    });
    return button;
  }

  function open(items, x, y) {
    close();
    returnFocus = document.activeElement;
    menu = document.createElement('div');
    menu.className = 'retro-menu context-menu';
    menu.setAttribute('role', 'menu');
    menu.append(...items.map(itemButton));
    document.body.append(menu);

    // Kept fully on screen near the right and bottom edges.
    menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;

    menu.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') move(1);
      else if (event.key === 'ArrowUp') move(-1);
      else if (event.key === 'Escape' || event.key === 'Tab') {
        const focusBack = returnFocus;
        close();
        focusBack?.focus?.();
      } else if (event.key === 'Enter' || event.key === ' ') document.activeElement?.click();
      else return;
      event.preventDefault();
    });
    document.addEventListener('pointerdown', closeOnOutside, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('scroll', close, true);
    enabledItems()[0]?.focus();
  }

  area.addEventListener('contextmenu', (event) => {
    if (event.shiftKey || event.target.closest?.(NATIVE_TARGETS)) return;
    if (window.getSelection()?.toString()) return;
    const items = itemsFor(event.target);
    if (!items?.length) return;
    event.preventDefault();

    // The keyboard's Menu key (or Shift+F10) gives no pointer position:
    // open below the focused element instead.
    let { clientX: x, clientY: y } = event;
    if (x === 0 && y === 0) {
      const box = event.target.getBoundingClientRect();
      x = box.left;
      y = box.bottom;
    }
    open(items, x, y);
  });

  return { close };
}
