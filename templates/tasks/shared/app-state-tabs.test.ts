import { describe, expect, it } from "vitest";

import { appStateKeyForBrowserTab } from "./app-state-tabs.js";

describe("app-state-tabs", () => {
  it("scopes keys to a browser tab id", () => {
    expect(appStateKeyForBrowserTab("tasksSelection", "tab-1")).toBe(
      "tasksSelection:tab-1",
    );
    expect(appStateKeyForBrowserTab("tasksSelection", null)).toBe(
      "tasksSelection",
    );
  });
});
