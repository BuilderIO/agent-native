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
// unconditional (last request to the DB wins). While a save is in flight, edits
// coalesce into one `pending` payload; when it settles, exactly one trailing
// save fires for the LATEST payload if it still differs.
//
// SYNCHRONOUS FINAL DISPATCH + PER-DOC ORDERING (async-flush-vs-sync-teardown
// race fix): the peek's ONE controller services MANY document ids over its life
// — the row switches and the controller is told to target a different id. A
// flush triggered by that switch must persist the OLD row's trailing edit to the
// OLD id, and the write must be DISPATCHED before the caller rebases the target
// / tears down / navigates (call sites invoke flush() fire-and-forget). The old
// flush() DEFERRED the trailing save behind awaiting the in-flight save, so the
// deferred save dispatched AFTER the rebase — lost, or retargeted to the new
// row. Now:
//   - Every dispatch binds the target document id at the MOMENT of dispatch (via
//     `resolveTargetId()`), so the id can never drift to a row switched-to later.
//   - flush() dispatches the final save SYNCHRONOUSLY (it does not await the
//     in-flight save first), bound to the id captured right then.
//   - All dispatches (debounced and flush) go through a per-doc-id serialization
//     lane (`enqueuePreviewSave`) so writes for the SAME id commit in issue order
//     (latest payload final) and writes for DIFFERENT ids are independent. This
//     replaces the await-the-in-flight-save ordering guarantee with an
//     enqueue-order one that does not require deferring dispatch.

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
   * Open-page). The final save is DISPATCHED SYNCHRONOUSLY before this returns,
   * bound to the document id resolved at this moment — so a fire-and-forget
   * caller can rebase / tear down / navigate immediately and the trailing edit
   * still lands on the correct (old) document. The returned promise resolves
   * once that final save (and any prior in-flight save it ordered behind on the
   * per-doc lane) has settled.
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
  /**
   * Persist `payload` to `documentId`. The id is passed explicitly (resolved at
   * DISPATCH time, see `resolveTargetId`) rather than read from a caller closure
   * at write time, so a save can never be retargeted to a row switched-to after
   * it was issued.
   */
  save: (documentId: string, payload: PreviewDocumentPayload) => Promise<unknown>;
  /**
   * The document id the current pending payload belongs to, read SYNCHRONOUSLY
   * at the moment a save is dispatched. The caller sets the target at edit time
   * and again on row-switch; binding it at dispatch (not in the save closure)
   * is what guarantees the trailing edit commits to the OLD row.
   */
  resolveTargetId: () => string;
  /**
   * Enqueue `run` on the per-document-id serialization lane. Saves for the same
   * id commit in enqueue order (latest payload final); different ids are
   * independent. Injected so the lane can be substituted in tests.
   */
  enqueue: (documentId: string, run: () => Promise<unknown>) => Promise<void>;
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

  // The single in-flight save, or null when idle. A debounced edit made while
  // this is set does NOT start a new save; it updates `pending` and a trailing
  // save fires when this settles. Combined with the per-doc lane, server write
  // order == issue order for a given document id.
  let inFlight: Promise<void> | null = null;
  // The (targetId, payload) the in-flight save is persisting, or null when idle.
  // flush() uses this to avoid issuing a redundant duplicate save when the save
  // already in flight ALREADY covers the latest pending payload for this id.
  let inFlightTarget: { id: string; payload: PreviewDocumentPayload } | null =
    null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  // Issue exactly one save for `attempted` bound to `targetId`, routed through
  // that id's serialization lane. The enqueue is synchronous, so by the time
  // this returns the write is committed-to on the lane. On success the baseline
  // advances to `attempted` (only what we actually persisted is ever marked
  // clean); a failure leaves it dirty for the next edit/flush. `inFlight` tracks
  // THIS save so a later trailing dispatch cannot overlap it, and is cleared on
  // settle only if it is still this same save (a flush may have superseded it).
  function issueSave(
    targetId: string,
    attempted: PreviewDocumentPayload,
  ): Promise<void> {
    let promise: Promise<void>;
    promise = args
      .enqueue(targetId, () => args.save(targetId, attempted))
      .then(() => {
        lastSaved = attempted;
        if (inFlight === promise) {
          inFlight = null;
          inFlightTarget = null;
        }
        args.onSaved?.(attempted);
        // A trailing edit may have landed while this save was in flight. Issue
        // exactly one more for the LATEST payload. Bounded: stops once quiescent.
        dispatch();
      })
      .catch((error) => {
        if (inFlight === promise) {
          inFlight = null;
          inFlightTarget = null;
        }
        args.onError?.(error);
      });
    inFlight = promise;
    inFlightTarget = { id: targetId, payload: attempted };
    return promise;
  }

  // Debounce/trailing dispatch: single-flight guarded. Binds the target id at
  // the MOMENT of dispatch, so a row-switch that rebases the caller's target
  // immediately after cannot retarget this save. Returns the save promise, or
  // null if a save is already in flight or nothing is dirty.
  function dispatch(): Promise<void> | null {
    if (inFlight !== null) return null; // single-flight: never overlap saves.
    if (payloadsEqual(pending, lastSaved)) return null; // nothing dirty.
    return issueSave(args.resolveTargetId(), { ...pending });
  }

  function schedule() {
    clearTimer();
    if (payloadsEqual(pending, lastSaved)) return;
    timer = setTimeoutFn(() => {
      timer = null;
      dispatch();
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
    flush() {
      clearTimer();
      // Nothing dirty: no-op, no double-save of clean content. If a save is
      // still settling, return it so the caller can await full quiescence.
      if (payloadsEqual(pending, lastSaved)) {
        return inFlight ?? Promise.resolve();
      }
      // Already covered: the in-flight save is for THIS id and THIS exact
      // payload, so issuing another would be a redundant duplicate write. Just
      // await it instead of double-saving. (The id must match too — a save for a
      // DIFFERENT id does not cover this pending payload.)
      const targetId = args.resolveTargetId();
      if (
        inFlight !== null &&
        inFlightTarget !== null &&
        inFlightTarget.id === targetId &&
        payloadsEqual(inFlightTarget.payload, pending)
      ) {
        return inFlight;
      }
      // SYNCHRONOUS final dispatch. We do NOT await the in-flight save first:
      // the whole point is that the final write must be DISPATCHED before the
      // caller rebases / tears down / navigates (call sites invoke flush()
      // fire-and-forget). We capture the target id and the latest payload RIGHT
      // NOW and issue the final save immediately — even if another save for this
      // id is already in flight. The per-doc lane serializes it AFTER that
      // in-flight save, so the latest payload still commits last for the id;
      // binding the id here (not in a deferred .then) guarantees it lands on the
      // OLD row even if a row-switch rebases the caller's target on the very next
      // line. issueSave sets `inFlight` to this save, so the prior in-flight
      // save's trailing dispatch sees single-flight and will not double-send.
      // flush is best-effort: a failed save stays dirty for the next edit/flush.
      return issueSave(targetId, { ...pending });
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
