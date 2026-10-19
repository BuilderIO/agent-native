import { describe, expect, it } from "vitest";

import {
  appStateKey,
  appStateKeyForBrowserTab,
  normalizeBrowserTabId,
} from "./app-state-tabs";

describe("Slides 2 app-state keys", () => {
  it("keeps framework navigation canonical", () => {
    expect(appStateKey("navigation")).toBe("navigation");
    expect(appStateKeyForBrowserTab("navigation", "tab-1")).toBe(
      "slides-2:navigation:tab-1",
    );
    expect(appStateKeyForBrowserTab("navigation", undefined)).toBe(
      "slides-2:navigation",
    );
  });

  it("namespaces app-owned state idempotently", () => {
    expect(appStateKey("slides-selection")).toBe("slides-2:slides-selection");
    expect(appStateKey("slides-2:slides-selection")).toBe(
      "slides-2:slides-selection",
    );
    expect(appStateKeyForBrowserTab("slides-selection", "tab-1")).toBe(
      "slides-2:slides-selection:tab-1",
    );
  });

  it("keeps namespaced state isolated when the tab id is invalid or absent", () => {
    expect(appStateKeyForBrowserTab("navigate", "../bad")).toBe(
      "slides-2:navigate",
    );
    expect(appStateKeyForBrowserTab("navigate", undefined)).toBe(
      "slides-2:navigate",
    );
  });

  it("rejects unsafe browser tab ids", () => {
    expect(normalizeBrowserTabId("tab/1")).toBeNull();
  });
});
