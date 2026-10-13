import { blockStudent, reportStudent } from './api.js';
import { createWindow } from './floatingWindow.js';
import { setBusy } from './ui.js';

// Reporting a student: a reason, optional details, then "Report received"
// with an offer to block them too. The server keeps a copy of the room's
// recent messages with the report (up to `messageId` when there is one).

const REASONS = [
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate speech'],
  ['sexual', 'Sexual content'],
  ['spam', 'Spam'],
  ['self_harm', 'Self-harm or suicide risk'],
  ['other', 'Something else'],
];
const MAX_DETAILS = 500;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function openReportWindow({ userId, name }, { roomId, messageId, isBlocked = () => false, onBlock, at } = {}) {
  const win = createWindow({
    title: `Report ${name}`,
    className: 'report-window',
    at,
    close: { label: `Close the report on ${name}`, action: () => win.remove() },
  });

  const form = el('form', 'report-form');
  const reasons = el('fieldset', 'report-reasons');
  reasons.append(el('legend', null, 'What happened?'));
  for (const [value, label] of REASONS) {
    const choice = el('label', 'choice');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'reason';
    radio.value = value;
    choice.append(radio, ` ${label}`);
    reasons.append(choice);
  }

  // A report isn't read straight away, so point to help that is.
  const crisis = el(
    'p',
    'report-crisis',
    "If someone may be in danger right now, call or text 988 (Suicide & Crisis Lifeline, US) or 911 — don't wait for this report.",
  );
  crisis.hidden = true;

  const detailsLabel = el('label', 'report-details-label', 'Anything else? (optional)');
  const details = document.createElement('textarea');
  details.className = 'report-details';
  details.maxLength = MAX_DETAILS;
  details.rows = 3;
  const counter = el('span', 'report-counter', `0/${MAX_DETAILS}`);
  details.addEventListener('input', () => (counter.textContent = `${details.value.length}/${MAX_DETAILS}`));
  detailsLabel.append(details);

  const error = el('p', 'report-error');
  error.setAttribute('role', 'alert');
  const send = el('button', 'btn btn-small btn-primary report-send', 'Send report');
  send.type = 'submit';
  send.disabled = true;
  const cancel = el('button', 'btn btn-small', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => win.remove());
  const actions = el('div', 'report-actions');
  actions.append(send, cancel);

  reasons.addEventListener('change', () => {
    const reason = form.querySelector('input[name="reason"]:checked')?.value;
    send.disabled = !reason;
    crisis.hidden = reason !== 'self_harm';
  });

  form.append(reasons, crisis, detailsLabel, counter, error, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const restore = setBusy(send, 'SENDING...');
    error.textContent = '';
    try {
      await reportStudent({
        reportedId: userId,
        reason: form.querySelector('input[name="reason"]:checked').value,
        roomId,
        messageId,
        details: details.value.trim() || undefined,
      });
    } catch (err) {
      restore();
      error.textContent = `ERR: ${err.message}`;
      return;
    }
    showReceived();
  });

  function showReceived() {
    const done = el('div', 'report-done');
    done.append(el('p', null, 'Report received. Someone will review it.'));
    if (!isBlocked(userId)) {
      const block = el('button', 'btn btn-small report-block', `Block ${name} too`);
      block.type = 'button';
      block.addEventListener('click', async () => {
        const restore = setBusy(block, 'BLOCKING...');
        try {
          await blockStudent(userId);
          onBlock?.(userId);
          block.replaceWith(el('p', null, "Blocked. You won't see their messages."));
        } catch (err) {
          restore();
          done.append(el('p', 'report-error', `ERR: ${err.message}`));
        }
      });
      done.append(block);
    }
    win.body.replaceChildren(done);
  }

  win.body.append(form);
  document.querySelector('.screen').append(win.element);
  win.show();
  win.element.querySelector('.retro-titlebar')?.focus();
  return win;
}
