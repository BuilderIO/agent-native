import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  startFollowUpDispatch: vi.fn(),
  markStopped: vi.fn(),
  markStoppedIfUnclaimed: vi.fn(),
  startApprovalDispatch: vi.fn(),
  startExpiryCleanup: vi.fn(),
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
  startAgentHarnessSessionFollowUpDispatch: mocks.startFollowUpDispatch,
  markAgentHarnessSessionStopped: mocks.markStopped,
  markAgentHarnessSessionStoppedIfUnclaimed: mocks.markStoppedIfUnclaimed,
  startAgentHarnessSessionApprovalDispatch: mocks.startApprovalDispatch,
  startAgentHarnessSessionExpiryCleanup: mocks.startExpiryCleanup,
}));

vi.mock("./registry.js", () => ({
  resolveAgentHarness: mocks.resolveAdapter,
}));

const {
  registerLiveAgentHarnessSession,
  releaseLiveAgentHarnessSession,
  resolveAgentHarnessApproval,
  sendAgentHarnessFollowUp,
  stopAndPersistAgentHarnessSession,
  stopLiveAgentHarnessSession,
  sweepExpiredAgentHarnessSessions,
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
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const current = stored;
          if (
            current.status !== "running" ||
            current.followUpClaimId !== expectedClaimId
          ) {
            return null;
          }
          const update =
            typeof patch === "function" ? await patch(current) : patch;
          if (stored.generation !== current.generation) continue;
          return mocks.update(_id, update);
        }
        return null;
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
    mocks.startFollowUpDispatch.mockImplementation(
      async (_id, expectedGeneration, claimId, start) => {
        if (
          stored.status !== "running" ||
          stored.followUpClaimId !== claimId ||
          stored.generation !== expectedGeneration
        ) {
          return null;
        }
        stored = {
          ...stored,
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        const started = start();
        return { session: stored, started };
      },
    );
    mocks.markStopped.mockImplementation(async (_id, status) => {
      stored = {
        ...stored,
        status,
        pendingApproval: null,
        followUpClaimId: null,
        approvalResolutionId: null,
        stoppedAt: Date.now(),
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      return stored;
    });
    mocks.markStoppedIfUnclaimed.mockImplementation(
      async (_id, expectedStatus, expectedGeneration, status) => {
        if (
          stored.status !== expectedStatus ||
          stored.generation !== expectedGeneration ||
          stored.followUpClaimId != null
        ) {
          return null;
        }
        return mocks.update("session", {
          status,
          pendingApproval: null,
          followUpClaimId: null,
          approvalResolutionId: null,
          stoppedAt: Date.now(),
        });
      },
    );
    mocks.startApprovalDispatch.mockImplementation(
      async (_id, expectedStatus, expectedGeneration, approvalId, start) => {
        if (
          stored.status !== expectedStatus ||
          stored.generation !== expectedGeneration ||
          stored.approvalResolutionId !== approvalId
        ) {
          return null;
        }
        stored = {
          ...stored,
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return { session: stored, started: start() };
      },
    );
    mocks.startExpiryCleanup.mockImplementation(
      async (_id, expectedStatus, expectedGeneration, start) => {
        if (
          stored.status !== expectedStatus ||
          stored.generation !== expectedGeneration ||
          stored.followUpClaimId != null
        ) {
          return null;
        }
        stored = {
          ...stored,
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return { session: stored, started: start() };
      },
    );
  });

  afterEach(() => {
    releaseLiveAgentHarnessSession(stored.id);
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

  it("retries approval persistence after a concurrent session update", async () => {
    const session = fakeSession();
    stored.pendingApproval = approvalEvent("approval-racing-write");
    register(stored, session);
    const updateAtGeneration =
      mocks.updateAtGeneration.getMockImplementation()!;
    let attempts = 0;
    mocks.updateAtGeneration.mockImplementation(async (...args) => {
      attempts += 1;
      if (attempts === 2) {
        stored = {
          ...stored,
          resumeState: { token: "concurrent" },
          resolvedApprovalIds: ["approval-other"],
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        throw Object.assign(new Error("generation changed"), {
          name: "AgentHarnessSessionConflictError",
        });
      }
      return updateAtGeneration(...args);
    });

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-racing-write", approved: true },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.approve).toHaveBeenCalledOnce();
    expect(mocks.updateAtGeneration).toHaveBeenCalledTimes(3);
    expect(stored.pendingApproval).toBeNull();
    expect(stored.resolvedApprovalIds).toEqual([
      "approval-other",
      "approval-racing-write",
    ]);
    expect(stored.resumeState).toEqual({ token: "concurrent" });
  });

  it("preserves a newer approval while recording the resolved approval", async () => {
    const session = fakeSession();
    stored.pendingApproval = approvalEvent("approval-racing-write");
    register(stored, session);
    const updateAtGeneration =
      mocks.updateAtGeneration.getMockImplementation()!;
    let attempts = 0;
    mocks.updateAtGeneration.mockImplementation(async (...args) => {
      attempts += 1;
      if (attempts === 2) {
        stored = {
          ...stored,
          pendingApproval: approvalEvent("approval-next"),
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        throw Object.assign(new Error("generation changed"), {
          name: "AgentHarnessSessionConflictError",
        });
      }
      return updateAtGeneration(...args);
    });

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-racing-write", approved: true },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.approve).toHaveBeenCalledOnce();
    expect(stored.pendingApproval).toMatchObject({ id: "approval-next" });
    expect(stored.resolvedApprovalIds).toContain("approval-racing-write");
  });

  it("does not replay an approval when completion persistence fails", async () => {
    const session = fakeSession();
    const approvalId = "approval-persistence-failure";
    stored.pendingApproval = approvalEvent(approvalId);
    register(stored, session);
    session.approve.mockImplementation(async () => {
      expect(stored.approvalResolutionId).toBe(approvalId);
    });
    const updateAtGeneration =
      mocks.updateAtGeneration.getMockImplementation()!;
    let attempts = 0;
    mocks.updateAtGeneration.mockImplementation(async (...args) => {
      attempts += 1;
      if (attempts > 1) {
        throw Object.assign(new Error("database write failed"), {
          name: "AgentHarnessSessionConflictError",
        });
      }
      return updateAtGeneration(...args);
    });

    const first = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });
    const retry = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });

    expect(first).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(retry).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(session.approve).toHaveBeenCalledOnce();
    expect(stored).toMatchObject({
      approvalResolutionId: approvalId,
      pendingApproval: { id: approvalId },
    });

    await expect(
      sweepExpiredAgentHarnessSessions(Date.now() + 25 * 60 * 60 * 1_000),
    ).resolves.toBe(1);
    expect(session.stop).toHaveBeenCalledOnce();
    expect(stored.approvalResolutionId).toBeNull();
  });

  it("persists detached state from the reserved approval generation", async () => {
    const { approve: _approve, ...baseSession } = fakeSession();
    const session = {
      ...baseSession,
      continueTurn: vi.fn(async function* () {
        yield { type: "done" } as AgentHarnessEvent;
      }),
    };
    const approvalId = "approval-detached-resume-state";
    stored.pendingApproval = approvalEvent(approvalId);
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.detach).toHaveBeenCalledOnce();
    expect(stored.resumeState).toEqual({ token: "next" });
  });

  it("persists detached state after a follow-up claim clears during approval", async () => {
    let finishContinuation!: () => void;
    let continuationStarted!: () => void;
    const continuationGate = new Promise<void>((resolve) => {
      finishContinuation = resolve;
    });
    const started = new Promise<void>((resolve) => {
      continuationStarted = resolve;
    });
    const { approve: _approve, ...baseSession } = fakeSession();
    const session = {
      ...baseSession,
      continueTurn: vi.fn(async function* () {
        continuationStarted();
        await continuationGate;
        yield { type: "done" } as AgentHarnessEvent;
      }),
    };
    session.detach.mockResolvedValue({ token: "after-approval" });
    const approvalId = "approval-active-follow-up";
    stored = {
      ...stored,
      status: "running",
      followUpClaimId: "active-follow-up",
      pendingApproval: approvalEvent(approvalId),
    };
    register(stored, session);

    const resolution = resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });
    await started;
    stored = {
      ...stored,
      status: "idle",
      followUpClaimId: null,
      generation: stored.generation + 1,
      resumeState: { token: "stale" },
    };

    finishContinuation();
    await expect(resolution).resolves.toMatchObject({ ok: true });

    expect(session.detach).toHaveBeenCalledOnce();
    expect(stored.resumeState).toEqual({ token: "after-approval" });
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

  it("does not start provider work after its follow-up claim is lost", async () => {
    const session = fakeSession([{ type: "done" }]);
    register(stored, session);
    mocks.startFollowUpDispatch.mockImplementationOnce(async () => {
      stored = {
        ...stored,
        status: "stopped",
        followUpClaimId: null,
        generation: stored.generation + 1,
      };
      return null;
    });

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(session.streamTurn).not.toHaveBeenCalled();
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("retries releasing its claim after a transient resume failure", async () => {
    stored.resumeState = { token: "resume" };
    const session = fakeSession();
    const adapter = fakeAdapter(session);
    adapter.createSession.mockRejectedValueOnce(
      new Error("provider could not resume"),
    );
    mocks.resolveAdapter.mockReturnValue(adapter);
    mocks.updateIfFollowUpClaim.mockImplementationOnce(async () => {
      throw new Error("temporary database write failure");
    });

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "unavailable",
      session: { status: "idle", followUpClaimId: null },
    });
    expect(mocks.updateIfFollowUpClaim).toHaveBeenCalledTimes(2);
  });

  it("does not let an expired process stop a newer follow-up claim", async () => {
    const session = fakeSession();
    register(stored, session);
    stored = {
      ...stored,
      status: "running",
      followUpClaimId: "newer-worker-claim",
      generation: stored.generation + 1,
    };

    const removed = await sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );

    expect(removed).toBe(0);
    expect(session.stop).not.toHaveBeenCalled();
    expect(mocks.markStoppedIfUnclaimed).not.toHaveBeenCalled();
    expect(stored).toMatchObject({
      status: "running",
      followUpClaimId: "newer-worker-claim",
    });
    await stopLiveAgentHarnessSession({
      sessionId: stored.id,
      scope: ownerScope(),
    });
  });

  it("keeps an expired session registered while approval resolution is active", async () => {
    const session = fakeSession();
    const approvalId = "approval-expiry-in-progress";
    stored.pendingApproval = approvalEvent(approvalId);
    let finishApproval!: () => void;
    let approvalStarted!: () => void;
    const approvalGate = new Promise<void>((resolve) => {
      finishApproval = resolve;
    });
    const started = new Promise<void>((resolve) => {
      approvalStarted = resolve;
    });
    session.approve.mockImplementation(async () => {
      approvalStarted();
      await approvalGate;
    });
    register(stored, session);

    const resolution = resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });
    await started;

    await expect(
      sweepExpiredAgentHarnessSessions(Date.now() + 25 * 60 * 60 * 1_000),
    ).resolves.toBe(0);
    expect(session.stop).not.toHaveBeenCalled();
    expect(mocks.markStoppedIfUnclaimed).not.toHaveBeenCalled();

    finishApproval();
    await expect(resolution).resolves.toMatchObject({ ok: true });
  });

  it("detaches an expired local session after a remote generation advance", async () => {
    const session = fakeSession();
    register(stored, session);
    stored = { ...stored, generation: stored.generation + 1 };

    const removed = await sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );

    expect(removed).toBe(1);
    expect(mocks.markStoppedIfUnclaimed).not.toHaveBeenCalled();
    expect(session.stop).not.toHaveBeenCalled();
    expect(session.detach).toHaveBeenCalledOnce();
    expect(stored.status).toBe("idle");
    await expect(
      stopLiveAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
      }),
    ).resolves.toBe(false);
  });

  it("does not start approval while expiry is detaching a stale live session", async () => {
    const approvalId = "approval-expiry-detach-race";
    const session = fakeSession();
    stored.pendingApproval = approvalEvent(approvalId);
    register(stored, session);
    stored = { ...stored, generation: stored.generation + 1 };

    let detachStarted!: () => void;
    let finishDetach!: () => void;
    const started = new Promise<void>((resolve) => {
      detachStarted = resolve;
    });
    const detachGate = new Promise<void>((resolve) => {
      finishDetach = resolve;
    });
    session.detach.mockImplementation(async () => {
      detachStarted();
      await detachGate;
      return { token: "detached" };
    });

    const cleanup = sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );
    await started;

    await expect(
      resolveAgentHarnessApproval({
        runId: stored.runId!,
        approval: { id: approvalId, approved: true },
        scope: ownerScope(),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(session.approve).not.toHaveBeenCalled();
    expect(mocks.updateAtGeneration).not.toHaveBeenCalled();

    finishDetach();
    await expect(cleanup).resolves.toBe(1);
  });

  it("does not reuse a stale live session for a follow-up during expiry detach", async () => {
    const session = fakeSession();
    register(stored, session);
    stored = { ...stored, generation: stored.generation + 1 };

    let detachStarted!: () => void;
    let finishDetach!: () => void;
    const started = new Promise<void>((resolve) => {
      detachStarted = resolve;
    });
    const detachGate = new Promise<void>((resolve) => {
      finishDetach = resolve;
    });
    session.detach.mockImplementation(async () => {
      detachStarted();
      await detachGate;
      return { token: "detached" };
    });

    const cleanup = sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );
    await started;

    await expect(
      sendAgentHarnessFollowUp({
        runId: stored.runId!,
        prompt: "continue",
        scope: ownerScope(),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(session.streamTurn).not.toHaveBeenCalled();

    finishDetach();
    await expect(cleanup).resolves.toBe(1);
  });

  it("releases an active stale entry without stopping it when detach is unavailable", async () => {
    const session = fakeSession();
    Object.defineProperty(session, "detach", { value: undefined });
    register(stored, session);
    stored = { ...stored, generation: stored.generation + 1 };

    await expect(
      sweepExpiredAgentHarnessSessions(Date.now() + 25 * 60 * 60 * 1_000),
    ).resolves.toBe(1);

    expect(session.stop).not.toHaveBeenCalled();
    await expect(
      stopLiveAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
      }),
    ).resolves.toBe(false);
    expect(stored.status).toBe("idle");
  });

  it("detaches its stale entry after a generation race during expiry cleanup", async () => {
    const session = fakeSession();
    register(stored, session);
    let raced = false;
    mocks.markStoppedIfUnclaimed.mockImplementationOnce(async () => {
      raced = true;
      stored = { ...stored, generation: stored.generation + 1 };
      return null;
    });
    const removed = await sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );

    expect(raced).toBe(true);
    expect(mocks.markStoppedIfUnclaimed).toHaveBeenCalledOnce();
    expect(removed).toBe(1);
    expect(session.stop).not.toHaveBeenCalled();
    expect(session.detach).toHaveBeenCalledOnce();
  });

  it("persists a stop before tearing down its provider session", async () => {
    const session = fakeSession();
    register(stored, session);

    await expect(
      stopAndPersistAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
        status: "stopped",
      }),
    ).resolves.toMatchObject({ status: "stopped" });

    expect(mocks.markStopped).toHaveBeenCalledWith(stored.id, "stopped");
    expect(mocks.markStopped.mock.invocationCallOrder[0]).toBeLessThan(
      session.stop.mock.invocationCallOrder[0],
    );
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("tears down its provider session when stop persistence fails", async () => {
    const session = fakeSession();
    const persistError = new Error("database stop failed");
    register(stored, session);
    mocks.markStopped.mockRejectedValueOnce(persistError);

    await expect(
      stopAndPersistAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
        status: "stopped",
      }),
    ).rejects.toBe(persistError);

    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("retries a present-row teardown failure with the refreshed generation", async () => {
    const session = fakeSession();
    session.stop.mockRejectedValueOnce(new Error("provider stop failed"));
    register(stored, session);

    await expect(
      stopAndPersistAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
        status: "stopped",
      }),
    ).rejects.toThrow("provider stop failed");
    expect(stored.status).toBe("errored");

    const erroredGeneration = stored.generation;
    const removed = await sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );

    expect(removed).toBe(1);
    expect(mocks.markStoppedIfUnclaimed).toHaveBeenCalledWith(
      stored.id,
      "errored",
      erroredGeneration,
      "stopped",
    );
    expect(session.stop).toHaveBeenCalledTimes(2);
  });

  it("refreshes the owned generation after a local approval update before expiry cleanup", async () => {
    const session = fakeSession();
    stored.pendingApproval = approvalEvent("approval-expiry");
    register(stored, session);

    await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-expiry", approved: true },
      scope: ownerScope(),
    });
    const ownedGeneration = stored.generation;
    const removed = await sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );

    expect(removed).toBe(1);
    expect(mocks.markStoppedIfUnclaimed).toHaveBeenCalledWith(
      stored.id,
      "idle",
      ownedGeneration,
      "stopped",
    );
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("keeps a missing-row native session registered until teardown succeeds", async () => {
    const session = fakeSession();
    session.stop.mockRejectedValueOnce(new Error("provider stop failed"));
    register(stored, session);
    mocks.getById.mockResolvedValue(null);

    await expect(
      sweepExpiredAgentHarnessSessions(Date.now() + 25 * 60 * 60 * 1_000),
    ).rejects.toThrow("Expired harness session cleanup was incomplete.");
    expect(session.stop).toHaveBeenCalledOnce();

    await expect(
      sweepExpiredAgentHarnessSessions(Date.now() + 25 * 60 * 60 * 1_000),
    ).resolves.toBe(1);
    expect(session.stop).toHaveBeenCalledTimes(2);
  });

  it("surfaces teardown and error-state persistence failures", async () => {
    const session = fakeSession();
    const teardownError = new Error("provider stop failed");
    const persistenceError = new Error("database update failed");
    session.stop.mockRejectedValueOnce(teardownError);
    register(stored, session);
    const markStoppedIfUnclaimed =
      mocks.markStoppedIfUnclaimed.getMockImplementation()!;
    mocks.markStoppedIfUnclaimed
      .mockImplementationOnce((...args) => markStoppedIfUnclaimed(...args))
      .mockRejectedValueOnce(persistenceError);

    await expect(
      sweepExpiredAgentHarnessSessions(Date.now() + 25 * 60 * 60 * 1_000),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          errors: [teardownError, persistenceError],
        }),
      ],
    });
    expect(stored.status).toBe("stopped");
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("does not dispatch a follow-up when stop wins the durable row lock", async () => {
    const session = fakeSession();
    register(stored, session);
    let reachAdmission!: () => void;
    let releaseAdmission!: () => void;
    const admissionReached = new Promise<void>((resolve) => {
      reachAdmission = resolve;
    });
    const admissionGate = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    mocks.startFollowUpDispatch.mockImplementationOnce(
      async (_id, expectedGeneration, claimId, start) => {
        reachAdmission();
        await admissionGate;
        if (
          stored.status !== "running" ||
          stored.followUpClaimId !== claimId ||
          stored.generation !== expectedGeneration
        ) {
          return null;
        }
        stored = {
          ...stored,
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return { session: stored, started: start() };
      },
    );

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });
    await admissionReached;
    stored = {
      ...stored,
      status: "stopped",
      followUpClaimId: null,
      generation: stored.generation + 1,
    };
    releaseAdmission();
    const result = await followUp;

    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(session.streamTurn).not.toHaveBeenCalled();
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("retains an expired claimed session so a failed follow-up can stop it", async () => {
    let startStream!: () => void;
    let failStream!: () => void;
    const streamStarted = new Promise<void>((resolve) => {
      startStream = resolve;
    });
    const shouldFail = new Promise<void>((resolve) => {
      failStream = resolve;
    });
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      startStream();
      await shouldFail;
      throw new Error("provider stream failed");
    });
    register(stored, session);

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });
    await streamStarted;

    const removed = await sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );

    expect(removed).toBe(0);
    expect(session.stop).not.toHaveBeenCalled();
    expect(stored.followUpClaimId).toBeTruthy();

    failStream();
    await expect(followUp).rejects.toThrow("provider stream failed");

    expect(stored).toMatchObject({ status: "errored", followUpClaimId: null });
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("preserves a chained approval already persisted during the follow-up", async () => {
    const session = fakeSession([{ type: "done" }]);
    register(stored, session);
    mocks.updateIfFollowUpClaim.mockImplementationOnce(
      async (_id, expectedClaimId, patch) => {
        stored = {
          ...stored,
          status: "running",
          followUpClaimId: expectedClaimId,
          pendingApproval: approvalEvent("approval-chained"),
          generation: stored.generation + 1,
        };
        if (typeof patch === "function") {
          return mocks.update(_id, await patch(stored));
        }
        return mocks.update(_id, patch);
      },
    );

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
    mocks.updateIfFollowUpClaim.mockImplementation(
      async (_id, expectedClaimId, patch) => {
        if (typeof patch !== "function") {
          const updated = await mocks.update(_id, patch);
          stored = {
            ...stored,
            pendingApproval: null,
            resolvedApprovalIds: ["approval-current"],
            generation: stored.generation + 1,
          };
          return updated;
        }
        if (
          stored.status !== "running" ||
          stored.followUpClaimId !== expectedClaimId
        ) {
          return null;
        }
        return mocks.update(_id, await patch(stored));
      },
    );

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

  it("keeps a live session while a follow-up claim owns approval continuation", async () => {
    const { approve: _approve, ...withoutApproval } = fakeSession();
    const session = {
      ...withoutApproval,
      continueTurn: vi.fn(async function* () {
        yield { type: "done" } as AgentHarnessEvent;
      }),
    };
    stored = {
      ...stored,
      status: "running",
      followUpClaimId: "active-follow-up",
      pendingApproval: approvalEvent("approval-active-follow-up"),
    };
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-active-follow-up", approved: true },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.continueTurn).toHaveBeenCalledOnce();
    expect(session.detach).not.toHaveBeenCalled();
    await expect(
      stopLiveAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
      }),
    ).resolves.toBe(true);
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("reconciles a concurrent approval write before finalizing its claim", async () => {
    const approval = approvalEvent("approval-racing-finalization");
    const session = fakeSession([approval]);
    register(stored, session);
    mocks.updateIfFollowUpClaim.mockImplementation(
      async (_id, expectedClaimId, patch) => {
        if (
          stored.status !== "running" ||
          stored.followUpClaimId !== expectedClaimId
        ) {
          return null;
        }
        if (typeof patch !== "function") return mocks.update(_id, patch);

        await patch(stored);
        stored = {
          ...stored,
          pendingApproval: null,
          resolvedApprovalIds: [approval.id],
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return mocks.update(_id, await patch(stored));
      },
    );

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({
      ok: true,
      session: {
        status: "idle",
        pendingApproval: null,
        resolvedApprovalIds: [approval.id],
      },
    });
    expect(session.detach).toHaveBeenCalledOnce();
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
    mocks.getById
      .mockImplementationOnce(async () => stored)
      .mockRejectedValueOnce(new Error("temporary database error"));

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    await vi.waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(3), {
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
    mocks.getById
      .mockImplementationOnce(async () => stored)
      .mockRejectedValue(new Error("database unavailable"));

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

  it("finalizes its claim after a same-claim generation conflict", async () => {
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
      ok: true,
      session: { status: "idle", followUpClaimId: null },
    });
    expect(session.stop).not.toHaveBeenCalled();
  });

  it("retries finalization after the claim store exhausts its conflict retries", async () => {
    const session = fakeSession([{ type: "text-delta", text: "done" }]);
    register(stored, session);
    const updateIfClaim = mocks.updateIfFollowUpClaim.getMockImplementation()!;
    let conflicted = false;
    mocks.updateIfFollowUpClaim.mockImplementation(
      async (id, claimId, patch) => {
        if (typeof patch === "function" && !conflicted) {
          conflicted = true;
          stored = {
            ...stored,
            generation: stored.generation + 1,
            updatedAt: Date.now(),
          };
          throw Object.assign(
            new Error("Harness session changed concurrently."),
            { name: "AgentHarnessSessionConflictError" },
          );
        }
        return updateIfClaim!(id, claimId, patch);
      },
    );

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(conflicted).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      session: { status: "idle", followUpClaimId: null },
    });
    expect(mocks.updateIfFollowUpClaim).toHaveBeenCalledTimes(2);
    expect(session.stop).not.toHaveBeenCalled();
  });

  it("fails and cleans up after exhausting follow-up finalization retries", async () => {
    const session = fakeSession([{ type: "text-delta", text: "done" }]);
    register(stored, session);
    const updateIfClaim = mocks.updateIfFollowUpClaim.getMockImplementation()!;
    let finalizationAttempts = 0;
    mocks.updateIfFollowUpClaim.mockImplementation(
      async (id, claimId, patch) => {
        if (typeof patch === "function") {
          finalizationAttempts += 1;
          stored = {
            ...stored,
            generation: stored.generation + 1,
            updatedAt: Date.now(),
          };
          throw Object.assign(
            new Error("Harness session changed concurrently."),
            { name: "AgentHarnessSessionConflictError" },
          );
        }
        return updateIfClaim!(id, claimId, patch);
      },
    );

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(finalizationAttempts).toBe(3);
    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(stored).toMatchObject({ status: "errored", followUpClaimId: null });
    expect(session.stop).toHaveBeenCalledOnce();
  });

  it("delivers error events before failing a follow-up", async () => {
    const event: AgentHarnessEvent = { type: "error", error: "model failed" };
    const session = fakeSession();
    let iteratorClosed = false;
    session.streamTurn.mockImplementation(async function* () {
      try {
        yield event;
      } finally {
        iteratorClosed = true;
      }
    });
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
    expect(iteratorClosed).toBe(true);
    expect(stored.status).toBe("errored");
  });

  it("handles a rejected first provider read while dispatch commits", async () => {
    const session = fakeSession();
    const firstReadError = new Error("provider read failed");
    const iterator: AsyncIterator<AgentHarnessEvent> = {
      next: vi.fn().mockRejectedValue(firstReadError),
      return: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    session.streamTurn.mockReturnValue({
      [Symbol.asyncIterator]: () => iterator,
    });
    const dispatch = mocks.startFollowUpDispatch.getMockImplementation()!;
    mocks.startFollowUpDispatch.mockImplementationOnce(async (...args) => {
      const started = await dispatch(...args);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return started;
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) =>
      unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);
    register(stored, session);

    try {
      await expect(
        sendAgentHarnessFollowUp({
          runId: stored.runId!,
          prompt: "continue",
          scope: ownerScope(),
        }),
      ).rejects.toBe(firstReadError);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandledRejections).toEqual([]);
      expect(session.stop).toHaveBeenCalledOnce();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
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

  it("persists a chained approval before emitting it", async () => {
    stored.pendingApproval = approvalEvent("approval-first");
    stored.status = "running";
    const session = {
      ...fakeSession(),
      approve: undefined,
      continueTurn: vi.fn(async function* () {
        stored = {
          ...stored,
          status: "idle",
          generation: stored.generation + 1,
        };
        yield approvalEvent("approval-next");
      }),
    };
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-first", approved: true },
      scope: ownerScope(),
      onHarnessEvent: (event) => {
        if (event.type === "approval-request") {
          expect(stored.pendingApproval).toMatchObject({ id: event.id });
        }
      },
    });

    expect(result.ok).toBe(true);
    expect(stored.pendingApproval).toMatchObject({ id: "approval-next" });
    expect(stored.resolvedApprovalIds).toContain("approval-first");
  });

  it("detaches after an approval continuation that overlaps follow-up completion", async () => {
    let finishApproval!: () => void;
    let continueStarted!: () => void;
    let finishFollowUp!: () => void;
    let followUpDoneEvent!: () => void;
    let finalizationStarted!: () => void;
    const order: string[] = [];
    const approvalGate = new Promise<void>((resolve) => {
      finishApproval = resolve;
    });
    const approvalStarted = new Promise<void>((resolve) => {
      continueStarted = resolve;
    });
    const followUpGate = new Promise<void>((resolve) => {
      finishFollowUp = resolve;
    });
    const doneEvent = new Promise<void>((resolve) => {
      followUpDoneEvent = resolve;
    });
    const finalizationAttempt = new Promise<void>((resolve) => {
      finalizationStarted = resolve;
    });
    const { approve: _approve, ...baseSession } = fakeSession();
    const session = {
      ...baseSession,
      continueTurn: vi.fn(async function* () {
        continueStarted();
        await approvalGate;
        order.push("continue");
        yield { type: "done" } as AgentHarnessEvent;
      }),
    };
    session.detach.mockImplementation(async () => {
      order.push("detach");
      return { token: "after-approval" };
    });
    session.streamTurn.mockImplementation(async function* () {
      yield approvalEvent("approval-during-follow-up");
      await followUpGate;
      yield { type: "done" } as AgentHarnessEvent;
    });
    register(stored, session);
    const updateIfClaim = mocks.updateIfFollowUpClaim.getMockImplementation()!;
    mocks.updateIfFollowUpClaim.mockImplementation(
      async (id, claimId, patch) => {
        if (typeof patch === "function") finalizationStarted();
        return updateIfClaim!(id, claimId, patch);
      },
    );

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
      onHarnessEvent: (event) => {
        if (event.type === "done") followUpDoneEvent();
      },
    });
    await vi.waitFor(() => {
      expect(stored.pendingApproval).toMatchObject({
        id: "approval-during-follow-up",
      });
    });

    const resolution = resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-during-follow-up", approved: true },
      scope: ownerScope(),
    });
    await approvalStarted;
    finishFollowUp();
    await doneEvent;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(session.detach).not.toHaveBeenCalled();

    finishApproval();
    await expect(resolution).resolves.toMatchObject({ ok: true });
    await finalizationAttempt;
    await expect(followUp).resolves.toMatchObject({
      ok: true,
      session: { status: "idle", resumeState: { token: "after-approval" } },
    });
    expect(
      mocks.updateIfFollowUpClaim.mock.calls.some((call) => call[3] === true),
    ).toBe(true);
    expect(order).toEqual(["continue", "detach"]);
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
    approvalResolutionId: null,
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
    generation: stored.generation,
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
