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
let documentCookie: string;

function installBrowser() {
  store = new Map<string, string>();
  documentCookie = "";
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
  vi.stubGlobal("document", {
    get cookie() {
      return documentCookie;
    },
    set cookie(value: string) {
      documentCookie = value;
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
    expect(documentCookie).toContain(`an_sid=${encodeURIComponent(first!)}`);
    expect(documentCookie).toContain("max-age=1800");
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
    expect(documentCookie).toContain("an_sid=; path=/; max-age=0");

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
