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
//    agent edit) without scheduling a save.
//
// ONE CONTROLLER PER DOCUMENT ID (race-class elimination): this controller is
// bound to a SINGLE `documentId` for its entire life and NEVER retargets. The
// peek services many rows over its lifetime by acquiring a per-doc controller
// from `previewDocumentSaveRegistry` and releasing it on row-switch — exactly
// like the additional Blocks fields, which mount/unmount per (document, field)
// and never rebase a live controller's target. Two prior bugs came from the old
// single-controller-with-rebased-target design and are now STRUCTURALLY
// impossible:
//
//   1. Lane queue-jump (the per-doc serialization lane's `running`/`tail`
//      microtask gap). Gone: with a single-flight controller per doc id there is
//      never more than one save in flight for the id, so there is nothing to
//      serialize across — the lane is deleted entirely (no second mechanism).
//   2. Stale completion after rebase. An OLD-row in-flight save that resolved
//      AFTER a row-switch `mark()` used to overwrite the SHARED controller's
//      `lastSaved` with the old payload and trigger a redundant save against the
//      NEW row's baseline. Gone: each controller's `lastSaved`/`pending`/in-flight
//      state belongs to ITS doc only; a stale completion can only ever advance
//      ITS OWN baseline (correct), never another row's, because the controller's
//      doc id is fixed at creation.
//
// SINGLE-FLIGHT + TRAILING (lost-update safety): the server write is
// unconditional (last request to the DB wins). Because at most one save() per
// controller is ever outstanding, server write order == issue order for the doc.
// While a save is in flight, edits coalesce into one `pending` payload; when it
// settles, exactly one trailing save fires for the LATEST payload if it differs.
//
// SYNCHRONOUS FINAL DISPATCH (async-flush-vs-sync-teardown race fix): call sites
// invoke flush() fire-and-forget on row-switch / close / Open-page / unmount, so
// the final write must be DISPATCHED (save() invoked) before the caller tears
// down or navigates. flush() therefore issues the final save SYNCHRONOUSLY — it
// does NOT await the in-flight save first. The save is bound to this controller's
// fixed doc id, so it can never be retargeted; single-flight guarantees it does
// not overlap a prior save for the id.

export interface PreviewDocumentPayload {
  title: string;
  content: string;
  loadedUpdatedAt?: string;
  loadedContentWasEmpty?: boolean;
}

export interface PreviewDocumentSaveDeferred {
  outcome: "deferred";
  reason: "hydration" | "conflict";
  conflictSnapshot?: PreviewDocumentDraftSnapshot;
}

export interface PreviewDocumentSaveAdapter {
  save: (
    documentId: string,
    payload: PreviewDocumentPayload,
    baseline?: PreviewDocumentPayload,
  ) => Promise<unknown>;
  onSaved?: (payload: PreviewDocumentPayload) => void;
  onError?: (error: unknown) => void;
  onDraftConflict?: (snapshot: PreviewDocumentDraftSnapshot) => void;
}

export interface PreviewDocumentDraftSnapshot {
  lastSaved: PreviewDocumentPayload;
  pending: PreviewDocumentPayload;
  deferredReason: PreviewDocumentSaveDeferred["reason"] | null;
}

/**
 * The save could not run yet, but the payload is still user-owned and must stay
 * dirty until a later flush can persist it. This is intentionally different
 * from success: callers must never advance or reset the confirmed baseline.
 */
export function deferredPreviewDocumentSave(
  reason: PreviewDocumentSaveDeferred["reason"] = "hydration",
  conflictSnapshot?: PreviewDocumentDraftSnapshot,
): PreviewDocumentSaveDeferred {
  return { outcome: "deferred", reason, conflictSnapshot };
}

