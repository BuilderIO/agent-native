import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredAgentHarnessSession } from "./store.js";
import type {
  AgentHarnessAdapter,
  AgentHarnessEvent,
  AgentHarnessSession,
} from "./types.js";

const mocks = vi.hoisted(() => ({
  getByRunId: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  updateIfFollowUpClaim: vi.fn(),
  updateAtGeneration: vi.fn(),
  claimFollowUp: vi.fn(),
  markStopped: vi.fn(),
  resolveAdapter: vi.fn(),
}));

vi.mock("./store.js", () => ({
  getAgentHarnessSessionByRunId: mocks.getByRunId,
  getAgentHarnessSession: mocks.getById,
  AgentHarnessSessionConflictError: class extends Error {
    constructor(sessionId: string) {
      super(`Harness session ${sessionId} changed concurrently.`);
      this.name = "AgentHarnessSessionConflictError";
    }
  },
  isAgentHarnessSessionConflictError: (error: unknown) =>
    error instanceof Error && error.name === "AgentHarnessSessionConflictError",
  updateAgentHarnessSession: mocks.update,
  updateAgentHarnessSessionIfFollowUpClaim: mocks.updateIfFollowUpClaim,
  updateAgentHarnessSessionAtGeneration: mocks.updateAtGeneration,
  claimAgentHarnessSessionFollowUp: mocks.claimFollowUp,
  markAgentHarnessSessionStopped: mocks.markStopped,
}));

vi.mock("./registry.js", () => ({
  resolveAgentHarness: mocks.resolveAdapter,
}));

const {
  registerLiveAgentHarnessSession,
  resolveAgentHarnessApproval,
  sendAgentHarnessFollowUp,
  stopLiveAgentHarnessSession,
} = await import("./lifecycle.js");

