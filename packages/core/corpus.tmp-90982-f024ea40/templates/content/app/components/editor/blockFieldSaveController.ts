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
//
// SINGLE-FLIGHT + TRAILING (lost-update fix): the server write (set-document-
// property → upsert) is unconditional, so the LAST request to reach the DB wins.
// A monotonic sequence only protects local bookkeeping; it cannot reorder two
// requests already in flight. So we guarantee server write order == issue order
// by never having two saves in flight at once:
//
//   - At most ONE save() call is outstanding per field.
//   - While a save is in flight, further edits do not start a new save; they
//     coalesce into a single `pending` payload.
//   - When the in-flight save settles, if `pending` still differs from the last
//     confirmed value, exactly one trailing save is issued for the LATEST
//     pending content. This repeats (one at a time) until quiescent.
//   - flush() awaits the in-flight save (if any) and then sends the final
//     pending content, so the last value committed at the DB is deterministically
//     the latest content the user typed.

export interface BlockFieldSaveController {
  /** Record a user edit. Schedules a debounced save when the value is dirty. */
  change(content: string): void;
  /**
   * Persist the latest dirty content now (unmount / collapse). Resolves after
   * any in-flight save AND the resulting trailing save have settled, so the
   * final DB value is the latest content.
   */
  flush(): Promise<void>;
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
  /** Whether a save() call is currently outstanding (in flight). */
  readonly isSaving: boolean;
  /**
   * Whether this controller has CONFIRMED at least one local save (a save()
   * resolved) since it was created. Once true, `lastSaved` is content this
   * controller itself originated and persisted — so a server value that still
   * differs from `lastSaved` is STALE (the server query hasn't refetched the
   * just-saved value yet), not a genuinely newer external edit. Used by the
   * remount seed/adopt path to avoid showing pre-save content. `mark()` (adopting
   * fresh server content) clears it, since after a mark the baseline IS server.
   */
  readonly hasSavedLocally: boolean;
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
  // Becomes true once a local save() resolves; cleared when mark() adopts a
  // server value as the new baseline. See `hasSavedLocally` doc above.
  let hasSavedLocally = false;

  // The single in-flight save, or null when idle. Edits made while this is set
  // do NOT start a new save; they update `pending` and a trailing save fires
  // when this settles. This is what makes server write order == issue order.
  let inFlight: Promise<void> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  // Start exactly one save if one isn't already running and there is dirty
  // content. When it settles SUCCESSFULLY, kick the next trailing save so the
  // latest pending content always ends up as the final DB write — one at a time.
  function kick() {
    if (inFlight !== null) return; // single-flight: never overlap saves.
    if (pending === lastSaved) return; // nothing dirty to persist.

    const attempted = pending;
    const promise = Promise.resolve(args.save(attempted))
      .then(() => {
        // Mark clean ONLY after the save actually succeeds.
        lastSaved = attempted;
        hasSavedLocally = true;
        inFlight = null;
        // A trailing edit may have landed while this save was in flight. Issue
        // exactly one more save for the LATEST pending content. Bounded: stops
        // once pending === lastSaved.
        kick();
      })
      .catch((error) => {
        // A failed save never records its value as clean, so the content stays
        // dirty (finding 6) and retries on the NEXT change() or flush() — we do
        // NOT auto-retry here, to avoid a tight retry storm against a failing
        // backend.
        inFlight = null;
        args.onError?.(error);
      });

    inFlight = promise;
  }

  return {
    change(content: string) {
      pending = content;
      clearTimer();
      if (content === lastSaved) return;
      timer = setTimeoutFn(() => {
        timer = null;
        kick();
      }, debounceMs);
    },
    async flush() {
      clearTimer();
      // 1) Wait out any in-flight save so we never overlap with it (single-
      //    flight) and so its successful trailing kick has fired.
      while (inFlight !== null) {
        await inFlight;
      }
      // 2) If the latest content still isn't persisted (a trailing edit, or the
      //    in-flight save failed), send exactly one final save for the LATEST
      //    pending content and await it. This is what makes the last value at the
      //    DB deterministically the latest content. We do NOT loop on repeated
      //    failure — flush is best-effort; a failed save stays dirty for the next
      //    edit/flush.
      if (pending !== lastSaved) {
        kick();
        if (inFlight !== null) await inFlight;
      }
    },
    cancel() {
      clearTimer();
    },
    mark(content: string) {
      clearTimer();
      lastSaved = content;
      pending = content;
      // The baseline is now server-provided content, not a local save the server
      // hasn't echoed — so server props are no longer "behind" this controller.
      hasSavedLocally = false;
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
    get isSaving() {
      return inFlight !== null;
    },
    get hasSavedLocally() {
      return hasSavedLocally;
    },
  };
}