export interface PreviewDocumentSaveController {
  /** The document id this controller is permanently bound to. */
  readonly documentId: string;
  /** Record a title edit. Schedules a debounced save when dirty. */
  changeTitle(title: string): void;
  /** Record a content (primary body) edit. Schedules a debounced save when dirty. */
  changeContent(content: string): void;
  /**
   * Persist the latest dirty payload now (row-switch / unmount / close /
   * Open-page). The final save is DISPATCHED SYNCHRONOUSLY before this returns,
   * bound to this controller's fixed document id — so a fire-and-forget caller
   * can tear down / navigate immediately and the trailing edit still lands on the
   * correct document. The returned promise resolves once that final save (and any
   * in-flight save it waited behind) has settled.
   */
  flush(): Promise<void>;
  /** Cancel any pending debounce without flushing. */
  cancel(): void;
  /** Adopt `payload` as the confirmed-saved baseline (no save scheduled). */
  mark(payload: PreviewDocumentPayload): void;
  /**
   * Adopt a fresher server baseline while retaining the user's pending title
   * and content. Used only after an explicit "keep local draft" choice.
   */
  rebasePending(payload: PreviewDocumentPayload): void;
  /** Replace callbacks captured by an older preview mount. */
  replaceSaveAdapter(adapter: PreviewDocumentSaveAdapter): void;
  /** Serializable dirty state for bounded browser draft storage. */
  draftSnapshot(): PreviewDocumentDraftSnapshot;
  /** Restore a previously persisted dirty draft into a fresh controller. */
  restoreDraft(snapshot: PreviewDocumentDraftSnapshot): void;
  /** Notify whichever preview mount currently owns this controller. */
  notifyDraftConflict(snapshot: PreviewDocumentDraftSnapshot): void;
  /** The payload last CONFIRMED persisted. */
  readonly lastSaved: PreviewDocumentPayload;
  /** The latest payload the user has typed (may differ from lastSaved). */
  readonly pending: PreviewDocumentPayload;
  /** Whether a debounce timer is currently armed. */
  readonly hasPendingTimer: boolean;
  /** Whether a save() call is currently outstanding (in flight). */
  readonly isSaving: boolean;
  /** Why the latest attempted save remains dirty, if it was deferred. */
  readonly deferredReason: PreviewDocumentSaveDeferred["reason"] | null;
  /**
   * Whether this controller has confirmed at least one local save since creation.
   * Until the server query echoes that payload, clean local state is newer than
   * stale item/document props and must be preserved on quick preview reopens.
   */
  readonly hasSavedLocally: boolean;
}

function payloadsEqual(a: PreviewDocumentPayload, b: PreviewDocumentPayload) {
  return a.title === b.title && a.content === b.content;
}

