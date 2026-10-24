import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentChatEvent } from "../types.js";
import type { AgentHarnessAdapter, AgentHarnessEvent } from "./types.js";

const mocks = vi.hoisted(() => ({
  startRun: vi.fn(),
  saveAgentHarnessSession: vi.fn(),
  getAgentHarnessSession: vi.fn(),
  updateAgentHarnessSession: vi.fn(),
  updateAgentHarnessSessionAtGeneration: vi.fn(),
  markAgentHarnessSessionStopped: vi.fn(),
  isAgentHarnessSessionConflictError: (error: unknown) =>
    error instanceof Error && error.name === "AgentHarnessSessionConflictError",
}));

vi.mock("../run-manager.js", () => ({
  startRun: mocks.startRun,
}));

vi.mock("./store.js", () => ({
  AgentHarnessSessionConflictError: class extends Error {
    constructor(sessionId: string) {
      super(`Harness session ${sessionId} changed concurrently.`);
      this.name = "AgentHarnessSessionConflictError";
    }
  },
  saveAgentHarnessSession: mocks.saveAgentHarnessSession,
  getAgentHarnessSession: mocks.getAgentHarnessSession,
  isAgentHarnessSessionConflictError: mocks.isAgentHarnessSessionConflictError,
  updateAgentHarnessSession: mocks.updateAgentHarnessSession,
  updateAgentHarnessSessionAtGeneration:
    mocks.updateAgentHarnessSessionAtGeneration,
  markAgentHarnessSessionStopped: mocks.markAgentHarnessSessionStopped,
}));

const { startAgentHarnessRun } = await import("./runner.js");

