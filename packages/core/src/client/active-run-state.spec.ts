// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_RUN_STATE_EVENT,
  clearActiveRun,
  getActiveRun,
  getActiveRunActivityTool,
  resolveReconnectAfterSeq,
  clearActiveRunIfMatches,
  setActiveRun,
  updateActiveRunActivity,
  updateActiveRunSeq,
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

  it("persists the current activity tool for refresh-time reconnects", () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 10 });

    updateActiveRunActivity(" generate-design ");
    expect(getActiveRunActivityTool("thread-1", "run-1")).toBe(
      "generate-design",
    );
    expect(getActiveRunActivityTool("thread-1", "run-2")).toBeNull();

    updateActiveRunSeq(12);
    expect(getActiveRun()).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      lastSeq: 12,
      activityTool: "generate-design",
    });

    updateActiveRunActivity("");
    expect(getActiveRun()).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      lastSeq: 12,
    });
    expect(getActiveRun()?.activityTool).toBeUndefined();
  });

  it("notifies listeners when the active run changes", () => {
    const events: Array<unknown> = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent).detail?.state ?? null);
    };
    window.addEventListener(ACTIVE_RUN_STATE_EVENT, listener);

    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 1 });
    clearActiveRun();

    window.removeEventListener(ACTIVE_RUN_STATE_EVENT, listener);

    expect(events).toEqual([
      { threadId: "thread-1", runId: "run-1", lastSeq: 1 },
      null,
    ]);
  });

  it("only clears active run state when the thread and run match", () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 7 });

    clearActiveRunIfMatches("thread-1", "run-2");
    expect(getActiveRun()).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      lastSeq: 7,
    });

    clearActiveRunIfMatches("thread-1", "run-1");
    expect(getActiveRun()).toBeNull();
  });
});
