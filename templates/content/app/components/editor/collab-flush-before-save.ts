/**
 * A healthy collaboration post lands well inside this. Past it the save goes
 * ahead while the post keeps trying: a save held behind a stalled post can be
 * lost with the tab.
 */
export const COLLAB_FLUSH_BEFORE_SAVE_MS = 2_000;

/** Whether this tab's live edits reached the server before the save waits no longer. */
export function flushBeforeSave(
  flush: () => Promise<boolean>,
  waitMs = COLLAB_FLUSH_BEFORE_SAVE_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), waitMs);
  });
  return Promise.race([flush(), stalled]).finally(() => clearTimeout(timer));
}
