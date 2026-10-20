import { describe, expect, it, vi } from "vitest";

import { restoreMailWebviewBackgroundThrottling } from "./webview-background-throttling.js";

describe("restoreMailWebviewBackgroundThrottling", () => {
  it("restores throttling for the preloaded Mail guest when its visibility changes", () => {
    const setBackgroundThrottling = vi.fn();
    const getWebContents = vi.fn(() => ({
      getType: () => "webview",
      setBackgroundThrottling,
    }));

    restoreMailWebviewBackgroundThrottling(
      { appId: "mail", webContentsId: 42 },
      getWebContents,
    );

    expect(getWebContents).toHaveBeenCalledWith(42);
    expect(setBackgroundThrottling).toHaveBeenCalledWith(true);
  });

  it("ignores other apps and non-webview contents", () => {
    const setBackgroundThrottling = vi.fn();
    const getWebContents = vi.fn(() => ({
      getType: () => "window",
      setBackgroundThrottling,
    }));

    restoreMailWebviewBackgroundThrottling(
      { appId: "calendar", webContentsId: 42 },
      getWebContents,
    );
    expect(getWebContents).not.toHaveBeenCalled();

    restoreMailWebviewBackgroundThrottling(
      { appId: "mail", webContentsId: 42 },
      getWebContents,
    );
    expect(setBackgroundThrottling).not.toHaveBeenCalled();
  });
});
