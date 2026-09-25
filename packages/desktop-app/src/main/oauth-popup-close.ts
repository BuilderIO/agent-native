interface OAuthPopupWindowLike {
  isDestroyed(): boolean;
  close(): void;
  webContents: { once(event: "did-finish-load", listener: () => void): void };
}

/**
 * Tracks when the native OAuth popup (`openOAuthWindow` in index.ts) should
 * close itself. Two independent triggers share one `closeScheduled` guard so
 * a request from either path only closes the window once:
 *
 * - `scheduleCloseAfterFinishLoad` — the popup reached our own callback URL
 *   (or an `agentnative://` deep link). The page still needs to finish
 *   loading/running its own script before it closes.
 * - `onLoadFailed` — the navigation itself failed. Nothing else is going to
 *   load in this popup, so it must close directly instead of registering a
 *   `did-finish-load` listener that will never fire — that mismatch is what
 *   left the popup permanently stuck on a blank page after a genuine network
 *   failure (DNS, connection refused, timeout, etc.) hitting the callback.
 *   `ERR_ABORTED` (-3) is excluded because it fires for navigations we
 *   intentionally cancel ourselves (the deep-link `will-navigate` handler),
 *   where a real subsequent navigation still completes and closes the
 *   window through the first path.
 */
export function createOAuthPopupCloser(win: OAuthPopupWindowLike) {
  let closeScheduled = false;

  function closeNow() {
    if (!win.isDestroyed()) win.close();
  }

  return {
    get closeScheduled(): boolean {
      return closeScheduled;
    },
    scheduleCloseAfterFinishLoad(
      delayMs = 600,
      schedule: (fn: () => void, ms: number) => void = setTimeout,
    ) {
      if (closeScheduled) return;
      closeScheduled = true;
      win.webContents.once("did-finish-load", () => {
        schedule(closeNow, delayMs);
      });
    },
    onLoadFailed(errorCode: number) {
      if (errorCode === -3) return;
      if (closeScheduled) return;
      closeScheduled = true;
      closeNow();
    },
  };
}

interface OAuthPopupAttemptWindowLike {
  isDestroyed(): boolean;
  close(): void;
}

/** Tracks Electron OAuth windows by their initiating webview and connect attempt. */
export function createOAuthPopupAttemptWindows<
  Source extends object,
  Popup extends OAuthPopupAttemptWindowLike,
>() {
  const windowsBySource = new WeakMap<Source, Map<string, Popup>>();

  const remove = (source: Source, attemptId: string, popup: Popup) => {
    const windows = windowsBySource.get(source);
    if (windows?.get(attemptId) !== popup) return;
    windows.delete(attemptId);
    if (windows.size === 0) windowsBySource.delete(source);
  };

  return {
    track(source: Source, attemptId: string, popup: Popup) {
      let windows = windowsBySource.get(source);
      if (!windows) {
        windows = new Map();
        windowsBySource.set(source, windows);
      }
      windows.set(attemptId, popup);
      return () => remove(source, attemptId, popup);
    },
    close(source: Source, attemptId: string): boolean {
      const popup = windowsBySource.get(source)?.get(attemptId);
      if (!popup) return false;
      if (popup.isDestroyed()) {
        remove(source, attemptId, popup);
        return false;
      }
      popup.close();
      return true;
    },
  };
}

interface OAuthSystemBrowserWindowLike {
  on(event: "blur", listener: () => void): void;
  once(event: "focus" | "closed", listener: () => void): void;
  removeListener(
    event: "blur" | "focus" | "closed",
    listener: () => void,
  ): void;
}

/** Focus return prompts a status refresh; it cannot prove the browser tab closed. */
export function watchOAuthSystemBrowserReturn(
  win: OAuthSystemBrowserWindowLike,
  attemptId: string,
  onReturn: (attemptId: string) => void,
) {
  let blurred = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    win.removeListener("blur", onBlur);
    win.removeListener("focus", onFocus);
    win.removeListener("closed", cleanup);
  };
  const onFocus = () => {
    if (!blurred) return;
    cleanup();
    onReturn(attemptId);
  };
  const onBlur = () => {
    blurred = true;
    win.removeListener("blur", onBlur);
    win.once("focus", onFocus);
  };

  win.on("blur", onBlur);
  win.once("closed", cleanup);
  timeout = setTimeout(cleanup, 5 * 60 * 1000);

  return cleanup;
}

export function watchOAuthSystemBrowserReturnForContents<T>(
  sourceContents: T & { hostWebContents?: T | null },
  getOwnerWindow: (contents: T) => OAuthSystemBrowserWindowLike | null,
  attemptId: string,
  onReturn: (attemptId: string) => void,
) {
  const ownerContents = sourceContents.hostWebContents ?? sourceContents;
  const ownerWindow = getOwnerWindow(ownerContents);
  return ownerWindow
    ? watchOAuthSystemBrowserReturn(ownerWindow, attemptId, onReturn)
    : undefined;
}
