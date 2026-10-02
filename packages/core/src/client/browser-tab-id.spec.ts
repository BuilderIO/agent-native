// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    delete (window as Window & { __AGENT_NATIVE_CONFIG__?: unknown })
      .__AGENT_NATIVE_CONFIG__;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  it("keeps tab ids separate for workspace apps on the same origin", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/risk");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([
        { id: "risk", path: "/risk" },
        { id: "chat", path: "/chat" },
      ]),
    );
    stubNavigationType("reload");
    window.history.replaceState({}, "", "/risk/register");

    const riskTab = await loadTabId();
    const riskId = riskTab.getBrowserTabId();

    window.history.replaceState({}, "", "/chat/thread-1");
    const chatTab = await loadTabId();
    const chatId = chatTab.getBrowserTabId();

    expect(chatId).not.toBe(riskId);
    expect(window.sessionStorage.getItem(`${STORAGE_KEY}:/risk`)).toBe(riskId);
    expect(window.sessionStorage.getItem(`${STORAGE_KEY}:/chat`)).toBe(chatId);

    window.history.replaceState({}, "", "/risk/register");
    const riskReload = await loadTabId();
    expect(riskReload.getBrowserTabId()).toBe(riskId);
  });

  it("keeps the default tab key for a standalone app mounted below a path", async () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/docs");
    window.history.replaceState({}, "", "/docs/_agent-native/auth/session");
    stubNavigationType("reload");

    const { getBrowserTabId } = await loadTabId();
    const id = getBrowserTabId();

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(id);
    expect(window.sessionStorage.getItem(`${STORAGE_KEY}:/docs`)).toBeNull();
  });

  it("uses projected workspace state when scoping the current app", async () => {
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = { workspaceRuntime: true };
    window.history.replaceState({}, "", "/risk/register");
    stubNavigationType("reload");

    const { getBrowserTabId } = await loadTabId();
    const id = getBrowserTabId();

    expect(window.sessionStorage.getItem(`${STORAGE_KEY}:/risk`)).toBe(id);
  });
});
