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

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function persist(content: string) {
    if (content === lastSaved) return;
    // Capture the attempted value so a flush mid-flight does not re-submit it.
    const attempted = content;
    void Promise.resolve(args.save(attempted))
      .then(() => {
        // Mark clean ONLY after the save actually succeeds.
        lastSaved = attempted;
      })
      .catch((error) => {
        // Leave lastSaved behind so the value stays dirty and retries on the
        // next edit or flush; never record a failed save as clean.
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
