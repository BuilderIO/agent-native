// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dispatchAgentChatRunning,
  getAgentChatSubmitTarget,
  rememberAgentChatSubmitTarget,
  useAgentChatRunningThreads,
} from "./use-agent-chat-running-threads.js";

describe("getAgentChatSubmitTarget", () => {
  it("keeps a submission's tab and first running thread for late listeners", () => {
    rememberAgentChatSubmitTarget("submit-late", "tab-late");
    dispatchAgentChatRunning({
      isRunning: true,
      tabId: "tab-late",
      threadId: "thread-late",
    });
    dispatchAgentChatRunning({
      isRunning: false,
      tabId: "tab-late",
      threadId: "thread-later-run",
    });

    expect(getAgentChatSubmitTarget("submit-late")).toEqual({
      tabId: "tab-late",
      threadId: "thread-late",
    });
    expect(getAgentChatSubmitTarget("submit-never-routed")).toBeNull();
  });

  it("never gives a new submission a thread its tab ran before it", () => {
    dispatchAgentChatRunning({
      isRunning: false,
      tabId: "tab-reused",
      threadId: "thread-earlier",
    });
    rememberAgentChatSubmitTarget("submit-reused", "tab-reused");

    expect(getAgentChatSubmitTarget("submit-reused")).toEqual({
      tabId: "tab-reused",
      threadId: null,
    });
  });

  it("reads tab-only and thread-only events the way the resolver does", () => {
    rememberAgentChatSubmitTarget("submit-tab-only", "tab-only");
    dispatchAgentChatRunning({ isRunning: true, tabId: "tab-only" });
    rememberAgentChatSubmitTarget("submit-thread-only", "thread-only");
    dispatchAgentChatRunning({ isRunning: true, threadId: "thread-only" });
    rememberAgentChatSubmitTarget("submit-upgraded", "tab-upgraded");
    dispatchAgentChatRunning({ isRunning: true, tabId: "tab-upgraded" });
    dispatchAgentChatRunning({
      isRunning: true,
      tabId: "tab-upgraded",
      threadId: "thread-upgraded",
    });

    expect(getAgentChatSubmitTarget("submit-tab-only")?.threadId).toBe(
      "tab-only",
    );
    expect(getAgentChatSubmitTarget("submit-thread-only")?.threadId).toBe(
      "thread-only",
    );
    expect(getAgentChatSubmitTarget("submit-upgraded")?.threadId).toBe(
      "thread-upgraded",
    );
  });

  it("forgets the oldest submissions once the history is full", () => {
    rememberAgentChatSubmitTarget("submit-oldest", "tab-oldest");
    for (let index = 0; index < 100; index += 1) {
      rememberAgentChatSubmitTarget(`submit-filler-${index}`, "tab-filler");
    }

    expect(getAgentChatSubmitTarget("submit-oldest")).toBeNull();
    expect(getAgentChatSubmitTarget("submit-filler-99")?.tabId).toBe(
      "tab-filler",
    );
  });
});

describe("useAgentChatRunningThreads", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: ReturnType<typeof useAgentChatRunningThreads> | null;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    state = null;

    function Harness() {
      state = useAgentChatRunningThreads({ pollIntervalMs: 60_000 });
      return null;
    }

    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("retains per-thread run state after focus moves to another conversation", () => {
    act(() => {
      dispatchAgentChatRunning({
        isRunning: true,
        threadId: "thread-1",
        runId: "run-1",
      });
      dispatchAgentChatRunning({
        isRunning: true,
        threadId: "thread-2",
        runId: "run-2",
      });
    });

    expect([...state!.runningThreadIds]).toEqual(["thread-1", "thread-2"]);
    expect([...state!.workingThreadIds]).toEqual(["thread-1", "thread-2"]);
    expect([...state!.observedThreadStarts.keys()]).toEqual([
      "thread-1",
      "thread-2",
    ]);

    act(() => {
      dispatchAgentChatRunning({
        isRunning: false,
        threadId: "thread-1",
        runId: "run-1",
      });
    });

    expect([...state!.runningThreadIds]).toEqual(["thread-2"]);
    expect([...state!.workingThreadIds]).toEqual(["thread-2"]);
    expect([...state!.observedThreadStarts.keys()]).toEqual([
      "thread-1",
      "thread-2",
    ]);
  });

  it("accepts the legacy tab identity while hosts migrate to threadId", () => {
    act(() => {
      dispatchAgentChatRunning({ isRunning: true, tabId: "legacy-thread" });
    });

    expect(state!.runningThreadIds.has("legacy-thread")).toBe(true);
    expect(state!.workingThreadIds.has("legacy-thread")).toBe(true);
  });

  it("ends the working presentation phase when visible response text starts", () => {
    act(() => {
      dispatchAgentChatRunning({
        isRunning: true,
        phase: "working",
        threadId: "thread-1",
      });
      dispatchAgentChatRunning({
        isRunning: true,
        phase: "responding",
        threadId: "thread-1",
      });
    });

    expect(state!.runningThreadIds.has("thread-1")).toBe(true);
    expect(state!.workingThreadIds.has("thread-1")).toBe(false);
  });
});
