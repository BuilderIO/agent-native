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

interface OAuthSystemBrowserWindowLike {
  on(event: "blur", listener: () => void): void;
  once(event: "focus" | "closed", listener: () => void): void;
  removeListener(
    event: "blur" | "focus" | "closed",
    listener: () => void,
  ): void;
}

/** Electron cannot observe a system-browser tab closing; focus return is the proxy. */
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
  sourceContents: T,
  getOwnerWindow: (contents: T) => OAuthSystemBrowserWindowLike | null,
  attemptId: string,
  onReturn: (attemptId: string) => void,
) {
  const ownerWindow = getOwnerWindow(sourceContents);
  return ownerWindow
    ? watchOAuthSystemBrowserReturn(ownerWindow, attemptId, onReturn)
    : undefined;
}
