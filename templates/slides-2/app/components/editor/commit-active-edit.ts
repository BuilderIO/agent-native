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
