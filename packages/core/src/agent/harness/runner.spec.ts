import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentChatEvent } from "../types.js";
import { getLiveAgentHarnessSessionGeneration } from "./lifecycle.js";
import type { AgentHarnessAdapter, AgentHarnessEvent } from "./types.js";

const mocks = vi.hoisted(() => ({
  liveSessions: new Map<string, { session: object; generation: number }>(),
  startRun: vi.fn(),
  registerLiveAgentHarnessSession: vi.fn(),
  getLiveAgentHarnessSessionGeneration: vi.fn(),
  refreshLiveAgentHarnessSessionGeneration: vi.fn(),
  releaseLiveAgentHarnessSession: vi.fn(),
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

vi.mock("./lifecycle.js", () => ({
  registerLiveAgentHarnessSession: mocks.registerLiveAgentHarnessSession,
  getLiveAgentHarnessSessionGeneration:
    mocks.getLiveAgentHarnessSessionGeneration,
  refreshLiveAgentHarnessSessionGeneration:
    mocks.refreshLiveAgentHarnessSessionGeneration,
  releaseLiveAgentHarnessSession: mocks.releaseLiveAgentHarnessSession,
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

const { AgentHarnessApprovalResolutionTimeoutError, startAgentHarnessRun } =
  await import("./runner.js");

describe("startAgentHarnessRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.liveSessions.clear();
    mocks.registerLiveAgentHarnessSession.mockImplementation(
      ({ sessionId, session, generation }) => {
        mocks.liveSessions.set(sessionId, { session, generation });
      },
    );
    mocks.getLiveAgentHarnessSessionGeneration.mockImplementation(
      (sessionId, session) => {
        const live = mocks.liveSessions.get(sessionId);
        return live?.session === session ? live.generation : null;
      },
    );
    mocks.refreshLiveAgentHarnessSessionGeneration.mockImplementation(
      (sessionId, session, generation) => {
        const live = mocks.liveSessions.get(sessionId);
        if (live?.session === session) {
          live.generation = Math.max(live.generation, generation);
        }
      },
    );
    mocks.releaseLiveAgentHarnessSession.mockImplementation(
      (sessionId, session) => {
        const live = mocks.liveSessions.get(sessionId);
        if (!live || (session && live.session !== session)) return;
        mocks.liveSessions.delete(sessionId);
      },
    );
    mocks.saveAgentHarnessSession.mockResolvedValue({ generation: 0 });
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
        fence,
      ) => {
        const requiresNoApprovalResolution =
          typeof fence === "boolean"
            ? fence
            : fence?.requiresNoApprovalResolution;
        const expectedApprovalResolutionId =
          typeof fence === "boolean"
            ? undefined
            : fence?.expectedApprovalResolutionId;
        const current = await mocks.getAgentHarnessSession(id);
        if (
          !current ||
          current.status !== expectedStatus ||
          current.generation !== expectedGeneration ||
          (expectedClaimId !== undefined &&
            current.followUpClaimId !== expectedClaimId) ||
          (requiresNoApprovalResolution && current.approvalResolutionId) ||
          (expectedApprovalResolutionId !== undefined &&
            current.approvalResolutionId !== expectedApprovalResolutionId)
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
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementationOnce(
      async (id, _status, _generation, patch) => {
        expect(getLiveAgentHarnessSessionGeneration(id, session)).toBeNull();
        return mocks.updateAgentHarnessSession(id, patch);
      },
    );
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
    const idleCheckpointIndex =
      mocks.updateAgentHarnessSessionAtGeneration.mock.calls.findIndex(
        (call) => call[3]?.status === "idle",
      );
    expect(idleCheckpointIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.releaseLiveAgentHarnessSession).toHaveBeenCalledTimes(1);
    expect(
      mocks.releaseLiveAgentHarnessSession.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.updateAgentHarnessSessionAtGeneration.mock.invocationCallOrder[
        idleCheckpointIndex
      ]!,
    );
  });

  it("cancels a late approval event when a stop wins its generation fence", async () => {
    const approval: AgentHarnessEvent = {
      type: "approval-request",
      id: "approval-after-stop",
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
        pendingApproval: null,
        approvalResolutionId: null,
      };
      return persistedSession;
    });
    mocks.getAgentHarnessSession.mockImplementation(
      async () => persistedSession,
    );
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementationOnce(
      async (_id, expectedStatus, expectedGeneration, patch) => {
        expect(expectedStatus).toBe("running");
        expect(expectedGeneration).toBe(0);
        expect(patch).toEqual({ pendingApproval: approval });
        persistedSession = {
          ...persistedSession,
          status: "stopped",
          generation: 1,
          pendingApproval: null,
        };
        throw Object.assign(new Error("Harness session changed."), {
          name: "AgentHarnessSessionConflictError",
        });
      },
    );

    let releaseApprovalEvent!: () => void;
    let signalStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => {
      signalStreamStarted = resolve;
    });
    const session = fakeSession("native-late-approval", []);
    session.streamTurn = async function* () {
      await new Promise<void>((resolve) => {
        releaseApprovalEvent = resolve;
        signalStreamStarted();
      });
      yield approval;
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
      runId: "run-late-approval",
      threadId: "thread-late-approval",
      adapter,
      input: { prompt: "work" },
      createSession: { sessionId: "stored-late-approval" },
    });
    const execution = capturedRunFn?.(() => {}, new AbortController().signal);
    expect(execution).toBeDefined();
    await streamStarted;

    releaseApprovalEvent();
    await execution;

    expect(persistedSession).toMatchObject({
      status: "stopped",
      generation: 1,
      pendingApproval: null,
    });
    expect(mocks.updateAgentHarnessSession).not.toHaveBeenCalledWith(
      "stored-late-approval",
      expect.objectContaining({ pendingApproval: approval }),
    );
  });

  it("keeps an approval turn running until its stream has finished", async () => {
    const approval: AgentHarnessEvent = {
      type: "approval-request",
      id: "approval-paused-stream",
      message: "Allow the tool?",
    };
    let persistedSession: {
      status?: string;
      generation: number;
      pendingApproval?: unknown;
    } = { generation: 0 };
    mocks.saveAgentHarnessSession.mockImplementation(async (input) => {
      persistedSession = {
        status: input.status,
        generation: 0,
        pendingApproval: input.pendingApproval ?? null,
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
      if (update.pendingApproval) signalApprovalStored();
      return persistedSession;
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

  it("waits for a reserved approval before checkpointing idle", async () => {
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
      resumeState: { token: "before-approval" } as unknown,
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
    let sessionReads = 0;
    mocks.getAgentHarnessSession.mockImplementation(async () => {
      sessionReads += 1;
      if (sessionReads >= 3 && persistedSession.approvalResolutionId) {
        persistedSession = {
          ...persistedSession,
          pendingApproval: null,
          approvalResolutionId: null,
          resumeState: { token: "after-approval" },
          resolvedApprovalIds: [approval.id],
          generation: persistedSession.generation + 1,
        };
      }
      return persistedSession;
    });
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
      createSession: {
        sessionId: "stored-checkpoint-approval",
        resumeState: { token: "before-approval" },
      },
    });
    await capturedRunFn?.(() => {}, new AbortController().signal);

    expect(persistedSession).toMatchObject({
      status: "idle",
      pendingApproval: null,
      approvalResolutionId: null,
      resolvedApprovalIds: [approval.id],
    });
    expect(mocks.updateAgentHarnessSession).toHaveBeenCalledWith(
      "stored-checkpoint-approval",
      expect.objectContaining({ status: "idle" }),
    );
    expect(mocks.updateAgentHarnessSessionAtGeneration).toHaveBeenCalledWith(
      "stored-checkpoint-approval",
      "running",
      0,
      { pendingApproval: approval },
      undefined,
      true,
    );
    expect(
      mocks.updateAgentHarnessSessionAtGeneration.mock.calls.some(
        (call) => call[3]?.status === "idle",
      ),
    ).toBe(true);
    const checkpointCall =
      mocks.updateAgentHarnessSessionAtGeneration.mock.calls.find(
        (call) => call[3]?.status === "idle",
      );
    expect(checkpointCall?.[3]?.resumeState).toEqual({
      token: "after-approval",
    });
  });

  it("surfaces a typed failure when approval resolution never clears", async () => {
    vi.useFakeTimers();
    try {
      const session = fakeSession("native-stuck-approval", [
        { type: "text-delta", text: "done" },
      ]);
      const adapter = fakeAdapter(session);
      mocks.getAgentHarnessSession.mockResolvedValue({
        status: "running",
        generation: 0,
        pendingApproval: {
          type: "approval-request",
          id: "approval-stuck",
          message: "Allow the tool?",
        },
        approvalResolutionId: "approval-stuck",
        resumeState: { token: "checkpoint" },
        resolvedApprovalIds: [],
      });
      let capturedRunFn:
        | ((
            send: (event: AgentChatEvent) => void,
            signal: AbortSignal,
          ) => Promise<void>)
        | undefined;
      mocks.startRun.mockImplementation((_runId, _threadId, runFn) => {
        capturedRunFn = runFn;
        return {
          runId: "run-stuck-approval",
          threadId: "thread-stuck-approval",
          turnId: "run-stuck-approval",
          events: [],
          status: "running",
          subscribers: new Set(),
          abort: new AbortController(),
          startedAt: Date.now(),
        };
      });
      startAgentHarnessRun({
        runId: "run-stuck-approval",
        threadId: "thread-stuck-approval",
        adapter,
        input: { prompt: "work" },
        createSession: { sessionId: "stored-stuck-approval" },
      });

      const execution = capturedRunFn!(() => {}, new AbortController().signal);
      const timedOut = expect(execution).rejects.toBeInstanceOf(
        AgentHarnessApprovalResolutionTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await timedOut;
      expect(session.detach).not.toHaveBeenCalled();
      expect(session.stop).not.toHaveBeenCalled();
      expect(mocks.updateAgentHarnessSession).not.toHaveBeenCalledWith(
        "stored-stuck-approval",
        expect.objectContaining({ status: "errored" }),
      );
      await expect(
        mocks.getAgentHarnessSession("stored-stuck-approval"),
      ).resolves.toMatchObject({
        status: "idle",
        pendingApproval: { id: "approval-stuck" },
        approvalResolutionId: "approval-stuck",
        resumeState: { token: "checkpoint" },
      });
      expect(mocks.liveSessions.has("stored-stuck-approval")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    const onHarnessEvent = vi.fn();
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
      onHarnessEvent,
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
    expect(onHarnessEvent).not.toHaveBeenCalled();
    expect(session.stop).toHaveBeenCalledOnce();
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
    let checkpointConflictSimulated = false;
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementation(
      async (id, expectedStatus, expectedGeneration, patch) => {
        if (patch.status !== "idle") {
          return mocks.updateAgentHarnessSession(id, patch);
        }
        if (!checkpointConflictSimulated) {
          checkpointConflictSimulated = true;
          persistedSession = {
            ...persistedSession,
            pendingApproval: null,
            resolvedApprovalIds: [approval.id],
            generation: persistedSession.generation + 1,
          };
          throw Object.assign(new Error("Harness session changed."), {
            name: "AgentHarnessSessionConflictError",
          });
        }
        if (
          persistedSession.status !== expectedStatus ||
          persistedSession.generation !== expectedGeneration
        ) {
          throw Object.assign(new Error("Harness session changed."), {
            name: "AgentHarnessSessionConflictError",
          });
        }
        return mocks.updateAgentHarnessSession(id, patch);
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
    expect(
      mocks.markAgentHarnessSessionStopped.mock.invocationCallOrder[0],
    ).toBeLessThan(session.stop.mock.invocationCallOrder[0]);
  });

  it("persists a resumable checkpoint instead of marking a boundary stopped", async () => {
    const session = fakeSession(
      "native-checkpoint",
      [{ type: "text-delta", text: "partial" }],
      { token: "checkpoint" },
    );
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementationOnce(
      async (id, _status, _generation, patch) => {
        expect(getLiveAgentHarnessSessionGeneration(id, session)).toBeNull();
        return mocks.updateAgentHarnessSession(id, patch);
      },
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
    const idleCheckpointIndex =
      mocks.updateAgentHarnessSessionAtGeneration.mock.calls.findIndex(
        (call) => call[3]?.status === "idle",
      );
    expect(idleCheckpointIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.releaseLiveAgentHarnessSession).toHaveBeenCalledTimes(1);
    expect(
      mocks.releaseLiveAgentHarnessSession.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.updateAgentHarnessSessionAtGeneration.mock.invocationCallOrder[
        idleCheckpointIndex
      ]!,
    );
    expect(mocks.startRun.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({ recoverChunkBoundaries: true }),
    );
  });

  it("waits for a reserved approval before a chunk checkpoint", async () => {
    let sessionReads = 0;
    mocks.getAgentHarnessSession.mockImplementation(async () => {
      sessionReads += 1;
      return {
        status: "idle",
        generation: 4,
        pendingApproval: { id: "approval-checkpoint" },
        approvalResolutionId: sessionReads < 2 ? "approval-checkpoint" : null,
        resolvedApprovalIds: [],
        resumeState: { token: sessionReads < 2 ? "before" : "after" },
      };
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

    expect(session.detach).not.toHaveBeenCalled();
    expect(mocks.updateAgentHarnessSessionAtGeneration).toHaveBeenCalledWith(
      "stored-checkpoint-during-approval",
      "idle",
      4,
      expect.objectContaining({
        status: "idle",
        resumeState: { token: "after" },
      }),
      undefined,
      true,
    );
    expect(mocks.updateAgentHarnessSession).toHaveBeenCalledWith(
      "stored-checkpoint-during-approval",
      expect.objectContaining({ status: "idle" }),
    );
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
    let persistedSession = {
      status: "running",
      generation: 0,
      pendingApproval: null as unknown,
    };
    mocks.getAgentHarnessSession.mockImplementation(
      async () => persistedSession,
    );
    mocks.updateAgentHarnessSessionAtGeneration.mockImplementationOnce(
      async (_id, expectedStatus, expectedGeneration, patch) => {
        expect(expectedStatus).toBe("running");
        expect(expectedGeneration).toBe(0);
        expect(patch).toEqual({ pendingApproval: expect.any(Object) });
        persistedSession = {
          ...persistedSession,
          status: "idle",
          generation: 1,
          pendingApproval: null,
        };
        throw Object.assign(new Error("Harness session changed concurrently"), {
          name: "AgentHarnessSessionConflictError",
        });
      },
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
    expect(mocks.updateAgentHarnessSessionAtGeneration).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.updateAgentHarnessSession).not.toHaveBeenCalled();
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
