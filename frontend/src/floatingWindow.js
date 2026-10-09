// A Windows 95-style window floating over the page: drag it by its title bar
// (or focus the title bar and use the arrow keys), shrink it to its title bar,
// switch between small and large, or hide it. It knows nothing about what it
// shows -- callers put their content in `body`.

const KEY_STEP = 16;
const CASCADE_STEP = 24;
const EDGE = 16;
const SMALL_WIDTH = 240; // matches .retro-window in style.css
let topLayer = 100;
let opened = 0;

function titleButton(text, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'retro-title-button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

// `at` ({ left, top }) opens the window there instead of cascading;
// `className` adds a style modifier (e.g. a wider chat window).
export function createWindow({ title, onHide, at, className }) {
  const element = document.createElement('section');
  element.className = className ? `retro-window ${className}` : 'retro-window';
  element.setAttribute('aria-label', title);

  const bar = document.createElement('div');
  bar.className = 'retro-titlebar';
  bar.tabIndex = 0;
  bar.title = 'Drag to move, or use the arrow keys';
  const name = document.createElement('span');
  name.className = 'retro-title';
  name.textContent = title;
  const minimizeButton = titleButton('_', `Minimize ${title}`);
  const sizeButton = titleButton('□', `Make ${title} bigger`);
  const hideButton = titleButton('×', `Hide ${title}`);
  const buttons = document.createElement('div');
  buttons.className = 'retro-title-buttons';
  buttons.append(minimizeButton, sizeButton, hideButton);
  bar.append(name, buttons);

  const body = document.createElement('div');
  body.className = 'retro-body';
  element.append(bar, body);

  let x = 0;
  let y = 0;

  // Keeps the window on screen, whatever the viewport. (Before it's on the
  // page its width reads 0, so assume the small size.)
  function moveTo(left, top) {
    const width = element.offsetWidth || Math.min(SMALL_WIDTH, window.innerWidth - EDGE);
    x = Math.min(Math.max(left, 0), Math.max(0, window.innerWidth - width));
    y = Math.min(Math.max(top, 0), Math.max(0, window.innerHeight - bar.offsetHeight));
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  function bringToFront() {
    element.style.zIndex = String(++topLayer);
  }

  if (at) {
    moveTo(at.left, at.top);
  } else {
    // New windows cascade down from the top right, like old desktop popups.
    const offset = (opened++ % 8) * CASCADE_STEP;
    moveTo(window.innerWidth - SMALL_WIDTH - EDGE - offset, 80 + offset);
  }
  bringToFront();

  element.addEventListener('pointerdown', bringToFront);

  bar.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    const startX = event.clientX - x;
    const startY = event.clientY - y;
    bar.setPointerCapture?.(event.pointerId);
    const drag = (move) => moveTo(move.clientX - startX, move.clientY - startY);
    const stop = () => {
      bar.removeEventListener('pointermove', drag);
      bar.removeEventListener('pointerup', stop);
      bar.removeEventListener('pointercancel', stop);
    };
    bar.addEventListener('pointermove', drag);
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  });

  // The keyboard way to move it, so dragging isn't the only way.
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  bar.addEventListener('keydown', (event) => {
    const direction = ARROWS[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    moveTo(x + direction[0] * step, y + direction[1] * step);
  });

  minimizeButton.addEventListener('click', () => {
    const minimized = element.classList.toggle('is-minimized');
    minimizeButton.setAttribute('aria-label', minimized ? `Restore ${title}` : `Minimize ${title}`);
  });

  sizeButton.addEventListener('click', () => {
    const large = element.classList.toggle('is-large');
    sizeButton.setAttribute('aria-label', large ? `Make ${title} smaller` : `Make ${title} bigger`);
    moveTo(x, y); // a bigger window may now poke off screen
  });

  hideButton.addEventListener('click', () => {
    element.hidden = true;
    onHide?.();
  });

  return {
    element,
    body,
    title,
    show() {
      element.hidden = false;
      bringToFront();
      moveTo(x, y);
    },
    remove: () => element.remove(),
  };
}
