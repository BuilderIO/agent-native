/**
 * The Cmd+Z handler in DeckContext deliberately ignores keystrokes while the
 * user is typing, so the text editor keeps its own history. A menu item or
 * button has no such escape hatch: without committing first, invoking undo
 * mid-edit would skip the in-progress text and undo the deck op behind it,
 * silently discarding what was just typed.
 */
export function commitActiveEditThenRun(run: () => void) {
  const active = document.activeElement as HTMLElement | null;
  if (
    active &&
    (active.isContentEditable ||
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA")
  ) {
    active.blur();
    requestAnimationFrame(run);
    return;
  }
  run();
}
