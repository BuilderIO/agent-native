
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
