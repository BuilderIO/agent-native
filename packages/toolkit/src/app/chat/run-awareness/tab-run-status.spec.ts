import { describe, expect, it } from "vitest";

import {
  INITIAL_TAB_RUN_STATE,
  applyAgentRunSignal,
  markTabVisible,
  parseAgentRunSignal,
  tabRunStatus,
  type TabRunState,
} from "./tab-run-status.js";

function run(
  state: TabRunState,
  detail: Record<string, unknown>,
  hidden = false,
) {
  const signal = parseAgentRunSignal(detail);
  if (!signal) throw new Error("expected a run signal");
  return applyAgentRunSignal(state, signal, { hidden });
}

describe("tab run status", () => {
  it("reads the thread from threadId, falling back to the tab id", () => {
    expect(parseAgentRunSignal({ isRunning: true, threadId: "a" })).toEqual({
      type: "started",
      threadId: "a",
    });
    expect(parseAgentRunSignal({ isRunning: false, tabId: "b" })).toEqual({
      type: "ended",
      threadId: "b",
      outcome: "finished",
    });
    expect(parseAgentRunSignal({ isRunning: true })).toBeNull();
    expect(parseAgentRunSignal({ threadId: "a" })).toBeNull();
    expect(parseAgentRunSignal(null)).toBeNull();
  });

  it("treats a cancelled or never-started run as stopped, not a reply", () => {
    for (const reason of [
      "run.cancelled",
      "submission_queued",
      "start_failed",
    ]) {
      expect(
        parseAgentRunSignal({ isRunning: false, threadId: "a", reason }),
      ).toMatchObject({ outcome: "stopped" });
    }
    expect(
      parseAgentRunSignal({
        isRunning: false,
        threadId: "a",
        reason: "run.failed",
      }),
    ).toMatchObject({ outcome: "finished" });
  });

  it("shows running while a run is active and goes idle when it finishes in view", () => {
    let state = run(INITIAL_TAB_RUN_STATE, {
      isRunning: true,
      threadId: "a",
    }).state;
    expect(tabRunStatus(state, 1)).toBe("running");
    const ended = run(state, {
      isRunning: false,
      threadId: "a",
      reason: "run.completed",
    });
    state = ended.state;
    expect(ended.finishedThreadId).toBe("a");
    expect(tabRunStatus(state, 0)).toBe("idle");
  });

  it("holds reply ready after a run finishes while hidden until the tab is shown", () => {
    let state = run(INITIAL_TAB_RUN_STATE, {
      isRunning: true,
      threadId: "a",
    }).state;
    state = run(state, { isRunning: false, threadId: "a" }, true).state;
    expect(tabRunStatus(state, 0)).toBe("reply-ready");
    // A second run starting does not hide the reply that is waiting.
    state = run(state, { isRunning: true, threadId: "b" }, true).state;
    expect(tabRunStatus(state, 1)).toBe("reply-ready");
    state = markTabVisible(state);
    expect(tabRunStatus(state, 1)).toBe("running");
  });

  it("reports each run's finish once and ignores ends it never saw start", () => {
    const unseen = run(
      INITIAL_TAB_RUN_STATE,
      { isRunning: false, threadId: "a" },
      true,
    );
    expect(unseen.finishedThreadId).toBeNull();
    expect(unseen.state.replyReady).toBe(false);

    let state = run(INITIAL_TAB_RUN_STATE, {
      isRunning: true,
      threadId: "a",
    }).state;
    state = run(state, {
      isRunning: true,
      threadId: "a",
      phase: "responding",
    }).state;
    const first = run(state, { isRunning: false, threadId: "a" });
    const duplicate = run(first.state, { isRunning: false, threadId: "a" });
    expect(first.finishedThreadId).toBe("a");
    expect(duplicate.finishedThreadId).toBeNull();
  });

  it("does not hold reply ready for a cancelled run in a hidden tab", () => {
    let state = run(INITIAL_TAB_RUN_STATE, {
      isRunning: true,
      threadId: "a",
    }).state;
    const ended = run(
      state,
      { isRunning: false, threadId: "a", reason: "run.cancelled" },
      true,
    );
    state = ended.state;
    expect(ended.finishedThreadId).toBeNull();
    expect(tabRunStatus(state, 0)).toBe("idle");
  });
});
