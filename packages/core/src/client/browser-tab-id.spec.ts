// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "agent-native:browser-tab-id";

async function loadTabId() {
  vi.resetModules();
  return import("./browser-tab-id.js");
}

function stubNavigationType(type: PerformanceNavigationTiming["type"]) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((entryType) => {
    if (entryType !== "navigation") return [];
    return [{ type } as PerformanceNavigationTiming];
  });
}

describe("browser tab id", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("persists the generated id across reloads in one tab", async () => {
    stubNavigationType("navigate");

    const first = await loadTabId();
    const id = first.getBrowserTabId();
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    vi.restoreAllMocks();
    stubNavigationType("reload");

    const second = await loadTabId();
    expect(second.getBrowserTabId()).toBe(id);
    expect(id).toBe(stored);
    expect(stored).toBeTruthy();
  });

  it("claims a fresh id for a duplicated tab with copied session storage", async () => {
    stubNavigationType("navigate");
    window.sessionStorage.setItem(STORAGE_KEY, "original-tab");

    const { getBrowserTabId } = await loadTabId();

    expect(getBrowserTabId()).not.toBe("original-tab");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(getBrowserTabId());
  });

  it("does not reuse malformed stored ids", async () => {
    stubNavigationType("reload");
    window.sessionStorage.setItem(STORAGE_KEY, "bad/tab");

    const { getBrowserTabId } = await loadTabId();

    expect(getBrowserTabId()).not.toBe("bad/tab");
  });
});
