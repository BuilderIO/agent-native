// A commit re-parses and re-validates the whole screen; running it after the
// frame that shows its preview keeps the triggering input from freezing.
// Commits stay FIFO. Undo, redo, page hide and the next key or pointer press
// flush first, so no command reads a screen missing an edit already made.
const pending: Array<() => void> = [];
let scheduled = false;

// Background tabs pause animation frames; the timer still lands the commit.
const FALLBACK_DELAY_MS = 100;

function afterNextFrame(run: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => setTimeout(run, 0));
  }
  setTimeout(run, FALLBACK_DELAY_MS);
}

export function flushCommitsAfterPaint(): void {
  scheduled = false;
  let firstError: unknown;
  let failed = false;
  while (pending.length > 0) {
    const commit = pending.shift()!;
    try {
      commit();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}

export function commitAfterPaint(commit: () => void): void {
  pending.push(commit);
  if (scheduled) return;
  scheduled = true;
  let ran = false;
  afterNextFrame(() => {
    if (ran) return;
    ran = true;
    flushCommitsAfterPaint();
  });
}

export function flushCommitsOnInput(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
): () => void {
  const flush = () => flushCommitsAfterPaint();
  const options = { capture: true };
  target.addEventListener("keydown", flush, options);
  target.addEventListener("pointerdown", flush, options);
  return () => {
    target.removeEventListener("keydown", flush, options);
    target.removeEventListener("pointerdown", flush, options);
  };
}
