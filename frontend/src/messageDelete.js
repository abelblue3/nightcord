// Deleting your own message with a 10-second Undo. Nothing is sent until the
// countdown ends: Undo just puts the message back. At 0, `send({ keepalive })`
// deletes it on the server, which tells everyone else's page to drop it.
//
// Returns { sendNow } so the page can send pending deletes when it's left
// (keepalive lets the request finish after the tab closes).

export function startDelete(msg, { seconds = 10, send, onDone }) {
  let left = seconds;
  let finished = false;

  const line = document.createElement('div');
  line.className = 'msg-undo';
  line.setAttribute('role', 'status');
  const countdown = document.createElement('span');
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'btn-link msg-undo-button';
  undo.textContent = 'Undo';
  line.append(countdown, ' ', undo);

  msg.querySelector('.msg-delete-error')?.remove();
  msg.classList.add('msg-deleting');
  msg.append(line);
  render();
  const timer = setInterval(tick, 1000);

  function render() {
    countdown.textContent = `Deleting in ${left}…`;
  }

  function tick() {
    left -= 1;
    if (left <= 0) finish(false);
    else render();
  }

  function restore() {
    clearInterval(timer);
    msg.classList.remove('msg-deleting');
    line.remove();
  }

  async function finish(keepalive) {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    countdown.textContent = 'Deleting…';
    undo.remove();
    try {
      await send({ keepalive });
      msg.remove();
    } catch (err) {
      restore();
      const error = document.createElement('span');
      error.className = 'msg-delete-error';
      error.textContent = `ERR: ${err.message}`;
      msg.append(error);
    }
    onDone?.();
  }

  undo.addEventListener('click', () => {
    if (finished) return;
    finished = true;
    restore();
    onDone?.();
  });

  return { sendNow: () => finish(true) };
}
