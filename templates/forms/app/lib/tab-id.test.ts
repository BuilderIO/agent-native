// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "agent-native.forms.tab-id";
const originalGetEntriesByType = performance.getEntriesByType;

async function loadTabId() {
  vi.resetModules();
  return import("./tab-id.js");
}

function stubNavigationType(type: PerformanceNavigationTiming["type"]) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((entryType) => {
    if (entryType !== "navigation") return [];
    return [{ type } as PerformanceNavigationTiming];
  });
}

describe("Forms tab id", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(performance, "getEntriesByType", {
      configurable: true,
      value: originalGetEntriesByType,
    });
  });

  it("persists the generated id for reloads in the same browser tab", async () => {
    stubNavigationType("reload");

    const first = await loadTabId();
    const stored = window.sessionStorage.getItem(STORAGE_KEY);

    expect(first.TAB_ID).toBeTruthy();
    expect(stored).toBe(first.TAB_ID);

    const second = await loadTabId();

    expect(second.TAB_ID).toBe(first.TAB_ID);
  });

  it("reuses an existing safe id on reload", async () => {
    stubNavigationType("reload");
    window.sessionStorage.setItem(STORAGE_KEY, "forms-tab-a");

    const { TAB_ID } = await loadTabId();

    expect(TAB_ID).toBe("forms-tab-a");
  });

  it("generates a fresh id for duplicated tabs with copied session storage", async () => {
    stubNavigationType("navigate");
    window.sessionStorage.setItem(STORAGE_KEY, "forms-tab-a");

    const { TAB_ID } = await loadTabId();

    expect(TAB_ID).not.toBe("forms-tab-a");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(TAB_ID);
  });
});
