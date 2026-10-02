// A commit re-parses and re-validates the whole screen; running it after the
// frame that shows its preview keeps the triggering input from freezing.
// Commits stay FIFO, and anything that reads history must flush first.
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
