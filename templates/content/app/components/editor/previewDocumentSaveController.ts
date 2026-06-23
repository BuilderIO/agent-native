// Debounced save controller for the row PEEK's primary "Content" body (and its
// title), which — unlike the full-page editor — does NOT use Yjs collab and so
// persists through a plain debounced `update-document` write.
//
// WHY THIS EXISTS (data-loss fix): the peek used a bare `setTimeout` whose
// pending value lived only inside the timer closure. Every lifecycle transition
// that could happen before the ~450ms debounce fired — switching to another row,
// the peek editor unmounting, or the sheet closing / "Open page" navigating —
// CLEARED that timer instead of FLUSHING it, so the latest primary-body edit was
// dropped. The additional (non-primary) Blocks fields already flush-on-release
// via blockFieldSaveController; this controller gives the primary path the SAME
// durability, modeled directly on that controller:
//
//  - A payload is marked clean ONLY after its save promise RESOLVES. A failed
//    save leaves it dirty so it retries on the next edit or flush — never
//    silently recorded as saved.
//  - flush() persists the latest dirty payload immediately (row-switch / unmount
//    / close / Open-page), so a debounce that has not fired yet is not dropped.
//  - mark() adopts fresh server content as the new confirmed baseline (e.g. an
//    agent edit, or a row switch loading a different document) without scheduling
//    a save.
//
// SINGLE-FLIGHT + TRAILING (lost-update safety): the server write is
// unconditional (last request to the DB wins), so we guarantee write order ==
// issue order by never having two saves in flight at once. While a save is in
// flight, edits coalesce into one `pending` payload; when it settles, exactly one
// trailing save fires for the LATEST payload if it still differs. flush() awaits
// the in-flight save and then sends the final payload, so the last value at the
// DB is deterministically the latest content the user typed.

export interface PreviewDocumentPayload {
  title: string;
  content: string;
}

export interface PreviewDocumentSaveController {
  /** Record a title edit. Schedules a debounced save when dirty. */
  changeTitle(title: string): void;
  /** Record a content (primary body) edit. Schedules a debounced save when dirty. */
  changeContent(content: string): void;
  /**
   * Persist the latest dirty payload now (row-switch / unmount / close /
   * Open-page). Resolves after any in-flight save AND the resulting trailing save
   * have settled, so the final DB value is the latest content.
   */
  flush(): Promise<void>;
  /** Cancel any pending debounce without flushing. */
  cancel(): void;
  /** Adopt `payload` as the confirmed-saved baseline (no save scheduled). */
  mark(payload: PreviewDocumentPayload): void;
  /** The payload last CONFIRMED persisted. */
  readonly lastSaved: PreviewDocumentPayload;
  /** The latest payload the user has typed (may differ from lastSaved). */
  readonly pending: PreviewDocumentPayload;
  /** Whether a debounce timer is currently armed. */
  readonly hasPendingTimer: boolean;
  /** Whether a save() call is currently outstanding (in flight). */
  readonly isSaving: boolean;
}

function payloadsEqual(a: PreviewDocumentPayload, b: PreviewDocumentPayload) {
  return a.title === b.title && a.content === b.content;
}

export function createPreviewDocumentSaveController(args: {
  initial: PreviewDocumentPayload;
  save: (payload: PreviewDocumentPayload) => Promise<unknown>;
  onSaved?: (payload: PreviewDocumentPayload) => void;
  onError?: (error: unknown) => void;
  debounceMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): PreviewDocumentSaveController {
  const debounceMs = args.debounceMs ?? 450;
  const setTimeoutFn = args.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = args.clearTimeoutFn ?? clearTimeout;

  let lastSaved: PreviewDocumentPayload = { ...args.initial };
  let pending: PreviewDocumentPayload = { ...args.initial };
  let timer: ReturnType<typeof setTimeout> | null = null;

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
  // latest pending payload always ends up as the final DB write — one at a time.
  function kick() {
    if (inFlight !== null) return; // single-flight: never overlap saves.
    if (payloadsEqual(pending, lastSaved)) return; // nothing dirty.

    const attempted: PreviewDocumentPayload = { ...pending };
    const promise = Promise.resolve(args.save(attempted))
      .then(() => {
        // Mark clean ONLY after the save actually succeeds.
        lastSaved = attempted;
        inFlight = null;
        args.onSaved?.(attempted);
        // A trailing edit may have landed while this save was in flight. Issue
        // exactly one more save for the LATEST payload. Bounded: stops once
        // pending === lastSaved.
        kick();
      })
      .catch((error) => {
        // A failed save never records its value as clean, so the content stays
        // dirty and retries on the NEXT change/flush — no tight retry storm here.
        inFlight = null;
        args.onError?.(error);
      });

    inFlight = promise;
  }

  function schedule() {
    clearTimer();
    if (payloadsEqual(pending, lastSaved)) return;
    timer = setTimeoutFn(() => {
      timer = null;
      kick();
    }, debounceMs);
  }

  return {
    changeTitle(title: string) {
      pending = { ...pending, title };
      schedule();
    },
    changeContent(content: string) {
      pending = { ...pending, content };
      schedule();
    },
    async flush() {
      clearTimer();
      // 1) Wait out any in-flight save so we never overlap it (single-flight)
      //    and so its successful trailing kick has fired.
      while (inFlight !== null) {
        await inFlight;
      }
      // 2) If the latest payload still isn't persisted (a trailing edit, or the
      //    in-flight save failed), send exactly one final save and await it. This
      //    is what makes the last value at the DB deterministically the latest
      //    content. flush is best-effort; a failed save stays dirty.
      if (!payloadsEqual(pending, lastSaved)) {
        kick();
        if (inFlight !== null) await inFlight;
      }
    },
    cancel() {
      clearTimer();
    },
    mark(payload: PreviewDocumentPayload) {
      clearTimer();
      lastSaved = { ...payload };
      pending = { ...payload };
    },
    get lastSaved() {
      return { ...lastSaved };
    },
    get pending() {
      return { ...pending };
    },
    get hasPendingTimer() {
      return timer !== null;
    },
    get isSaving() {
      return inFlight !== null;
    },
  };
}
