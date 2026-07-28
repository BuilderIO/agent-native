// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_RUN_STATE_EVENT,
  clearActiveRun,
  getActiveRun,
  getActiveRunActivityTool,
  clearPendingTurnIfMatches,
  getPendingTurn,
  resolveReconnectAfterSeq,
  clearActiveRunIfMatches,
  listActiveRuns,
  setPendingTurn,
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
    clearActiveRun("thread-1");
    clearActiveRun("thread-2");
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
    clearActiveRun("thread-1");
    expect(resolveReconnectAfterSeq("thread-1", "run-1")).toBe(0);
  });

  it("persists the current activity tool for refresh-time reconnects", () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 10 });

    updateActiveRunActivity("thread-1", " generate-design ");
    expect(getActiveRunActivityTool("thread-1", "run-1")).toBe(
      "generate-design",
    );
    expect(getActiveRunActivityTool("thread-1", "run-2")).toBeNull();

    updateActiveRunSeq("thread-1", 12);
    expect(getActiveRun("thread-1")).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      lastSeq: 12,
      activityTool: "generate-design",
    });

    updateActiveRunActivity("thread-1", "");
    expect(getActiveRun("thread-1")).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      lastSeq: 12,
    });
    expect(getActiveRun("thread-1")?.activityTool).toBeUndefined();
  });

  it("notifies listeners when the active run changes", () => {
    const events: Array<unknown> = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent).detail?.state ?? null);
    };
    window.addEventListener(ACTIVE_RUN_STATE_EVENT, listener);

    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 1 });
    clearActiveRun("thread-1");

    window.removeEventListener(ACTIVE_RUN_STATE_EVENT, listener);

    expect(events).toEqual([
      { threadId: "thread-1", runId: "run-1", lastSeq: 1 },
      null,
    ]);
  });

  it("only clears active run state when the thread and run match", () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 7 });

    clearActiveRunIfMatches("thread-1", "run-2");
    expect(getActiveRun("thread-1")).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      lastSeq: 7,
    });

    clearActiveRunIfMatches("thread-1", "run-1");
    expect(getActiveRun("thread-1")).toBeNull();
  });

  it("keeps a pending turn addressable until its matching run id arrives", () => {
    setPendingTurn({ threadId: "thread-1", turnId: "turn-1" });

    expect(getPendingTurn("thread-1")).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    });
    expect(getPendingTurn("thread-2")).toBeNull();

    clearPendingTurnIfMatches("thread-1", "turn-other");
    expect(getPendingTurn("thread-1")?.turnId).toBe("turn-1");

    clearPendingTurnIfMatches("thread-1", "turn-1");
    expect(getPendingTurn("thread-1")).toBeNull();
  });
});

describe("concurrent runs in different threads", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  });

  afterEach(() => {
    clearActiveRun("thread-1");
    clearActiveRun("thread-2");
    vi.unstubAllGlobals();
  });

  it("keeps each thread's run cursor and activity when another thread starts a run", () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: -1 });
    updateActiveRunSeq("thread-1", 42);
    updateActiveRunActivity("thread-1", "generate-design");

    // A second design's editor starts its own run while the first is in flight.
    setActiveRun({ threadId: "thread-2", runId: "run-2", lastSeq: -1 });

    expect(resolveReconnectAfterSeq("thread-1", "run-1")).toBe(43);
    expect(getActiveRunActivityTool("thread-1", "run-1")).toBe(
      "generate-design",
    );
    expect(resolveReconnectAfterSeq("thread-2", "run-2")).toBe(0);
    expect(
      listActiveRuns()
        .map((run) => run.runId)
        .sort(),
    ).toEqual(["run-1", "run-2"]);
  });

  it("never hands one thread another thread's run", () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 5 });

    expect(getActiveRun("thread-2")).toBeNull();
    expect(getActiveRun(undefined)).toBeNull();

    clearActiveRun("thread-2");
    expect(getActiveRun("thread-1")?.runId).toBe("run-1");
  });

  it("still resumes a run stored in the pre-per-thread format", () => {
    sessionStorage.setItem(
      "agent-chat-active-run",
      JSON.stringify({ threadId: "thread-1", runId: "run-1", lastSeq: 7 }),
    );

    expect(getActiveRun("thread-1")).toEqual({
      threadId: "thread-1",
      runId: "run-1",
      lastSeq: 7,
    });
    expect(resolveReconnectAfterSeq("thread-1", "run-1")).toBe(8);
    expect(getActiveRun("thread-2")).toBeNull();
  });
});
