// A Windows 95-style window floating over the page: drag it by its title bar
// (or focus the title bar and use the arrow keys), resize it from its corner
// grip, shrink it to its title bar, maximize it, or close it. It knows nothing
// about what it shows -- callers put their content in `body`.

const KEY_STEP = 16;
const CASCADE_STEP = 24;
const EDGE = 16;
const START_WIDTH = 240; // matches .retro-window in style.css
const MIN_SIZE = { free: { width: 280, height: 220 }, aspect: { width: 160, height: 0 } };
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

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

// Options:
//   at            { left, top } to open there instead of cascading
//   className     a style modifier (e.g. 'chat-window')
//   resize        'free' (width and height) or 'aspect' (width; the height
//                 follows the content's aspect ratio) -- adds a corner grip
//   extraButtons  elements placed in the title bar before _ □ ×
//   close         { label, action } to make × do something other than hide
//   onHide        called after × hides the window (the default close)
export function createWindow({ title, onHide, at, className, resize, extraButtons = [], close }) {
  const element = document.createElement('section');
  element.className = ['retro-window', className, resize && `resize-${resize}`].filter(Boolean).join(' ');
  element.setAttribute('aria-label', title);

  const bar = document.createElement('div');
  bar.className = 'retro-titlebar';
  bar.tabIndex = 0;
  bar.title = 'Drag to move, or use the arrow keys';
  const name = document.createElement('span');
  name.className = 'retro-title';
  name.textContent = title;
  const minimizeButton = titleButton('_', `Minimize ${title}`);
  const maximizeButton = titleButton('□', `Maximize ${title}`);
  const closeButton = titleButton('×', close?.label || `Hide ${title}`);
  const buttons = document.createElement('div');
  buttons.className = 'retro-title-buttons';
  buttons.append(...extraButtons, minimizeButton, maximizeButton, closeButton);
  bar.append(name, buttons);

  const body = document.createElement('div');
  body.className = 'retro-body';
  element.append(bar, body);

  let x = 0;
  let y = 0;
  let ratio = 16 / 9; // width / height, for aspect-locked windows

  // Keeps the window on screen, whatever the viewport. (Before it's on the
  // page its width reads 0, so assume the starting size.)
  function moveTo(left, top) {
    const width = element.offsetWidth || Math.min(START_WIDTH, window.innerWidth - EDGE);
    x = clamp(left, 0, window.innerWidth - width);
    y = clamp(top, 0, window.innerHeight - bar.offsetHeight);
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }

  function currentWidth() {
    return parseFloat(element.style.width) || element.offsetWidth || START_WIDTH;
  }

  function currentHeight() {
    return parseFloat(element.style.height) || element.offsetHeight;
  }

  // Never smaller than the minimum, never past the viewport's right/bottom.
  function setSize(width, height) {
    const min = MIN_SIZE[resize] || MIN_SIZE.aspect;
    element.style.width = `${clamp(width, min.width, window.innerWidth - x)}px`;
    if (resize === 'free') element.style.height = `${clamp(height, min.height, window.innerHeight - y)}px`;
  }

  function bringToFront() {
    element.style.zIndex = String(++topLayer);
  }

  if (at) {
    moveTo(at.left, at.top);
  } else {
    // New windows cascade down from the top right, like old desktop popups.
    const offset = (opened++ % 8) * CASCADE_STEP;
    moveTo(window.innerWidth - START_WIDTH - EDGE - offset, 80 + offset);
  }
  bringToFront();

  element.addEventListener('pointerdown', bringToFront);

  // Drags with mouse, touch or pen; `onMove` gets how far the pointer went.
  function dragFrom(handle, onMove) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const start = onMove.start?.();
      handle.setPointerCapture?.(event.pointerId);
      const drag = (move) => onMove(move.clientX - startX, move.clientY - startY, start);
      const stop = () => {
        handle.removeEventListener('pointermove', drag);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', drag);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    });
  }

  const moveBy = (dx, dy, start) => moveTo(start.x + dx, start.y + dy);
  moveBy.start = () => ({ x, y });
  dragFrom(bar, moveBy);

  // Keyboard alternatives, so dragging is never the only way.
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function onArrows(target, act) {
    target.addEventListener('keydown', (event) => {
      const direction = ARROWS[event.key];
      if (!direction) return;
      event.preventDefault();
      const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
      act(direction[0] * step, direction[1] * step);
    });
  }
  onArrows(bar, (dx, dy) => moveTo(x + dx, y + dy));

  if (resize) {
    const grip = document.createElement('div');
    grip.className = 'retro-grip';
    grip.tabIndex = 0;
    grip.setAttribute('role', 'button');
    grip.setAttribute('aria-label', `Resize ${title} (arrow keys)`);
    grip.title = 'Drag to resize, or use the arrow keys';
    element.append(grip);
    const resizeBy = (dx, dy, start) => setSize(start.width + dx, start.height + dy);
    resizeBy.start = () => ({ width: currentWidth(), height: currentHeight() });
    dragFrom(grip, resizeBy);
    onArrows(grip, (dx, dy) => setSize(currentWidth() + dx, currentHeight() + dy));
  }

  minimizeButton.addEventListener('click', () => {
    const minimized = element.classList.toggle('is-minimized');
    minimizeButton.setAttribute('aria-label', minimized ? `Restore ${title}` : `Minimize ${title}`);
  });

  // Maximize fills most of the screen; pressing it again puts back the
  // position and size from before.
  let beforeMaximize = null;
  maximizeButton.addEventListener('click', () => {
    if (beforeMaximize) {
      element.style.width = beforeMaximize.width;
      element.style.height = beforeMaximize.height;
      moveTo(beforeMaximize.x, beforeMaximize.y);
      beforeMaximize = null;
      maximizeButton.setAttribute('aria-label', `Maximize ${title}`);
      return;
    }
    beforeMaximize = { x, y, width: element.style.width, height: element.style.height };
    moveTo(EDGE / 2, EDGE / 2);
    const width = window.innerWidth - EDGE;
    const height = window.innerHeight - EDGE;
    if (resize === 'aspect') {
      // As wide as fits while the whole picture stays on screen.
      element.style.width = `${Math.min(width, (height - bar.offsetHeight) * ratio)}px`;
    } else {
      element.style.width = `${width}px`;
      if (resize === 'free') element.style.height = `${height}px`;
    }
    maximizeButton.setAttribute('aria-label', `Restore ${title} size`);
  });

  closeButton.addEventListener('click', () => {
    if (close) {
      close.action();
      return;
    }
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
    // For aspect-locked windows: the content's real shape (e.g. a camera).
    setAspectRatio(width, height) {
      if (!width || !height) return;
      ratio = width / height;
      body.style.aspectRatio = `${width} / ${height}`;
    },
    remove: () => element.remove(),
  };
}
