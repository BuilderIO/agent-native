// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMock = vi.hoisted(() => ({
  trackAgentChatLifecycle: vi.fn(),
}));

vi.mock("../analytics.js", () => analyticsMock);

import { clearActiveRun, setActiveRun } from "../active-run-state.js";
import { useAgentChatLifecycleTracking } from "./use-agent-chat-lifecycle-tracking.js";

describe("useAgentChatLifecycleTracking", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clearActiveRun();
    analyticsMock.trackAgentChatLifecycle.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    clearActiveRun();
  });

  it("tracks surface, active run, and stop wiring with correlation ids", async () => {
    let stop: ((runId?: string) => void) | null = null;
    const onActiveRunChange = vi.fn();

    function Probe() {
      stop = useAgentChatLifecycleTracking({
        surface: "sidebar",
        threadId: "thread-1",
        tabId: "tab-1",
        onActiveRunChange,
      });
      return null;
    }

    await act(async () => root.render(<Probe />));
    expect(analyticsMock.trackAgentChatLifecycle).toHaveBeenCalledWith({
      phase: "surface-mounted",
      surface: "sidebar",
      threadId: "thread-1",
      tabId: "tab-1",
    });
    expect(onActiveRunChange).toHaveBeenLastCalledWith(false);

    await act(async () => {
      setActiveRun({
        threadId: "thread-1",
        runId: "run-1",
        lastSeq: 0,
      });
    });
    expect(onActiveRunChange).toHaveBeenLastCalledWith(true);
    expect(analyticsMock.trackAgentChatLifecycle).toHaveBeenCalledWith({
      phase: "run-observed",
      surface: "sidebar",
      threadId: "thread-1",
      runId: "run-1",
      tabId: "tab-1",
    });

    stop?.("run-1");
    expect(analyticsMock.trackAgentChatLifecycle).toHaveBeenCalledWith({
      phase: "run-stopped",
      surface: "sidebar",
      threadId: "thread-1",
      runId: "run-1",
      tabId: "tab-1",
    });
  });
});
