import { describe, expect, it, vi } from "vitest";

import { setMailWebviewBackgroundThrottling } from "./webview-background-throttling.js";

describe("setMailWebviewBackgroundThrottling", () => {
  it("throttles an active Mail guest and preserves hidden polling when inactive", () => {
    const setBackgroundThrottling = vi.fn();
    const getWebContents = vi.fn(() => ({
      getType: () => "webview",
      setBackgroundThrottling,
    }));

    setMailWebviewBackgroundThrottling(
      { appId: "mail", webContentsId: 42, active: true },
      getWebContents,
    );
    setMailWebviewBackgroundThrottling(
      { appId: "mail", webContentsId: 42, active: false },
      getWebContents,
    );

    expect(getWebContents).toHaveBeenNthCalledWith(1, 42);
    expect(setBackgroundThrottling).toHaveBeenNthCalledWith(1, true);
    expect(setBackgroundThrottling).toHaveBeenNthCalledWith(2, false);
  });

  it("ignores other apps and non-webview contents", () => {
    const setBackgroundThrottling = vi.fn();
    const getWebContents = vi.fn(() => ({
      getType: () => "window",
      setBackgroundThrottling,
    }));

    setMailWebviewBackgroundThrottling(
      { appId: "calendar", webContentsId: 42 },
      getWebContents,
    );
    expect(getWebContents).not.toHaveBeenCalled();

    setMailWebviewBackgroundThrottling(
      { appId: "mail", webContentsId: 42 },
      getWebContents,
    );
    expect(setBackgroundThrottling).not.toHaveBeenCalled();
  });
});
