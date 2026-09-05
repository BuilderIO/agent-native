// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "agent-native:browser-tab-id";

async function loadTabId() {
  vi.resetModules();
  return import("./browser-tab-id.js");
}

describe("getBrowserTabId", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("is stable across repeated calls", async () => {
    const { getBrowserTabId } = await loadTabId();

    const first = getBrowserTabId();
    const second = getBrowserTabId();

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("persists the id in sessionStorage", async () => {
    const { getBrowserTabId } = await loadTabId();

    const id = getBrowserTabId();
    const stored = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? "null",
    );

    expect(stored).toMatchObject({ tabId: id, active: true });
  });

  it("regenerates when the stored id was last claimed by an active owner", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabId: "owned-elsewhere",
        ownerId: "other",
        active: true,
      }),
    );

    const { getBrowserTabId } = await loadTabId();
    const id = getBrowserTabId();

    expect(id).not.toBe("owned-elsewhere");
  });

  it("accepts an older plain-string stored value", async () => {
    window.sessionStorage.setItem(STORAGE_KEY, "legacy-plain-id");

    const { getBrowserTabId } = await loadTabId();
    const id = getBrowserTabId();

    expect(id).toBe("legacy-plain-id");
  });
});
