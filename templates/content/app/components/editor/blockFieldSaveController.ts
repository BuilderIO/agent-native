
export interface BlockFieldSaveController {
  change(content: string): void;
  flush(): Promise<void>;
  cancel(): void;
  mark(content: string): void;
  discardPending(): void;
  readonly lastSaved: string;
  readonly pending: string;
  readonly hasPendingTimer: boolean;
  readonly isSaving: boolean;
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
  let hasSavedLocally = false;

  let inFlight: Promise<void> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function kick() {
    if (inFlight !== null) return;
    if (pending === lastSaved) return;

    const attempted = pending;
    const promise = Promise.resolve(args.save(attempted))
      .then(() => {
        lastSaved = attempted;
        hasSavedLocally = true;
        inFlight = null;
        kick();
      })
      .catch((error) => {
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
      while (inFlight !== null) {
        await inFlight;
      }
      if (pending !== lastSaved) {
        kick();
        const pendingSave = inFlight;
        if (pendingSave !== null) await Promise.resolve(pendingSave);
      }
    },
    cancel() {
      clearTimer();
    },
    mark(content: string) {
      clearTimer();
      lastSaved = content;
      pending = content;
      hasSavedLocally = false;
    },
    discardPending() {
      clearTimer();
      pending = lastSaved;
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
