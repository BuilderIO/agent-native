// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dispatchAgentChatRunning,
  useAgentChatRunningThreads,
} from "./use-agent-chat-running-threads.js";

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