describe("agent harness lifecycle", () => {
  let stored: StoredAgentHarnessSession;

  beforeEach(() => {
    vi.clearAllMocks();
    stored = storedSession(`session-${Math.random()}`, `run-${Math.random()}`);
    mocks.getByRunId.mockImplementation(async () => stored);
    mocks.getById.mockImplementation(async () => stored);
    mocks.update.mockImplementation(async (_id, patch) => {
      stored = {
        ...stored,
        ...patch,
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      return stored;
    });
    mocks.updateIfFollowUpClaim.mockImplementation(
      async (_id, expectedClaimId, patch) => {
        if (
          stored.status !== "running" ||
          stored.followUpClaimId !== expectedClaimId
        ) {
          return null;
        }
        return mocks.update(_id, patch);
      },
    );
    mocks.updateAtGeneration.mockImplementation(
      async (
        _id,
        expectedStatus,
        expectedGeneration,
        patch,
        expectedClaimId,
      ) => {
        if (
          stored.status !== expectedStatus ||
          stored.generation !== expectedGeneration ||
          (expectedClaimId !== undefined &&
            stored.followUpClaimId !== expectedClaimId)
        ) {
          throw Object.assign(
            new Error("Harness session changed concurrently."),
            { name: "AgentHarnessSessionConflictError" },
          );
        }
        return mocks.update(_id, patch);
      },
    );
    mocks.claimFollowUp.mockImplementation(async (_id, generation, claimId) => {
      if (
        stored.generation !== generation ||
        stored.status !== "idle" ||
        stored.pendingApproval
      ) {
        return null;
      }
      stored = {
        ...stored,
        status: "running",
        followUpClaimId: claimId,
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      return stored;
    });
  });

  it.each([
    [true, "approves"],
    [false, "denies"],
  ])("%s pending work when it %s a live approval", async (approved) => {
    const session = fakeSession();
    stored.pendingApproval = approvalEvent("approval-1");
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-1", approved },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.approve).toHaveBeenCalledWith({
      id: "approval-1",
      approved,
    });
    expect(stored.pendingApproval).toBeNull();
    expect(stored.resolvedApprovalIds).toContain("approval-1");
  });

  it("runs a follow-up through a live session and persists detached state", async () => {
    const session = fakeSession([{ type: "text-delta", text: "done" }]);
    register(stored, session);

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: " next task ",
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.streamTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "next task",
        metadata: undefined,
      }),
    );
    expect(stored.resumeState).toEqual({ token: "next" });
  });

  it("preserves a chained approval already persisted during the follow-up", async () => {
    const session = fakeSession([{ type: "done" }]);
    register(stored, session);
    let lookups = 0;
    mocks.getByRunId.mockImplementation(async () => {
      lookups += 1;
      if (lookups === 2) {
        stored = {
          ...stored,
          pendingApproval: approvalEvent("approval-chained"),
          generation: stored.generation + 1,
        };
      }
      return stored;
    });

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({
      ok: true,
      session: {
        status: "idle",
        pendingApproval: { id: "approval-chained" },
      },
    });
    expect(session.detach).not.toHaveBeenCalled();
  });

  it("does not restore a current approval resolved before finalization", async () => {
    const session = fakeSession([approvalEvent("approval-current")]);
    register(stored, session);
    let lookups = 0;
    mocks.getByRunId.mockImplementation(async () => {
      lookups += 1;
      if (lookups === 2) {
        stored = {
          ...stored,
          pendingApproval: null,
          resolvedApprovalIds: ["approval-current"],
          generation: stored.generation + 1,
        };
      }
      return stored;
    });

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({
      ok: true,
      session: { status: "idle", pendingApproval: null },
    });
  });

  it("allows a live approval to unblock an active follow-up", async () => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      yield approvalEvent("approval-live");
      await blocked;
      yield { type: "done" } as AgentHarnessEvent;
    });
    session.approve.mockImplementation(async () => unblock());
    register(stored, session);

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "needs permission",
      scope: ownerScope(),
    });
    await vi.waitFor(() => {
      expect((stored.pendingApproval as { id?: string })?.id).toBe(
        "approval-live",
      );
    });
    expect(stored.status).toBe("running");
    const resolution = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-live", approved: true },
      scope: ownerScope(),
    });

    expect(resolution.ok).toBe(true);
    await expect(followUp).resolves.toMatchObject({ ok: true });
    expect(stored.status).toBe("idle");
    expect(stored.pendingApproval).toBeNull();
  });

  it("marks a failed follow-up errored instead of leaving a running claim", async () => {
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      throw new Error("provider stream failed");
    });
    register(stored, session);

    await expect(
      sendAgentHarnessFollowUp({
        runId: stored.runId!,
        prompt: "try work",
        scope: ownerScope(),
      }),
    ).rejects.toThrow("provider stream failed");

    expect(stored.status).toBe("errored");
  });

  it("retries failed-claim cleanup after a same-claim generation conflict", async () => {
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      throw new Error("provider stream failed");
    });
    register(stored, session);
    mocks.updateIfFollowUpClaim.mockImplementationOnce(async () => {
      stored = {
        ...stored,
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      throw Object.assign(new Error("generation changed"), {
        name: "AgentHarnessSessionConflictError",
      });
    });

    await expect(
      sendAgentHarnessFollowUp({
        runId: stored.runId!,
        prompt: "continue",
        scope: ownerScope(),
      }),
    ).rejects.toThrow("provider stream failed");

    expect(stored.status).toBe("errored");
    expect(stored.followUpClaimId).toBeNull();
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("keeps the live session registered when error cleanup cannot persist", async () => {
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      throw new Error("provider stream failed");
    });
    register(stored, session);
    mocks.updateIfFollowUpClaim.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      sendAgentHarnessFollowUp({
        runId: stored.runId!,
        prompt: "continue",
        scope: ownerScope(),
      }),
    ).rejects.toThrow("Harness follow-up failed and cleanup was incomplete.");

    expect(stored.status).toBe("running");
    expect(stored.followUpClaimId).toBeTruthy();
    expect(session.stop).not.toHaveBeenCalled();
  });

  it("retries a transient follow-up claim read failure", async () => {
    let resume!: () => void;
    const blocked = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      await blocked;
      yield { type: "done" } as AgentHarnessEvent;
    });
    register(stored, session);
    mocks.getById.mockRejectedValueOnce(new Error("temporary database error"));

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    await vi.waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    });
    await vi.waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });
    resume();

    await expect(followUp).resolves.toMatchObject({ ok: true });
    expect(stored.status).toBe("idle");
  });

  it("errors the owned claim after repeated follow-up claim read failures", async () => {
    let resume!: () => void;
    const blocked = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const session = fakeSession();
    session.stop.mockImplementation(async () => resume());
    session.streamTurn.mockImplementation(async function* () {
      await blocked;
      yield { type: "done" } as AgentHarnessEvent;
    });
    register(stored, session);
    mocks.getById.mockRejectedValue(new Error("database unavailable"));

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({
      ok: false,
      session: { status: "errored", followUpClaimId: null },
    });
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("errors and stops its own claim after a finalization generation conflict", async () => {
    const session = fakeSession([{ type: "text-delta", text: "done" }]);
    register(stored, session);
    session.detach.mockImplementationOnce(async () => {
      stored = {
        ...stored,
        status: "running",
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      return { token: "next" };
    });

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "unavailable",
      session: { status: "errored", followUpClaimId: null },
    });
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("delivers error events before failing a follow-up", async () => {
    const event: AgentHarnessEvent = { type: "error", error: "model failed" };
    const session = fakeSession([event]);
    const onHarnessEvent = vi.fn();
    register(stored, session);

    await expect(
      sendAgentHarnessFollowUp({
        runId: stored.runId!,
        prompt: "continue",
        scope: ownerScope(),
        onHarnessEvent,
      }),
    ).rejects.toThrow("model failed");

    expect(onHarnessEvent).toHaveBeenCalledWith(event);
    expect(stored.status).toBe("errored");
  });

  it("does not finalize a newer follow-up claim after a generation conflict", async () => {
    const session = fakeSession([{ type: "text-delta", text: "done" }]);
    register(stored, session);
    session.detach.mockImplementationOnce(async () => {
      stored = {
        ...stored,
        status: "running",
        followUpClaimId: "newer-claim",
        generation: stored.generation + 1,
        pendingApproval: null,
        updatedAt: Date.now(),
      };
      return { token: "next" };
    });

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(stored.status).toBe("running");
    expect(stored.followUpClaimId).toBe("newer-claim");
    expect(session.stop).not.toHaveBeenCalled();
  });

  it("does not stop or overwrite a newer claim when a provider stream fails", async () => {
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      throw new Error("provider stream failed");
    });
    register(stored, session);
    mocks.updateIfFollowUpClaim.mockImplementationOnce(async () => {
      stored = {
        ...stored,
        status: "running",
        followUpClaimId: "newer-claim",
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      return null;
    });

    await expect(
      sendAgentHarnessFollowUp({
        runId: stored.runId!,
        prompt: "continue",
        scope: ownerScope(),
      }),
    ).rejects.toThrow("provider stream failed");

    expect(stored.status).toBe("running");
    expect(stored.followUpClaimId).toBe("newer-claim");
    expect(session.stop).not.toHaveBeenCalled();
  });

  it("commits a chained approval without a self-conflicting event write", async () => {
    stored.pendingApproval = approvalEvent("approval-first");
    const session = {
      ...fakeSession(),
      approve: undefined,
      continueTurn: vi.fn(async function* () {
        yield approvalEvent("approval-next");
      }),
    };
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-first", approved: true },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(stored.pendingApproval).toMatchObject({ id: "approval-next" });
    expect(stored.resolvedApprovalIds).toContain("approval-first");
  });

  it("does not report terminal sessions as running", async () => {
    stored.status = "errored";

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "try again",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(result.error).toContain("errored");
    expect(mocks.claimFollowUp).not.toHaveBeenCalled();
  });

  it("reports a terminal session from the active-follow-up fast path", async () => {
    let finishStream!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      await blocked;
      yield { type: "done" } as AgentHarnessEvent;
    });
    register(stored, session);

    const first = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "first",
      scope: ownerScope(),
    });
    await vi.waitFor(() => expect(stored.followUpClaimId).toBeTruthy());
    stored = {
      ...stored,
      status: "errored",
      followUpClaimId: null,
      generation: stored.generation + 1,
      updatedAt: Date.now(),
    };

    const second = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "second",
      scope: ownerScope(),
    });
    expect(second.error).toContain("errored");

    finishStream();
    await expect(first).resolves.toMatchObject({ ok: false });
  });

  it("aborts a follow-up when another worker stops its persisted session", async () => {
    let observedSignal: AbortSignal | undefined;
    let releaseStream: (() => void) | undefined;
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* (input: {
      abortSignal?: AbortSignal;
    }) {
      observedSignal = input.abortSignal;
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
      yield { type: "done" };
    });
    session.stop.mockImplementation(async () => releaseStream?.());
    register(stored, session);

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "long running work",
      scope: ownerScope(),
    });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    stored = {
      ...stored,
      status: "stopped",
      followUpClaimId: null,
      generation: stored.generation + 1,
      stoppedAt: Date.now(),
      updatedAt: Date.now(),
    };

    await expect(followUp).resolves.toMatchObject({
      ok: false,
      errorCode: "unavailable",
      session: { status: "stopped" },
    });
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toMatchObject({
      name: "AgentHarnessSessionConflictError",
    });
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("rehydrates a resumable adapter for a follow-up after restart", async () => {
    stored.resumeState = { token: "saved" };
    const session = fakeSession([{ type: "done" }]);
    const adapter = fakeAdapter(session);
    mocks.resolveAdapter.mockReturnValue(adapter);

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "resume",
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(result.rehydrated).toBe(true);
    expect(adapter.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: stored.id,
        resumeState: { token: "saved" },
        ownerEmail: "owner@example.com",
      }),
    );
  });

  it("reports approval unavailable when the live callback was lost", async () => {
    stored.pendingApproval = approvalEvent("approval-lost");
    stored.resumeState = { token: "saved" };

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-lost", approved: true },
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(mocks.resolveAdapter).not.toHaveBeenCalled();
  });

  it("fails closed on owner mismatch", async () => {
    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "no access",
      scope: { ownerEmail: "mallory@example.com" },
    });

    expect(result).toMatchObject({ ok: false, errorCode: "owner_mismatch" });
  });

  it("fails closed on organization mismatch for approvals", async () => {
    stored.pendingApproval = approvalEvent("approval-org-mismatch");
    const session = fakeSession();
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-org-mismatch", approved: true },
      scope: { ownerEmail: stored.ownerEmail!, orgId: "org-2" },
    });

    expect(result).toMatchObject({ ok: false, errorCode: "owner_mismatch" });
    expect(session.approve).not.toHaveBeenCalled();
  });

  it("treats a repeated resolution for the same approval as idempotent", async () => {
    stored.pendingApproval = null;
    stored.resolvedApprovalIds = ["approval-1"];

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-1", approved: true },
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: true, idempotent: true });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("stops and removes a live session", async () => {
    const session = fakeSession();
    register(stored, session);

    await expect(
      stopLiveAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
      }),
    ).resolves.toBe(true);
    await expect(
      stopLiveAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
      }),
    ).resolves.toBe(false);
    expect(session.stop).toHaveBeenCalledOnce();
  });
});

