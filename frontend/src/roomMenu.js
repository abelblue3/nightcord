// Which items the room page's right-click menu shows, for what was clicked.
// Kept apart from the page so it can be tested on its own.
//
// ctx: currentUserId, lampOn(), chatHidden(), hiddenVideos(), inCall(), and
// the actions (viewProfile, copy, block, lamp, openChat, showVideos,
// myProfile, logOut).

export function roomMenuItems(target, ctx) {
  const { actions } = ctx;
  const msg = target.closest?.('.msg');

  if (msg) {
    const userId = Number(msg.dataset.userId);
    const author = msg.querySelector('.msg-author');
    const name = author?.textContent ?? 'someone';
    const text = msg.querySelector('.msg-body')?.textContent ?? '';
    const items = [
      {
        label: 'View profile',
        action: () => {
          const spot = (author ?? msg).getBoundingClientRect();
          actions.viewProfile(userId, name, { left: spot.left, top: spot.bottom + 4 });
        },
      },
      { label: 'Copy message', action: () => actions.copy(text) },
    ];
    if (userId !== ctx.currentUserId) {
      items.push({ label: `Block ${name}`, confirmLabel: `Sure? Block ${name}`, action: () => actions.block(userId) });
    }
    return items;
  }

  const items = [{ label: ctx.lampOn() ? 'Lamp off' : 'Lamp on', action: actions.lamp }];
  if (ctx.chatHidden()) items.push({ label: 'Open chat', action: actions.openChat });
  const hidden = ctx.hiddenVideos();
  if (hidden > 0) items.push({ label: `Show videos (${hidden})`, action: actions.showVideos });
  items.push(
    { label: 'My profile', action: actions.myProfile },
    // Leaving the page would end the call, as in the avatar menu.
    { label: 'Log out', action: actions.logOut, disabled: ctx.inCall() },
  );
  return items;
}
