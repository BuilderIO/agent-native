export const RECORDING_START_TIMEOUT_MS = 90_000;

// Cleanup invokes (closing overlay windows, clearing recording state) are
// normally instant. This bounds them well above any real duration but far
// below forever, so a stuck native call (e.g. a ScreenCaptureKit handshake
// that never returns its completion) can't turn "recovery" into another
// permanent hang on top of the one the start guard already gave up on.
export const RECOVERY_INVOKE_TIMEOUT_MS = 5_000;

export class RecordingStartTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Recording setup timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`,
    );
    this.name = "TimeoutError";
  }
}

export class RecordingStartCancelledError extends Error {
  constructor() {
    super("Recording setup was cancelled.");
    this.name = "AbortError";
  }
}

export function guardRecordingStart<T>(
  operation: Promise<T>,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onCancel?: () => void;
    onLateResolve?: (value: T) => void;
  } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? RECORDING_START_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let cancellationNotified = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const notifyCancellation = () => {
      if (cancellationNotified) return;
      cancellationNotified = true;
      options.onCancel?.();
    };

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onAbort = () => {
      notifyCancellation();
      finish(() => reject(new RecordingStartCancelledError()));
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    operation.then(
      (value) => {
        if (settled) {
          options.onLateResolve?.(value);
          return;
        }
        finish(() => resolve(value));
      },
      (error) => {
        finish(() => reject(error));
      },
    );
    timer = setTimeout(() => {
      notifyCancellation();
      finish(() => reject(new RecordingStartTimeoutError(timeoutMs)));
    }, timeoutMs);
  });
}

/**
 * Best-effort recovery step that must never block the caller. Recording-start
 * failure paths (and their "always restore the UI" `finally` blocks) await
 * cleanup invokes like `hide_recording_chrome` — if the underlying native
 * command hangs, an unbounded `await ...catch(() => {})` hangs the whole
 * recovery with it, leaving the toolbar/"Preparing…" state stuck until the
 * user restarts the app. Swallows both success and failure; only existence
 * to cap how long a single cleanup step can stall recovery.
 */
export function boundedCleanup(
  operation: Promise<unknown>,
  timeoutMs = RECOVERY_INVOKE_TIMEOUT_MS,
): Promise<void> {
  return guardRecordingStart(operation, { timeoutMs }).then(
    () => undefined,
    () => undefined,
  );
}