export function createPreviewDocumentSaveController(
  args: PreviewDocumentSaveAdapter & {
    /**
     * The document id this controller persists to, fixed for its entire life. A
     * controller NEVER changes which document it targets — switching rows acquires
     * a different controller (see previewDocumentSaveRegistry).
     */
    documentId: string;
    initial: PreviewDocumentPayload;
    /** Persist `payload` to this controller's document. */
    debounceMs?: number;
    setTimeoutFn?: typeof setTimeout;
    clearTimeoutFn?: typeof clearTimeout;
  },
): PreviewDocumentSaveController {
  const documentId = args.documentId;
  const debounceMs = args.debounceMs ?? 450;
  const setTimeoutFn = args.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = args.clearTimeoutFn ?? clearTimeout;

  let lastSaved: PreviewDocumentPayload = { ...args.initial };
  let pending: PreviewDocumentPayload = { ...args.initial };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasSavedLocally = false;
  let deferredReason: PreviewDocumentSaveDeferred["reason"] | null = null;
  let saveAdapter: PreviewDocumentSaveAdapter = {
    save: args.save,
    onSaved: args.onSaved,
    onError: args.onError,
    onDraftConflict: args.onDraftConflict,
  };

  // The single in-flight save, or null when idle. A debounced edit made while
  // this is set does NOT start a new save; it updates `pending` and a trailing
  // save fires when this settles. At most one save per controller is ever
  // outstanding, so server write order == issue order for this document id.
  let inFlight: Promise<void> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  // Start exactly one save if one isn't already running and there is dirty
  // content. On SUCCESS the baseline advances to `attempted` (only what we
  // actually persisted is ever marked clean) and the next trailing save is
  // kicked. A failure leaves the payload dirty for the next edit/flush — it is
  // never silently recorded as saved.
  function kick() {
    if (inFlight !== null) return; // single-flight: never overlap saves.
    if (payloadsEqual(pending, lastSaved)) return; // nothing dirty.

    const attempted = { ...pending };
    const promise = Promise.resolve(
      saveAdapter.save(documentId, attempted, { ...lastSaved }),
    )
      .then((result) => {
        if (
          result &&
          typeof result === "object" &&
          "outcome" in result &&
          result.outcome === "deferred" &&
          "reason" in result &&
          (result.reason === "hydration" || result.reason === "conflict")
        ) {
          // Hydration can begin after a keystroke but before the debounce fires.
          // Keep the attempted payload dirty so the registry can retain it across
          // close/reopen and a later flush can retry it. A deferred save is not a
          // successful save, and user-authored content is never disposable.
          deferredReason = result.reason;
          inFlight = null;
          const deferredResult = result as PreviewDocumentSaveDeferred;
          if (deferredResult.conflictSnapshot) {
            saveAdapter.onDraftConflict?.(deferredResult.conflictSnapshot);
          }
          return;
        }
        lastSaved = attempted;
        hasSavedLocally = true;
        deferredReason = null;
        inFlight = null;
        saveAdapter.onSaved?.(attempted);
        // A trailing edit may have landed while this save was in flight. Issue
        // exactly one more for the LATEST payload. Bounded: stops once quiescent.
        kick();
      })
      .catch((error) => {
        inFlight = null;
        saveAdapter.onError?.(error);
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
    documentId,
    changeTitle(title: string) {
      pending = { ...pending, title };
      deferredReason = null;
      schedule();
    },
    changeContent(content: string) {
      pending = { ...pending, content };
      deferredReason = null;
      schedule();
    },
    flush() {
      clearTimer();
      // Nothing dirty: no-op, no double-save of clean content. If a save is
      // still settling, return it so the caller can await full quiescence.
      if (payloadsEqual(pending, lastSaved)) {
        return inFlight ?? Promise.resolve();
      }
      // The latest payload still isn't persisted (a trailing edit, or a debounce
      // that hasn't fired). Dispatch the final save SYNCHRONOUSLY — kick() issues
      // it now if the lane is idle. Bound to this controller's fixed doc id, so a
      // fire-and-forget caller can tear down immediately and the write still lands
      // on the correct document. If a save IS already in flight, single-flight
      // skips dispatch here and its success kicks the trailing save for the latest
      // payload; we return a promise that resolves once that trailing save (the
      // one carrying `pending`) has settled.
      kick();
      return waitUntilPersisted({ ...pending });
    },
    cancel() {
      clearTimer();
    },
    mark(payload: PreviewDocumentPayload) {
      clearTimer();
      lastSaved = { ...payload };
      pending = { ...payload };
      hasSavedLocally = false;
      deferredReason = null;
    },
    rebasePending(payload: PreviewDocumentPayload) {
      clearTimer();
      lastSaved = { ...payload };
      pending = {
        ...pending,
        loadedUpdatedAt: payload.loadedUpdatedAt,
        loadedContentWasEmpty: payload.loadedContentWasEmpty,
      };
      hasSavedLocally = false;
      deferredReason = null;
    },
    replaceSaveAdapter(adapter: PreviewDocumentSaveAdapter) {
      saveAdapter = adapter;
    },
    draftSnapshot() {
      return {
        lastSaved: { ...lastSaved },
        pending: { ...pending },
        deferredReason,
      };
    },
    restoreDraft(snapshot: PreviewDocumentDraftSnapshot) {
      clearTimer();
      lastSaved = { ...snapshot.lastSaved };
      pending = { ...snapshot.pending };
      deferredReason = snapshot.deferredReason;
      hasSavedLocally = false;
    },
    notifyDraftConflict(snapshot: PreviewDocumentDraftSnapshot) {
      saveAdapter.onDraftConflict?.(snapshot);
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
    get deferredReason() {
      return deferredReason;
    },
    get hasSavedLocally() {
      return hasSavedLocally;
    },
  };

  // Resolve once `target` has been confirmed persisted (or the controller went
  // quiescent because a failed save left it dirty — flush is best-effort and does
  // not loop on repeated failure). Chains strictly on the in-flight save promise,
  // so it never busy-waits and always tracks the real settle of the trailing
  // save that carries `target`.
  function waitUntilPersisted(target: PreviewDocumentPayload): Promise<void> {
    if (payloadsEqual(lastSaved, target)) return Promise.resolve();
    if (inFlight === null) return Promise.resolve(); // quiescent (e.g. failed).
    return inFlight.then(() => waitUntilPersisted(target));
  }
}
