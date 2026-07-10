import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentChatEvent } from "../types.js";
import type { AgentHarnessAdapter, AgentHarnessEvent } from "./types.js";

const mocks = vi.hoisted(() => ({
  startRun: vi.fn(),
  saveAgentHarnessSession: vi.fn(),
  getAgentHarnessSession: vi.fn(),
  updateAgentHarnessSession: vi.fn(),
  markAgentHarnessSessionStopped: vi.fn(),
}));

vi.mock("../run-manager.js", () => ({
  startRun: mocks.startRun,
}));

vi.mock("./store.js", () => ({
  saveAgentHarnessSession: mocks.saveAgentHarnessSession,
  getAgentHarnessSession: mocks.getAgentHarnessSession,
  updateAgentHarnessSession: mocks.updateAgentHarnessSession,
  markAgentHarnessSessionStopped: mocks.markAgentHarnessSessionStopped,
}));

const { startAgentHarnessRun } = await import("./runner.js");

describe("startAgentHarnessRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveAgentHarnessSession.mockResolvedValue({});
    mocks.getAgentHarnessSession.mockResolvedValue({ pendingApproval: null });
    mocks.updateAgentHarnessSession.mockResolvedValue({});
    mocks.markAgentHarnessSessionStopped.mockResolvedValue({});
  });

  it("streams harness events through startRun and detaches session state", async () => {
    const events: AgentHarnessEvent[] = [
      { type: "text-delta", text: "Hello" },
      { type: "tool-start", name: "read", input: { path: "a.ts" } },
      { type: "tool-done", name: "read", result: "ok" },
      { type: "done" },
    ];
    const session = fakeSession("native-1", events, { token: "resume" });
    const adapter = fakeAdapter(session);
    let capturedRunFn:
      | ((
          send: (event: AgentChatEvent) => void,
          signal: AbortSignal,
        ) => Promise<void>)
      | undefined;
    mocks.startRun.mockImplementation((runId, threadId, runFn) => {
      capturedRunFn = runFn;
      return {
        runId,
        threadId,
        turnId: runId,
        events: [],
        status: "running",
        subscribers: new Set(),
        abort: new AbortController(),
        startedAt: Date.now(),
      };
    });

    startAgentHarnessRun({
      runId: "run-1",
      threadId: "thread-1",
      adapter,
      input: { prompt: "do work" },
      createSession: { sessionId: "stored-1" },
      ownerEmail: "alice@example.com",
    });

    const sent: AgentChatEvent[] = [];
    await capturedRunFn?.(
      (event) => sent.push(event),
      new AbortController().signal,
    );

    expect(sent).toEqual([
      {
        type: "activity",
        label: "Starting Fake Harness",
        tool: "harness",
      },
      { type: "text", text: "Hello" },
      { type: "tool_start", tool: "read", input: { path: "a.ts" } },
      { type: "tool_done", tool: "read", result: "ok" },
    ]);
    expect(mocks.saveAgentHarnessSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "stored-1",
        harnessName: "fake",
        threadId: "thread-1",
        runId: "run-1",
        providerSessionId: "native-1",
        status: "running",
        ownerEmail: "alice@example.com",
      }),
    );
    expect(mocks.updateAgentHarnessSession).toHaveBeenCalledWith(
      "stored-1",
      expect.objectContaining({
        status: "idle",
        resumeState: { token: "resume" },
        pendingApproval: null,
      }),
    );
  });

  it("stops and marks the session when the run signal is aborted", async () => {
    const session = fakeSession("native-2", [
      { type: "text-delta", text: "hi" },
    ]);
    const adapter = fakeAdapter(session);
    let capturedRunFn:
      | ((
          send: (event: AgentChatEvent) => void,
          signal: AbortSignal,
        ) => Promise<void>)
      | undefined;
    mocks.startRun.mockImplementation((runId, threadId, runFn) => {
      capturedRunFn = runFn;
      return {
        runId,
        threadId,
        turnId: runId,
        events: [],
        status: "running",
        subscribers: new Set(),
        abort: new AbortController(),
        startedAt: Date.now(),
      };
    });
    const abort = new AbortController();
    abort.abort();

    startAgentHarnessRun({
      runId: "run-2",
      threadId: "thread-2",
      adapter,
      input: { prompt: "stop" },
    });
    await capturedRunFn?.(() => {}, abort.signal);

    expect(session.stop).toHaveBeenCalled();
    expect(mocks.markAgentHarnessSessionStopped).toHaveBeenCalledWith(
      "native-2",
      "stopped",
    );
  });
});

function fakeAdapter(
  session: Awaited<ReturnType<typeof fakeSession>>,
): AgentHarnessAdapter {
  return {
    name: "fake",
    label: "Fake Harness",
    description: "Fake harness",
    capabilities: {
      sandbox: false,
      resumable: true,
      approvals: true,
      hostTools: false,
      fileEvents: false,
    },
    createSession: vi.fn(async () => session),
  };
}

function fakeSession(
  id: string,
  events: AgentHarnessEvent[],
  detachState?: unknown,
) {
  return {
    id,
    async *streamTurn() {
      for (const event of events) {
        yield event;
      }
    },
    detach: vi.fn(async () => detachState),
    stop: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
}
