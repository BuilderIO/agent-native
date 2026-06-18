// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "agent-native.forms.tab-id";

async function loadTabId() {
  vi.resetModules();
  return import("./tab-id.js");
}

describe("Forms tab id", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("persists the generated id for reloads in the same browser tab", async () => {
    const first = await loadTabId();
    const stored = window.sessionStorage.getItem(STORAGE_KEY);

    expect(first.TAB_ID).toBeTruthy();
    expect(stored).toBe(first.TAB_ID);

    const second = await loadTabId();

    expect(second.TAB_ID).toBe(first.TAB_ID);
  });

  it("reuses an existing safe id", async () => {
    window.sessionStorage.setItem(STORAGE_KEY, "forms-tab-a");

    const { TAB_ID } = await loadTabId();

    expect(TAB_ID).toBe("forms-tab-a");
  });
});