function storedSession(id: string, runId: string): StoredAgentHarnessSession {
  return {
    id,
    runId,
    harnessName: "fake",
    threadId: "thread-1",
    providerSessionId: "native-1",
    status: "idle",
    followUpClaimId: null,
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    generation: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resolvedApprovalIds: [],
  };
}

function ownerScope() {
  return { ownerEmail: "owner@example.com", orgId: "org-1" };
}

function approvalEvent(id: string): AgentHarnessEvent {
  return { type: "approval-request", id, message: "Allow tool?" };
}

function register(
  stored: StoredAgentHarnessSession,
  session: AgentHarnessSession,
): void {
  registerLiveAgentHarnessSession({
    sessionId: stored.id,
    adapter: fakeAdapter(session),
    session,
    ownerEmail: stored.ownerEmail,
    orgId: stored.orgId,
  });
}

function fakeAdapter(session: AgentHarnessSession): AgentHarnessAdapter {
  return {
    name: "fake",
    label: "Fake",
    description: "Fake adapter",
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

function fakeSession(events: AgentHarnessEvent[] = []): AgentHarnessSession & {
  streamTurn: ReturnType<typeof vi.fn>;
  approve: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    id: `native-${Math.random()}`,
    streamTurn: vi.fn(async function* () {
      for (const event of events) yield event;
    }),
    approve: vi.fn(async () => undefined),
    detach: vi.fn(async () => ({ token: "next" })),
    stop: vi.fn(async () => undefined),
  };
}
