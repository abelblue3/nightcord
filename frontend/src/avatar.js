// A student's avatar: their Google/Microsoft photo if they opted in,
// otherwise a pixel-art person on a background picked from the theme by their
// id (so people look different from each other). Both sit inside a pixel-art
// circle frame. Static SVG markup only -- the photo URL is set as an
// attribute, never as HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

// A 16x16 pixel circle: for each row, the columns of the ring's pixels.
const RING_ROWS = [
  [[5, 10]], [[3, 4], [11, 12]], [[2, 2], [13, 13]], [[1, 1], [14, 14]], [[1, 1], [14, 14]],
  [[0, 0], [15, 15]], [[0, 0], [15, 15]], [[0, 0], [15, 15]], [[0, 0], [15, 15]], [[0, 0], [15, 15]],
  [[0, 0], [15, 15]], [[1, 1], [14, 14]], [[1, 1], [14, 14]], [[2, 2], [13, 13]], [[3, 4], [11, 12]],
  [[5, 10]],
];

// The pixel person (16x16 grid): head and shoulders.
const PERSON = [
  [6, 3, 4, 1], [5, 4, 6, 3], [6, 7, 4, 1], [4, 10, 8, 1], [3, 11, 10, 4],
];

const TINTS = 4; // .avatar-tint-0 .. -3 in style.css

function pixels(svg, rects, className) {
  const group = document.createElementNS(SVG_NS, 'g');
  if (className) group.setAttribute('class', className);
  for (const [x, y, width, height] of rects) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
    group.append(rect);
  }
  svg.append(group);
}

function pixelSvg(className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

export function renderAvatar({ avatarUrl, userId, size = 32 }) {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.style.setProperty('--avatar-size', `${size}px`);

  if (avatarUrl) {
    const img = document.createElement('img');
    img.className = 'avatar-photo';
    img.src = avatarUrl;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    avatar.append(img);
  } else {
    const person = pixelSvg(`avatar-pixel avatar-tint-${Math.abs(Number(userId) || 0) % TINTS}`);
    pixels(person, [[0, 0, 16, 16]], 'avatar-bg');
    pixels(person, PERSON, 'avatar-person');
    avatar.append(person);
  }

  const ring = pixelSvg('avatar-ring');
  pixels(ring, RING_ROWS.flatMap((spans, y) => spans.map(([from, to]) => [from, y, to - from + 1, 1])));
  avatar.append(ring);
  return avatar;
}
