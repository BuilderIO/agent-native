import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAnalyticsSessionId,
  getOrCreateAnalyticsSessionId,
  setAnalyticsSessionId,
} from "./analytics-session.js";

const SESSION_ID_KEY = "agent-native.session_id";
const SESSION_ID_PIN_KEY = "agent-native.session_id_pin";
const LAST_ACTIVITY_KEY = "agent-native.session_last_activity";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

let store: Map<string, string>;

function installBrowser() {
  store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
}

function goIdle() {
  store.set(LAST_ACTIVITY_KEY, String(Date.now() - IDLE_TIMEOUT_MS - 1));
}

describe("analytics session id", () => {
  beforeEach(() => {
    installBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rotates an unpinned id once the session goes idle", () => {
    const first = getOrCreateAnalyticsSessionId();
    expect(first).toBeTruthy();
    expect(getOrCreateAnalyticsSessionId()).toBe(first);

    goIdle();

    expect(getOrCreateAnalyticsSessionId()).not.toBe(first);
  });

  it("keeps a pinned id across the idle timeout", () => {
    expect(setAnalyticsSessionId("run-42")).toBe("run-42");
    expect(getOrCreateAnalyticsSessionId()).toBe("run-42");

    goIdle();

    expect(getOrCreateAnalyticsSessionId()).toBe("run-42");
    expect(store.get(SESSION_ID_KEY)).toBe("run-42");
  });

  it("rejects an id the session header cannot carry", () => {
    const before = getOrCreateAnalyticsSessionId();

    expect(() => setAnalyticsSessionId("")).toThrow(/Invalid analytics/);
    expect(() => setAnalyticsSessionId("has space")).toThrow(
      /Invalid analytics/,
    );
    expect(() => setAnalyticsSessionId("héllo")).toThrow(/Invalid analytics/);
    expect(() => setAnalyticsSessionId("x".repeat(128))).toThrow(
      /Invalid analytics/,
    );

    expect(store.has(SESSION_ID_PIN_KEY)).toBe(false);
    expect(getOrCreateAnalyticsSessionId()).toBe(before);
  });

  it("returns to rotating ids after the pin is cleared", () => {
    setAnalyticsSessionId("run-42");
    clearAnalyticsSessionId();

    const next = getOrCreateAnalyticsSessionId();
    expect(next).toBeTruthy();
    expect(next).not.toBe("run-42");

    goIdle();

    expect(getOrCreateAnalyticsSessionId()).not.toBe(next);
  });

  it("reports that there was nowhere to pin the id outside a browser", () => {
    vi.unstubAllGlobals();

    expect(setAnalyticsSessionId("run-42")).toBeUndefined();
    expect(getOrCreateAnalyticsSessionId()).toBeUndefined();
  });
});
