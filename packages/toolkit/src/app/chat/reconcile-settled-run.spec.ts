// @vitest-environment happy-dom

import type { AgentThreadState } from "@agent-native/agentkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isWaitingOnConnectionRequest,
  reconcileSettledRun,
} from "./reconcile-settled-run.js";

function thread(
  activeRunIds: string[],
  tools: AgentThreadState["tools"] = {},
): AgentThreadState {
  return { activeRunIds, tools } as unknown as AgentThreadState;
}

const tool = (
  name: string,
  status: "running" | "completed" | "failed",
  runId: string,
  metadata?: Record<string, unknown>,
) => ({ id: `${name}-${runId}`, name, status, runId, metadata });

describe("reconcileSettledRun", () => {
  const toolDone: Array<Record<string, unknown>> = [];
  let refreshes = 0;
  const onToolDone = (event: Event) =>
    toolDone.push((event as CustomEvent).detail);
  const onRefresh = () => {
    refreshes += 1;
  };

  beforeEach(() => {
    toolDone.length = 0;
    refreshes = 0;
    window.addEventListener("agent-native:tool-done", onToolDone);
    window.addEventListener("agentNative:refresh-data", onRefresh);
  });

  afterEach(() => {
    window.removeEventListener("agent-native:tool-done", onToolDone);
    window.removeEventListener("agentNative:refresh-data", onRefresh);
  });

  it("settles a run the server finished and replays its writes so the data refreshes", async () => {
    let current = thread(["run-1"]);
    const load = vi.fn(async () => {
      current = thread([], {
        a: tool("save-dashboard", "completed", "run-1"),
        b: tool("save-dashboard", "completed", "run-1"),
        c: tool("run-query", "completed", "run-1", {
          completedSideEffect: false,
        }),
        d: tool("update-chart", "failed", "run-1"),
        e: tool("old-tool", "completed", "run-0"),
      });
    });

    await expect(
      reconcileSettledRun({ load, getThread: () => current, tabId: "tab-1" }),
    ).resolves.toBe("settled");

    expect(load).toHaveBeenCalledOnce();
    expect(toolDone).toEqual([
      {
        tool: "save-dashboard",
        isError: false,
        completedSideEffect: true,
        tabId: "tab-1",
      },
      {
        tool: "update-chart",
        isError: true,
        completedSideEffect: true,
        tabId: "tab-1",
      },
    ]);
    expect(refreshes).toBe(1);
  });

  it("reports a chat the reload could not settle, without refreshing anything", async () => {
    const current = thread(["run-1"], {
      a: tool("save-dashboard", "completed", "run-1"),
    });

    await expect(
      reconcileSettledRun({
        load: async () => undefined,
        getThread: () => current,
        tabId: "tab-1",
      }),
    ).resolves.toBe("still_running");

    expect(toolDone).toEqual([]);
    expect(refreshes).toBe(0);
  });

  it("lets a failed reload surface instead of reporting the chat settled", async () => {
    const failure = new Error("thread unavailable");

    await expect(
      reconcileSettledRun({
        load: async () => {
          throw failure;
        },
        getThread: () => thread(["run-1"]),
        tabId: "tab-1",
      }),
    ).rejects.toBe(failure);

    expect(toolDone).toEqual([]);
    expect(refreshes).toBe(0);
  });
});

describe("isWaitingOnConnectionRequest", () => {
  const waiting = (
    runStatus: string,
    requestStatus: string,
    requestRunId = "run-1",
  ) =>
    ({
      activeRunIds: ["run-1"],
      runs: { "run-1": { status: runStatus } },
      connectionRequests: { "connection-1": { status: requestStatus } },
      connectionRequestRunIds: { "connection-1": requestRunId },
    }) as unknown as AgentThreadState;

  it("is true while an input-paused run has an open request", () => {
    expect(
      isWaitingOnConnectionRequest(waiting("awaiting_input", "requested")),
    ).toBe(true);
    expect(
      isWaitingOnConnectionRequest(waiting("awaiting_input", "connecting")),
    ).toBe(true);
  });

  it("is false for a run that is working, or whose request is answered or missing", () => {
    expect(isWaitingOnConnectionRequest(waiting("running", "requested"))).toBe(
      false,
    );
    expect(
      isWaitingOnConnectionRequest(waiting("awaiting_input", "connected")),
    ).toBe(false);
    expect(
      isWaitingOnConnectionRequest(
        waiting("awaiting_input", "requested", "run-0"),
      ),
    ).toBe(false);
    expect(
      isWaitingOnConnectionRequest({
        ...waiting("awaiting_input", "requested"),
        connectionRequests: {},
      }),
    ).toBe(false);
  });

  it("is false when no run is active", () => {
    expect(
      isWaitingOnConnectionRequest({
        ...waiting("awaiting_input", "requested"),
        activeRunIds: [],
      }),
    ).toBe(false);
  });
});
