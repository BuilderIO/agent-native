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
  admitFollowUpDispatch: vi.fn(),
  markStopped: vi.fn(),
  markStoppedIfUnclaimed: vi.fn(),
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
  admitAgentHarnessSessionFollowUpDispatch: mocks.admitFollowUpDispatch,
  markAgentHarnessSessionStopped: mocks.markStopped,
  markAgentHarnessSessionStoppedIfUnclaimed: mocks.markStoppedIfUnclaimed,
}));

vi.mock("./registry.js", () => ({
  resolveAgentHarness: mocks.resolveAdapter,
}));

const {
  registerLiveAgentHarnessSession,
  releaseLiveAgentHarnessSession,
  resolveAgentHarnessApproval,
  sendAgentHarnessFollowUp,
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
    mocks.admitFollowUpDispatch.mockImplementation(
      async (_id, expectedGeneration, claimId) => {
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
        return stored;
      },
    );
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
          stoppedAt: Date.now(),
        });
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
    mocks.updateAtGeneration.mockImplementationOnce(async () => {
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
    });

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-racing-write", approved: true },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.approve).toHaveBeenCalledOnce();
    expect(mocks.updateAtGeneration).toHaveBeenCalledTimes(2);
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
    mocks.updateAtGeneration.mockImplementationOnce(async () => {
      stored = {
        ...stored,
        pendingApproval: approvalEvent("approval-next"),
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      throw Object.assign(new Error("generation changed"), {
        name: "AgentHarnessSessionConflictError",
      });
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
    mocks.admitFollowUpDispatch.mockImplementationOnce(async () => {
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

  it("does not stop an idle session after another process advances its generation", async () => {
    const session = fakeSession();
    register(stored, session);
    stored = { ...stored, generation: stored.generation + 1 };

    const removed = await sweepExpiredAgentHarnessSessions(
      Date.now() + 25 * 60 * 60 * 1_000,
    );

    expect(removed).toBe(0);
    expect(mocks.markStoppedIfUnclaimed).toHaveBeenCalledWith(
      stored.id,
      "idle",
      0,
      "stopped",
    );
    expect(session.stop).not.toHaveBeenCalled();
    expect(stored.status).toBe("idle");
    await stopLiveAgentHarnessSession({
      sessionId: stored.id,
      scope: ownerScope(),
    });
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
    ).resolves.toBe(0);
    expect(session.stop).toHaveBeenCalledOnce();

    await expect(
      sweepExpiredAgentHarnessSessions(Date.now() + 25 * 60 * 60 * 1_000),
    ).resolves.toBe(1);
    expect(session.stop).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch a follow-up when stop wins durable admission", async () => {
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
    mocks.admitFollowUpDispatch.mockImplementationOnce(
      async (_id, expectedGeneration, claimId) => {
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
        return stored;
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
