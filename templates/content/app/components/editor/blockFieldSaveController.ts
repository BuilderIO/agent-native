// Debounced save controller for an ADDITIONAL Blocks field's editor.
//
// Owns the only place that decides what is "saved" vs "dirty", so the rules are
// testable without rendering the editor (which pulls in TipTap):
//
//  - A value is marked clean ONLY after the save promise RESOLVES. A failed save
//    leaves the value dirty so it retries on the next edit or flush — it is never
//    silently recorded as saved (review finding 6).
//  - flush() persists the latest dirty content immediately, used on unmount /
//    collapse so a debounce that has not fired yet is not dropped (finding 3).
//  - mark() adopts fresh server content as the new confirmed baseline (e.g. an
//    agent edit) without scheduling a save.
//  - Every save carries a monotonic sequence number. Only the result of the
//    LATEST issued save is allowed to win: a slower earlier save (A) that
//    resolves after a newer save (B) is ignored, so a stale write can never
//    overwrite newer content (lost-update guard). flush() supersedes any
//    in-flight save by issuing the latest content as the newest sequence, so the
//    final persisted value is deterministically the latest content.

export interface BlockFieldSaveController {
  /** Record a user edit. Schedules a debounced save when the value is dirty. */
  change(content: string): void;
  /** Persist the latest dirty content now (unmount / collapse). */
  flush(): void;
  /** Cancel any pending debounce without flushing. */
  cancel(): void;
  /** Adopt `content` as the confirmed-saved baseline (no save scheduled). */
  mark(content: string): void;
  /** The value last CONFIRMED persisted. */
  readonly lastSaved: string;
  /** The latest value the user has typed (may differ from lastSaved). */
  readonly pending: string;
  /** Whether a debounce timer is currently armed. */
  readonly hasPendingTimer: boolean;
}

export function createBlockFieldSaveController(args: {
  initialContent: string;
  save: (content: string) => Promise<unknown>;
  onError?: (error: unknown) => void;
  debounceMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): BlockFieldSaveController {
  const debounceMs = args.debounceMs ?? 500;
  const setTimeoutFn = args.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = args.clearTimeoutFn ?? clearTimeout;

  let lastSaved = args.initialContent;
  let pending = args.initialContent;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Monotonic id assigned to each issued save; the most recent one to be issued.
  let issuedSeq = 0;
  // The highest sequence whose result has already been applied (committed or
  // failed). A save older than this is stale and must not touch lastSaved.
  let settledSeq = 0;

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function persist(content: string) {
    if (content === lastSaved) return;
    // Capture the attempted value so a flush mid-flight does not re-submit it,
    // and a sequence so a slower earlier save can never overwrite a newer one.
    const attempted = content;
    const seq = ++issuedSeq;
    void Promise.resolve(args.save(attempted))
      .then(() => {
        // Ignore a stale save that resolved after a newer save was issued — its
        // value is older than what the user has since committed.
        if (seq < settledSeq) return;
        settledSeq = seq;
        // Mark clean ONLY after the save actually succeeds.
        lastSaved = attempted;
      })
      .catch((error) => {
        // A failed save never records its value as clean, so the content stays
        // dirty and retries on the next edit or flush (finding 6). Still advance
        // settledSeq so an even-older save can't later "win", but only if this is
        // not itself already superseded.
        if (seq >= settledSeq) settledSeq = seq;
        args.onError?.(error);
      });
  }

  return {
    change(content: string) {
      pending = content;
      clearTimer();
      if (content === lastSaved) return;
      timer = setTimeoutFn(() => {
        timer = null;
        persist(content);
      }, debounceMs);
    },
    flush() {
      clearTimer();
      if (pending !== lastSaved) persist(pending);
    },
    cancel() {
      clearTimer();
    },
    mark(content: string) {
      clearTimer();
      lastSaved = content;
      pending = content;
    },
    get lastSaved() {
      return lastSaved;
    },
    get pending() {
      return pending;
    },
    get hasPendingTimer() {
      return timer !== null;
    },
  };
}