describe("startAgentHarnessRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveAgentHarnessSession.mockResolvedValue({});
    mocks.getAgentHarnessSession.mockResolvedValue({
      status: "running",
      generation: 0,
      pendingApproval: null,
      resolvedApprovalIds: [],
    });
    mocks.updateAgentHarnessSession.mockImplementation(async (id, patch) => {
      const current = await mocks.getAgentHarnessSession(id);
      const updated = {
        ...current,
        ...patch,
        generation: (current?.generation ?? 0) + 1,
      };
      mocks.getAgentHarnessSession.mockResolvedValue(updated);
      return updated;
    });
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementation(
      async (
        id,
        expectedStatus,
        expectedGeneration,
        patch,
        expectedClaimId,
      ) => {
        const current = await mocks.getAgentHarnessSession(id);
        if (
          !current ||
          current.status !== expectedStatus ||
          current.generation !== expectedGeneration ||
          (expectedClaimId !== undefined &&
            current.followUpClaimId !== expectedClaimId)
        ) {
          throw Object.assign(new Error("Harness session changed."), {
            name: "AgentHarnessSessionConflictError",
          });
        }
        return mocks.updateAgentHarnessSession(id, patch);
      },
    );
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

  it("keeps an approval turn running until its stream has finished", async () => {
    const approval: AgentHarnessEvent = {
      type: "approval-request",
      id: "approval-paused-stream",
      message: "Allow the tool?",
    };
    let persistedSession: { status?: string; pendingApproval?: unknown } = {};
    mocks.saveAgentHarnessSession.mockImplementation(async (input) => {
      persistedSession = {
        status: input.status,
        pendingApproval: input.pendingApproval ?? null,
      };
      return {};
    });
    mocks.getAgentHarnessSession.mockImplementation(
      async () => persistedSession,
    );
    mocks.updateAgentHarnessSession.mockImplementation(async (_id, update) => {
      persistedSession = { ...persistedSession, ...update };
      if (update.pendingApproval) signalApprovalStored();
      return {};
    });

    let releaseStream: (() => void) | undefined;
    let signalApprovalStored!: () => void;
    let signalStreamSuspended!: () => void;
    const approvalStored = new Promise<void>((resolve) => {
      signalApprovalStored = resolve;
    });
    const streamSuspended = new Promise<void>((resolve) => {
      signalStreamSuspended = resolve;
    });
    const session = fakeSession("native-paused-approval", []);
    session.streamTurn = async function* () {
      yield approval;
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
        signalStreamSuspended();
      });
    };
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
      runId: "run-paused-approval",
      threadId: "thread-paused-approval",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-paused-approval" },
    });

    const execution = capturedRunFn?.(() => {}, new AbortController().signal);
    expect(execution).toBeDefined();
    try {
      await Promise.all([approvalStored, streamSuspended]);
      expect(persistedSession).toMatchObject({
        status: "running",
        pendingApproval: { id: approval.id },
      });

      persistedSession = { ...persistedSession, pendingApproval: null };
      expect(persistedSession.status).toBe("running");
    } finally {
      releaseStream?.();
      await execution;
    }

    expect(persistedSession).toMatchObject({
      status: "idle",
      pendingApproval: null,
    });
  });

  it("preserves a newer chained approval at the original runner checkpoint", async () => {
    const approval: AgentHarnessEvent = {
      type: "approval-request",
      id: "approval-first",
      message: "Allow the first tool?",
    };
    const chainedApproval: AgentHarnessEvent = {
      type: "approval-request",
      id: "approval-chained",
      message: "Allow the next tool?",
    };
    let persistedSession: {
      status?: string;
      generation: number;
      pendingApproval?: unknown;
      resolvedApprovalIds?: string[];
    } = {
      status: "running",
      generation: 0,
      pendingApproval: null,
      resolvedApprovalIds: [],
    };
    mocks.saveAgentHarnessSession.mockImplementation(async (input) => {
      persistedSession = { ...persistedSession, ...input };
      return persistedSession;
    });
    mocks.getAgentHarnessSession.mockImplementation(
      async () => persistedSession,
    );
    mocks.updateAgentHarnessSession.mockImplementation(async (_id, patch) => {
      persistedSession = {
        ...persistedSession,
        ...patch,
        generation: persistedSession.generation + 1,
      };
      if (patch.pendingApproval) signalApprovalStored();
      return persistedSession;
    });
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementation(
      async (_id, expectedStatus, expectedGeneration, patch) => {
        if (
          persistedSession.status !== expectedStatus ||
          persistedSession.generation !== expectedGeneration
        ) {
          throw Object.assign(new Error("Harness session changed."), {
            name: "AgentHarnessSessionConflictError",
          });
        }
        return mocks.updateAgentHarnessSession("stored-chained", patch);
      },
    );

    let signalApprovalStored!: () => void;
    let signalStreamSuspended!: () => void;
    let releaseStream!: () => void;
    const approvalStored = new Promise<void>((resolve) => {
      signalApprovalStored = resolve;
    });
    const streamSuspended = new Promise<void>((resolve) => {
      signalStreamSuspended = resolve;
    });
    const session = fakeSession("native-chained-approval", []);
    session.streamTurn = async function* () {
      yield approval;
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
        signalStreamSuspended();
      });
    };
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
      runId: "run-chained-approval",
      threadId: "thread-chained-approval",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-chained" },
    });
    const execution = capturedRunFn?.(() => {}, new AbortController().signal);
    expect(execution).toBeDefined();

    await Promise.all([approvalStored, streamSuspended]);
    persistedSession = {
      ...persistedSession,
      pendingApproval: chainedApproval,
      resolvedApprovalIds: [approval.id],
      generation: persistedSession.generation + 1,
    };
    releaseStream();
    await execution;

    expect(persistedSession).toMatchObject({
      status: "idle",
      pendingApproval: { id: "approval-chained" },
      resolvedApprovalIds: ["approval-first"],
    });
  });

  it("leaves a reserved approval for its dispatch instead of checkpointing it idle", async () => {
    const approval: AgentHarnessEvent = {
      type: "approval-request",
      id: "approval-runner-checkpoint",
      message: "Allow the tool?",
    };
    let persistedSession = {
      status: "running",
      generation: 0,
      pendingApproval: null as unknown,
      approvalResolutionId: null as string | null,
      resolvedApprovalIds: [] as string[],
    };
    mocks.saveAgentHarnessSession.mockImplementation(async (input) => {
      persistedSession = {
        ...persistedSession,
        ...input,
        status: "running",
        generation: 0,
        pendingApproval: input.pendingApproval ?? null,
        approvalResolutionId: null,
        resolvedApprovalIds: input.resolvedApprovalIds ?? [],
      };
      return persistedSession;
    });
    mocks.getAgentHarnessSession.mockImplementation(
      async () => persistedSession,
    );
    mocks.updateAgentHarnessSession.mockImplementation(async (_id, patch) => {
      persistedSession = {
        ...persistedSession,
        ...patch,
        generation: persistedSession.generation + 1,
      };
      if (patch.pendingApproval) {
        persistedSession = {
          ...persistedSession,
          approvalResolutionId: approval.id,
          generation: persistedSession.generation + 1,
        };
      }
      return persistedSession;
    });

    const session = fakeSession("native-checkpoint-approval", [approval]);
    const adapter = fakeAdapter(session);
    let capturedRunFn:
      | ((
          send: (event: AgentChatEvent) => void,
          signal: AbortSignal,
        ) => Promise<void>)
      | undefined;
    mocks.startRun.mockImplementation((_runId, _threadId, runFn) => {
      capturedRunFn = runFn;
      return {
        runId: "run-checkpoint-approval",
        threadId: "thread-checkpoint-approval",
        turnId: "run-checkpoint-approval",
        events: [],
        status: "running",
        subscribers: new Set(),
        abort: new AbortController(),
        startedAt: Date.now(),
      };
    });

    startAgentHarnessRun({
      runId: "run-checkpoint-approval",
      threadId: "thread-checkpoint-approval",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-checkpoint-approval" },
    });
    await capturedRunFn?.(() => {}, new AbortController().signal);

    expect(persistedSession).toMatchObject({
      status: "running",
      pendingApproval: { id: approval.id },
      approvalResolutionId: approval.id,
    });
    expect(mocks.updateAgentHarnessSession).not.toHaveBeenCalledWith(
      "stored-checkpoint-approval",
      expect.objectContaining({ status: "idle" }),
    );
    expect(mocks.updateAgentHarnessSessionAtGeneration).not.toHaveBeenCalled();
  });

  it("does not restore idle after a stop wins the approval checkpoint race", async () => {
    const approval: AgentHarnessEvent = {
      type: "approval-request",
      id: "approval-stop-checkpoint-race",
      message: "Allow the tool?",
    };
    let persistedSession = {
      status: "running",
      generation: 0,
      pendingApproval: null as unknown,
      approvalResolutionId: null as string | null,
      resolvedApprovalIds: [] as string[],
    };
    mocks.saveAgentHarnessSession.mockImplementation(async (input) => {
      persistedSession = {
        ...persistedSession,
        ...input,
        status: "running",
        generation: 0,
        pendingApproval: input.pendingApproval ?? null,
        approvalResolutionId: null,
        resolvedApprovalIds: input.resolvedApprovalIds ?? [],
      };
      return persistedSession;
    });
    mocks.getAgentHarnessSession.mockImplementation(
      async () => persistedSession,
    );
    mocks.updateAgentHarnessSession.mockImplementation(async (_id, patch) => {
      persistedSession = {
        ...persistedSession,
        ...patch,
        generation: persistedSession.generation + 1,
      };
      return persistedSession;
    });
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementationOnce(
      async () => {
        persistedSession = {
          ...persistedSession,
          status: "stopped",
          pendingApproval: null,
          generation: persistedSession.generation + 1,
        };
        throw Object.assign(new Error("Harness session changed."), {
          name: "AgentHarnessSessionConflictError",
        });
      },
    );

    const session = fakeSession("native-stop-checkpoint-race", [approval]);
    const adapter = fakeAdapter(session);
    let capturedRunFn:
      | ((
          send: (event: AgentChatEvent) => void,
          signal: AbortSignal,
        ) => Promise<void>)
      | undefined;
    mocks.startRun.mockImplementation((_runId, _threadId, runFn) => {
      capturedRunFn = runFn;
      return {
        runId: "run-stop-checkpoint-race",
        threadId: "thread-stop-checkpoint-race",
        turnId: "run-stop-checkpoint-race",
        events: [],
        status: "running",
        subscribers: new Set(),
        abort: new AbortController(),
        startedAt: Date.now(),
      };
    });

    startAgentHarnessRun({
      runId: "run-stop-checkpoint-race",
      threadId: "thread-stop-checkpoint-race",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-stop-checkpoint-race" },
    });
    await capturedRunFn?.(() => {}, new AbortController().signal);

    expect(persistedSession).toMatchObject({
      status: "stopped",
      pendingApproval: null,
    });
    expect(mocks.updateAgentHarnessSession).not.toHaveBeenCalledWith(
      "stored-stop-checkpoint-race",
      expect.objectContaining({ status: "idle" }),
    );
    expect(mocks.updateAgentHarnessSessionAtGeneration).toHaveBeenCalledOnce();
  });

  it("does not restore an approval resolved before the turn becomes idle", async () => {
    const approval: AgentHarnessEvent = {
      type: "approval-request",
      id: "approval-resolved-before-idle",
      message: "Allow the tool?",
    };
    let persistedSession: {
      status?: string;
      generation: number;
      pendingApproval?: unknown;
      approvalResolutionId?: string | null;
      resolvedApprovalIds?: string[];
    } = {
      status: "running",
      generation: 0,
      pendingApproval: null,
      approvalResolutionId: null,
      resolvedApprovalIds: [],
    };
    mocks.saveAgentHarnessSession.mockImplementation(async (input) => {
      persistedSession = {
        ...persistedSession,
        status: "running",
        generation: 0,
        pendingApproval: input.pendingApproval ?? null,
        approvalResolutionId: null,
        resolvedApprovalIds: input.resolvedApprovalIds ?? [],
      };
      return persistedSession;
    });
    mocks.getAgentHarnessSession.mockImplementation(
      async () => persistedSession,
    );
    mocks.updateAgentHarnessSession.mockImplementation(async (_id, update) => {
      persistedSession = {
        ...persistedSession,
        ...update,
        generation: persistedSession.generation + 1,
      };
      return persistedSession;
    });
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementationOnce(
      async () => {
        persistedSession = {
          ...persistedSession,
          pendingApproval: null,
          resolvedApprovalIds: [approval.id],
          generation: persistedSession.generation + 1,
        };
        throw Object.assign(new Error("Harness session changed."), {
          name: "AgentHarnessSessionConflictError",
        });
      },
    );

    const session = fakeSession("native-resolved-before-idle", [approval]);
    const adapter = fakeAdapter(session);
    let capturedRunFn:
      | ((send: (event: AgentChatEvent) => void) => Promise<void>)
      | undefined;
    mocks.startRun.mockImplementation((_runId, _threadId, runFn) => {
      capturedRunFn = runFn;
      return {
        runId: "run-resolved-before-idle",
        threadId: "thread-resolved-before-idle",
        turnId: "run-resolved-before-idle",
        events: [],
        status: "running",
        subscribers: new Set(),
        abort: new AbortController(),
        startedAt: Date.now(),
      };
    });

    startAgentHarnessRun({
      runId: "run-resolved-before-idle",
      threadId: "thread-resolved-before-idle",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-resolved-before-idle" },
      onHarnessEvent: (event) => {
        if (event.type === "approval-request") {
          expect(persistedSession.pendingApproval).toMatchObject({
            id: event.id,
          });
        }
      },
    });

    await capturedRunFn?.(() => {}, new AbortController().signal);

    expect(persistedSession).toMatchObject({
      status: "idle",
      pendingApproval: null,
      resolvedApprovalIds: [approval.id],
    });
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

  it("persists a resumable checkpoint instead of marking a boundary stopped", async () => {
    const session = fakeSession(
      "native-checkpoint",
      [{ type: "text-delta", text: "partial" }],
      { token: "checkpoint" },
    );
    const adapter = fakeAdapter(session);
    let capturedRunFn: (
      send: (event: AgentChatEvent) => void,
      signal: AbortSignal,
      control: {
        turnSignal: AbortSignal;
        chunkSignal: AbortSignal;
        chunkBoundaryReason: () => string | null;
        beginChunk: () => AbortSignal;
      },
    ) => Promise<void>;
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
      runId: "run-checkpoint",
      threadId: "thread-checkpoint",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-checkpoint" },
    });

    const turn = new AbortController();
    const chunk = new AbortController();
    chunk.abort("run_timeout");
    const control = {
      turnSignal: turn.signal,
      chunkSignal: chunk.signal,
      chunkBoundaryReason: () => "run_timeout",
      beginChunk: () => turn.signal,
    };
    await capturedRunFn!(() => {}, chunk.signal, control);

    expect(session.detach).toHaveBeenCalledOnce();
    expect(mocks.markAgentHarnessSessionStopped).not.toHaveBeenCalled();
    expect(mocks.updateAgentHarnessSession).toHaveBeenCalledWith(
      "stored-checkpoint",
      expect.objectContaining({
        status: "idle",
        resumeState: { token: "checkpoint" },
        pendingApproval: null,
      }),
    );
    expect(mocks.startRun.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({ recoverChunkBoundaries: true }),
    );
  });

  it("leaves the reserved approval generation untouched at a runner checkpoint", async () => {
    mocks.getAgentHarnessSession.mockResolvedValue({
      status: "idle",
      generation: 4,
      pendingApproval: { id: "approval-checkpoint" },
      approvalResolutionId: "approval-checkpoint",
      resolvedApprovalIds: [],
    });
    const session = fakeSession(
      "native-checkpoint-during-approval",
      [{ type: "text-delta", text: "partial" }],
      { token: "checkpoint" },
    );
    const adapter = fakeAdapter(session);
    let capturedRunFn!: (
      send: (event: AgentChatEvent) => void,
      signal: AbortSignal,
      control: {
        turnSignal: AbortSignal;
        chunkSignal: AbortSignal;
        chunkBoundaryReason: () => string | null;
        beginChunk: () => AbortSignal;
      },
    ) => Promise<void>;
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
      runId: "run-checkpoint-during-approval",
      threadId: "thread-checkpoint-during-approval",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-checkpoint-during-approval" },
    });
    const turn = new AbortController();
    const chunk = new AbortController();
    chunk.abort("run_timeout");
    await capturedRunFn(() => {}, chunk.signal, {
      turnSignal: turn.signal,
      chunkSignal: chunk.signal,
      chunkBoundaryReason: () => "run_timeout",
      beginChunk: () => turn.signal,
    });

    expect(session.detach).toHaveBeenCalledOnce();
    expect(mocks.updateAgentHarnessSessionAtGeneration).not.toHaveBeenCalled();
    expect(mocks.updateAgentHarnessSession).not.toHaveBeenCalled();
  });

  it("cleans up and marks the session errored when streaming fails", async () => {
    const session = fakeSession("native-error", [
      { type: "error", error: "provider disconnected" },
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

    startAgentHarnessRun({
      runId: "run-error",
      threadId: "thread-error",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-error" },
    });

    await expect(
      capturedRunFn?.(() => {}, new AbortController().signal),
    ).rejects.toThrow("provider disconnected");

    expect(session.stop).toHaveBeenCalledOnce();
    expect(mocks.updateAgentHarnessSession).toHaveBeenCalledWith(
      "stored-error",
      expect.objectContaining({ status: "errored", pendingApproval: null }),
    );
  });

  it("preserves a lifecycle winner when an approval write loses its CAS race", async () => {
    const session = fakeSession("native-race", [
      {
        type: "approval-request",
        id: "approval-race",
        message: "Allow the tool?",
      },
    ]);
    const adapter = fakeAdapter(session);
    let capturedRunFn:
      | ((
          send: (event: AgentChatEvent) => void,
          signal: AbortSignal,
        ) => Promise<void>)
      | undefined;
    mocks.getAgentHarnessSession.mockResolvedValue({
      status: "idle",
      pendingApproval: null,
    });
    mocks.updateAgentHarnessSession.mockRejectedValueOnce(
      Object.assign(new Error("Harness session changed concurrently"), {
        name: "AgentHarnessSessionConflictError",
      }),
    );
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
      runId: "run-race",
      threadId: "thread-race",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-race" },
    });

    await capturedRunFn?.(() => {}, new AbortController().signal);

    expect(session.stop).not.toHaveBeenCalled();
    expect(mocks.markAgentHarnessSessionStopped).not.toHaveBeenCalled();
    expect(mocks.updateAgentHarnessSession).toHaveBeenCalledTimes(1);
  });

  it("disposes a newly created session when its initial save loses the CAS race", async () => {
    const session = fakeSession("native-initial-race", []);
    const adapter = fakeAdapter(session);
    let capturedRunFn:
      | ((
          send: (event: AgentChatEvent) => void,
          signal: AbortSignal,
        ) => Promise<void>)
      | undefined;
    mocks.saveAgentHarnessSession.mockRejectedValueOnce(
      Object.assign(new Error("Harness session changed concurrently"), {
        name: "AgentHarnessSessionConflictError",
      }),
    );
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
      runId: "run-initial-race",
      threadId: "thread-initial-race",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-initial-race" },
    });

    await capturedRunFn?.(() => {}, new AbortController().signal);

    expect(session.stop).toHaveBeenCalledOnce();
    expect(session.destroy).not.toHaveBeenCalled();
    expect(mocks.getAgentHarnessSession).not.toHaveBeenCalled();
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
