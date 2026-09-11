import { describe, expect, it } from "vitest";

import { shouldReloadActiveWebview } from "./webview-refresh";

describe("shouldReloadActiveWebview", () => {
  it("reloads when an active app receives a new refresh key", () => {
    expect(
      shouldReloadActiveWebview({
        previousRefreshKey: 1,
        refreshKey: 2,
        isActive: true,
        isPlaceholder: false,
      }),
    ).toBe(true);
  });

  it("does not reload an inactive app when the shared key changes", () => {
    expect(
      shouldReloadActiveWebview({
        previousRefreshKey: 1,
        refreshKey: 2,
        isActive: false,
        isPlaceholder: false,
      }),
    ).toBe(false);
  });

  it("reloads after an inactive app becomes active with a pending key", () => {
    const previousRefreshKey = 1;
    const refreshKey = 2;

    expect(
      shouldReloadActiveWebview({
        previousRefreshKey,
        refreshKey,
        isActive: false,
        isPlaceholder: false,
      }),
    ).toBe(false);
    expect(
      shouldReloadActiveWebview({
        previousRefreshKey,
        refreshKey,
        isActive: true,
        isPlaceholder: false,
      }),
    ).toBe(true);
  });

  it("does not reload placeholders or unchanged keys", () => {
    expect(
      shouldReloadActiveWebview({
        previousRefreshKey: 0,
        refreshKey: 0,
        isActive: true,
        isPlaceholder: false,
      }),
    ).toBe(false);
    expect(
      shouldReloadActiveWebview({
        previousRefreshKey: 1,
        refreshKey: 2,
        isActive: true,
        isPlaceholder: true,
      }),
    ).toBe(false);
  });
});
