import { describe, expect, it, vi } from "vitest";

import {
  setMailWebviewBackgroundThrottling,
  setWebviewBackgroundThrottling,
} from "./webview-background-throttling.js";

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

describe("setWebviewBackgroundThrottling", () => {
  it("applies the requested throttling to webview contents only", () => {
    const setBackgroundThrottling = vi.fn();
    const webview = {
      getType: () => "webview" as const,
      setBackgroundThrottling,
    };
    const window = {
      getType: () => "window" as const,
      setBackgroundThrottling,
    };

    setWebviewBackgroundThrottling(
      { webContentsId: 9, throttle: true },
      () => webview,
    );
    setWebviewBackgroundThrottling(
      { webContentsId: 9, throttle: true },
      () => window,
    );
    setWebviewBackgroundThrottling(
      { webContentsId: "9", throttle: true },
      () => webview,
    );

    expect(setBackgroundThrottling).toHaveBeenCalledTimes(1);
    expect(setBackgroundThrottling).toHaveBeenCalledWith(true);
  });

  it("rejects malformed payloads without reading the contents", () => {
    const getWebContents = vi.fn();
    for (const payload of [
      null,
      undefined,
      "9",
      42,
      { webContentsId: "9", throttle: true },
      { webContentsId: 9, throttle: "true" },
      { webContentsId: 9 },
    ]) {
      setWebviewBackgroundThrottling(payload, getWebContents);
    }
    expect(getWebContents).not.toHaveBeenCalled();
  });
});
