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
