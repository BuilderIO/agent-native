import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearActiveRun,
  resolveReconnectAfterSeq,
  setActiveRun,
} from "./active-run-state.js";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("resolveReconnectAfterSeq", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  });

  afterEach(() => {
    clearActiveRun();
    vi.unstubAllGlobals();
  });

  it("returns lastSeq + 1 when session state matches the thread and run", () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 41 });
    expect(resolveReconnectAfterSeq("thread-1", "run-1")).toBe(42);
  });

  it("returns 0 when there is no stored cursor or the run does not match", () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 10 });
    expect(resolveReconnectAfterSeq("thread-1", "run-2")).toBe(0);
    expect(resolveReconnectAfterSeq("thread-2", "run-1")).toBe(0);
    clearActiveRun();
    expect(resolveReconnectAfterSeq("thread-1", "run-1")).toBe(0);
  });
});
