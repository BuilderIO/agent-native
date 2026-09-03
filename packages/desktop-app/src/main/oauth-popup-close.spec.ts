import { describe, expect, it, vi } from "vitest";

import { createOAuthPopupCloser } from "./oauth-popup-close";

function fakeWindow() {
  const finishLoadListeners: Array<() => void> = [];
  return {
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    webContents: {
      once: vi.fn((_event: "did-finish-load", listener: () => void) => {
        finishLoadListeners.push(listener);
      }),
    },
    fireFinishLoad() {
      for (const listener of finishLoadListeners.splice(0)) listener();
    },
  };
}

describe("createOAuthPopupCloser", () => {
  it("closes immediately on a genuine load failure instead of waiting for a did-finish-load that never fires", () => {
    const win = fakeWindow();
    const closer = createOAuthPopupCloser(win);

    // ERR_NAME_NOT_RESOLVED: the callback navigation failed outright — there
    // is no further navigation coming, so no did-finish-load will ever fire.
    closer.onLoadFailed(-105);

    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it("ignores ERR_ABORTED (-3) so a real subsequent navigation can still close the window normally", () => {
    const win = fakeWindow();
    const schedule = vi.fn((fn: () => void) => fn());
    const closer = createOAuthPopupCloser(win);

    closer.onLoadFailed(-3);
    expect(win.close).not.toHaveBeenCalled();

    // The deep-link handler still schedules the normal close path afterward.
    closer.scheduleCloseAfterFinishLoad(600, schedule);
    win.fireFinishLoad();
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it("only ever closes once when both triggers fire for the same popup", () => {
    const win = fakeWindow();
    const schedule = vi.fn((fn: () => void) => fn());
    const closer = createOAuthPopupCloser(win);

    closer.scheduleCloseAfterFinishLoad(600, schedule);
    win.fireFinishLoad();
    closer.onLoadFailed(-105);

    expect(win.close).toHaveBeenCalledTimes(1);
  });
});
