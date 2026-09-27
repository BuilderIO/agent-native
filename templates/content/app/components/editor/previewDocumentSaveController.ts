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

export interface PreviewDocumentSaveSuccess {
  outcome: "saved";
  loadedUpdatedAt?: string;
  loadedContentWasEmpty?: boolean;
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

export function deferredPreviewDocumentSave(
  reason: PreviewDocumentSaveDeferred["reason"] = "hydration",
  conflictSnapshot?: PreviewDocumentDraftSnapshot,
): PreviewDocumentSaveDeferred {
  return { outcome: "deferred", reason, conflictSnapshot };
}

export interface PreviewDocumentSaveController {
  readonly documentId: string;
  changeTitle(title: string): void;
  changeContent(content: string): void;
  flush(): Promise<void>;
  cancel(): void;
  mark(payload: PreviewDocumentPayload): void;
  rebasePending(payload: PreviewDocumentPayload): void;
  replaceSaveAdapter(adapter: PreviewDocumentSaveAdapter): void;
  draftSnapshot(): PreviewDocumentDraftSnapshot;
  restoreDraft(snapshot: PreviewDocumentDraftSnapshot): void;
  notifyDraftConflict(snapshot: PreviewDocumentDraftSnapshot): void;
  readonly lastSaved: PreviewDocumentPayload;
  readonly pending: PreviewDocumentPayload;
  readonly hasPendingTimer: boolean;
  readonly isSaving: boolean;
  readonly deferredReason: PreviewDocumentSaveDeferred["reason"] | null;
  readonly hasSavedLocally: boolean;
}

function payloadsEqual(a: PreviewDocumentPayload, b: PreviewDocumentPayload) {
  return a.title === b.title && a.content === b.content;
}

function asSaveSuccess(result: unknown): PreviewDocumentSaveSuccess | null {
  if (
    result &&
    typeof result === "object" &&
    "outcome" in result &&
    (result as { outcome?: unknown }).outcome === "saved"
  ) {
    return result as PreviewDocumentSaveSuccess;
  }
  return null;
}

export function createPreviewDocumentSaveController(
  args: PreviewDocumentSaveAdapter & {
    documentId: string;
    initial: PreviewDocumentPayload;
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

  let inFlight: Promise<void> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function kick() {
    if (inFlight !== null) return;
    if (payloadsEqual(pending, lastSaved)) return;

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
          deferredReason = result.reason;
          inFlight = null;
          const deferredResult = result as PreviewDocumentSaveDeferred;
          if (deferredResult.conflictSnapshot) {
            saveAdapter.onDraftConflict?.(deferredResult.conflictSnapshot);
          }
          return;
        }
        const success = asSaveSuccess(result);
        const savedMetadata = {
          ...(success?.loadedUpdatedAt !== undefined
            ? { loadedUpdatedAt: success.loadedUpdatedAt }
            : {}),
          ...(success?.loadedContentWasEmpty !== undefined
            ? { loadedContentWasEmpty: success.loadedContentWasEmpty }
            : {}),
        };
        lastSaved = {
          ...attempted,
          ...savedMetadata,
        };
        pending = { ...pending, ...savedMetadata };
        hasSavedLocally = true;
        deferredReason = null;
        inFlight = null;
        saveAdapter.onSaved?.(attempted);
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
      if (payloadsEqual(pending, lastSaved)) {
        return inFlight ?? Promise.resolve();
      }
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
      const titleChangedLocally = pending.title !== lastSaved.title;
      const contentChangedLocally = pending.content !== lastSaved.content;
      lastSaved = { ...payload };
      pending = {
        ...pending,
        title: titleChangedLocally ? pending.title : payload.title,
        content: contentChangedLocally ? pending.content : payload.content,
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

  function waitUntilPersisted(target: PreviewDocumentPayload): Promise<void> {
    if (payloadsEqual(lastSaved, target)) return Promise.resolve();
    if (inFlight === null) return Promise.resolve();
    return inFlight.then(() => waitUntilPersisted(target));
  }
}
