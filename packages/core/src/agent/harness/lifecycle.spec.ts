import { performance } from "node:perf_hooks";

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
  failFollowUp: vi.fn(),
  failApprovalResolution: vi.fn(),
  releaseApprovalBeforeDispatch: vi.fn(),
  updateAtGeneration: vi.fn(),
  claimFollowUp: vi.fn(),
  claimApprovalResolution: vi.fn(),
  renewApprovalResolutionClaim: vi.fn(),
  finalizeApprovalResolution: vi.fn(),
  markFollowUpDispatched: vi.fn(),
  renewFollowUpClaim: vi.fn(),
  persistFollowUpEvent: vi.fn(),
  finalizeFollowUp: vi.fn(),
  persistApprovalEvent: vi.fn(),
  listExpiredFollowUps: vi.fn(),
  listExpiredApprovals: vi.fn(),
  reconcileExpiredFollowUp: vi.fn(),
  reconcileExpiredApproval: vi.fn(),
  startFollowUpDispatch: vi.fn(),
  markStopped: vi.fn(),
  markStoppedIfUnclaimed: vi.fn(),
  startApprovalDispatch: vi.fn(),
  startExpiryCleanup: vi.fn(),
  finishExpiryCleanup: vi.fn(),
  resolveAdapter: vi.fn(),
}));

vi.mock("./store.js", () => ({
  APPROVAL_RESOLUTION_CLAIM_LEASE_MS: 60_000,
  RESOLVED_APPROVAL_LIMIT: 32,
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
  failAgentHarnessSessionFollowUp: mocks.failFollowUp,
  failAgentHarnessSessionApprovalResolution: mocks.failApprovalResolution,
  releaseAgentHarnessSessionApprovalResolutionBeforeDispatch:
    mocks.releaseApprovalBeforeDispatch,
  updateAgentHarnessSessionAtGeneration: mocks.updateAtGeneration,
  claimAgentHarnessSessionFollowUp: mocks.claimFollowUp,
  claimAgentHarnessSessionApprovalResolution: mocks.claimApprovalResolution,
  renewAgentHarnessSessionApprovalResolutionClaim:
    mocks.renewApprovalResolutionClaim,
  finalizeAgentHarnessSessionApprovalResolution:
    mocks.finalizeApprovalResolution,
  markAgentHarnessSessionFollowUpDispatched: mocks.markFollowUpDispatched,
  renewAgentHarnessSessionFollowUpClaim: mocks.renewFollowUpClaim,
  persistAgentHarnessFollowUpEvent: mocks.persistFollowUpEvent,
  finalizeAgentHarnessSessionFollowUp: mocks.finalizeFollowUp,
  persistAgentHarnessApprovalEvent: mocks.persistApprovalEvent,
  listExpiredAgentHarnessFollowUps: mocks.listExpiredFollowUps,
  listExpiredAgentHarnessApprovalResolutions: mocks.listExpiredApprovals,
  reconcileExpiredAgentHarnessFollowUp: mocks.reconcileExpiredFollowUp,
  reconcileExpiredAgentHarnessApprovalResolution:
    mocks.reconcileExpiredApproval,
  startAgentHarnessSessionFollowUpDispatch: mocks.startFollowUpDispatch,
  markAgentHarnessSessionStopped: mocks.markStopped,
  markAgentHarnessSessionStoppedIfUnclaimed: mocks.markStoppedIfUnclaimed,
  startAgentHarnessSessionApprovalDispatch: mocks.startApprovalDispatch,
  startAgentHarnessSessionExpiryCleanup: mocks.startExpiryCleanup,
  finishAgentHarnessSessionExpiryCleanup: mocks.finishExpiryCleanup,
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
  sweepExpiredAgentHarnessApprovalResolutions,
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
      async (_id, expectedClaimId, patch, options) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const current = stored;
          const expectedApprovalResolutionId =
            options?.allowCurrentApprovalResolution
              ? current.approvalResolutionId
              : (options?.expectedApprovalResolutionId ?? null);
          if (
            current.status !== "running" ||
            current.followUpClaimId !== expectedClaimId ||
            current.expiryCleanupId != null ||
            current.approvalResolutionId !== expectedApprovalResolutionId
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
    mocks.failFollowUp.mockImplementation(async ({ claimId, outcome }) => {
      if (
        stored.status !== "running" ||
        stored.followUpClaimId !== claimId ||
        stored.approvalResolutionId != null
      ) {
        return null;
      }
      stored = {
        ...stored,
        status: outcome === "not_dispatched" ? "idle" : "errored",
        pendingApproval: null,
        approvalResolutionId: null,
        approvalResolutionClaimExpiresAt: null,
        followUpClaimId: null,
        followUpClaimExpiresAt: null,
        followUpDeadlineAt: null,
        followUpOutcome: outcome,
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      return stored;
    });
    mocks.failApprovalResolution.mockImplementation(
      async ({ sessionId, approvalId }) => {
        if (
          stored.id !== sessionId ||
          stored.approvalResolutionId !== approvalId
        ) {
          return null;
        }
        stored = {
          ...stored,
          pendingApproval: null,
          approvalResolutionId: null,
          approvalResolutionClaimExpiresAt: null,
          resolvedApprovalIds: [
            ...(stored.resolvedApprovalIds ?? []).filter(
              (id) => id !== approvalId,
            ),
            approvalId,
          ],
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return stored;
      },
    );
    mocks.releaseApprovalBeforeDispatch.mockImplementation(
      async ({
        sessionId,
        approvalId,
        expectedStatus,
        expectedGeneration,
        expectedFollowUpClaimId,
      }) => {
        if (
          stored.id !== sessionId ||
          stored.status !== expectedStatus ||
          stored.generation !== expectedGeneration ||
          stored.approvalResolutionId !== approvalId ||
          (stored.followUpClaimId ?? null) !== expectedFollowUpClaimId ||
          stored.expiryCleanupId != null
        ) {
          return null;
        }
        stored = {
          ...stored,
          approvalResolutionId: null,
          approvalResolutionClaimExpiresAt: null,
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return stored;
      },
    );
    mocks.updateAtGeneration.mockImplementation(
      async (
        _id,
        expectedStatus,
        expectedGeneration,
        patch,
        expectedClaimId,
        fence,
      ) => {
        if (
          stored.status !== expectedStatus ||
          stored.generation !== expectedGeneration ||
          (expectedClaimId !== undefined &&
            stored.followUpClaimId !== expectedClaimId) ||
          (typeof fence === "object" &&
            "expectedApprovalResolutionId" in fence &&
            stored.approvalResolutionId !==
              fence.expectedApprovalResolutionId) ||
          (typeof fence === "boolean" &&
            fence &&
            stored.approvalResolutionId !== null)
        ) {
          throw Object.assign(
            new Error("Harness session changed concurrently."),
            { name: "AgentHarnessSessionConflictError" },
          );
        }
        return mocks.update(_id, patch);
      },
    );
    mocks.claimFollowUp.mockImplementation(
      async (_id, generation, claimId, intent) => {
        if (
          stored.generation !== generation ||
          stored.status !== "idle" ||
          stored.pendingApproval ||
          stored.expiryCleanupId != null
        ) {
          return null;
        }
        const databaseNow = Date.now();
        stored = {
          ...stored,
          status: "running",
          followUpClaimId: claimId,
          followUpId: intent.followUpId,
          followUpPromptPresent: true,
          followUpMetadata: intent.metadata,
          followUpClaimExpiresAt:
            databaseNow +
            Math.min(intent.claimLeaseMs, intent.deadlineDurationMs),
          followUpDeadlineAt: databaseNow + intent.deadlineDurationMs,
          followUpDispatchedAt: null,
          followUpOutcome: null,
          generation: stored.generation + 1,
          updatedAt: databaseNow,
        };
        return stored;
      },
    );
    mocks.markFollowUpDispatched.mockImplementation(
      async (_id, generation, claimId, now = Date.now()) => {
        if (
          stored.status !== "running" ||
          stored.followUpClaimId !== claimId ||
          stored.generation !== generation
        ) {
          return null;
        }
        stored = {
          ...stored,
          followUpDispatchedAt: now,
          generation: stored.generation + 1,
          updatedAt: now,
        };
        return stored;
      },
    );
    mocks.claimApprovalResolution.mockImplementation(
      async (
        _id,
        approvalId,
        expectedStatus,
        generation,
        expectedFollowUpId,
      ) => {
        if (
          stored.status !== expectedStatus ||
          stored.generation !== generation ||
          stored.approvalResolutionId != null ||
          (stored.followUpClaimId ?? null) !== expectedFollowUpId ||
          stored.expiryCleanupId != null
        ) {
          return null;
        }
        stored = {
          ...stored,
          approvalResolutionId: approvalId,
          approvalResolutionClaimExpiresAt: Date.now() + 60_000,
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return stored;
      },
    );
    mocks.renewApprovalResolutionClaim.mockImplementation(
      async (_id, approvalId) => {
        if (
          stored.approvalResolutionId !== approvalId ||
          (stored.approvalResolutionClaimExpiresAt ?? 0) <= Date.now()
        ) {
          return false;
        }
        stored = {
          ...stored,
          approvalResolutionClaimExpiresAt: Date.now() + 60_000,
        };
        return true;
      },
    );
    mocks.finalizeApprovalResolution.mockImplementation(async (input) => {
      if (
        stored.status !== input.expectedStatus ||
        stored.generation !== input.expectedGeneration ||
        stored.approvalResolutionId !== input.approvalId ||
        (stored.approvalResolutionClaimExpiresAt ?? 0) <= Date.now() ||
        (stored.followUpClaimId ?? null) !== input.expectedFollowUpClaimId
      ) {
        throw Object.assign(
          new Error("Harness session changed concurrently."),
          {
            name: "AgentHarnessSessionConflictError",
          },
        );
      }
      stored = {
        ...stored,
        pendingApproval: input.pendingApproval,
        resumeState: input.resumeState,
        approvalResolutionId: null,
        approvalResolutionClaimExpiresAt: null,
        resolvedApprovalIds: input.resolvedApprovalIds,
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      return stored;
    });
    mocks.listExpiredApprovals.mockResolvedValue([]);
    mocks.reconcileExpiredApproval.mockResolvedValue(null);
    mocks.renewFollowUpClaim.mockImplementation(
      async (_id, claimId, leaseDurationMs) => {
        const databaseNow = Date.now();
        if (
          stored.followUpClaimId !== claimId ||
          (stored.followUpClaimExpiresAt ?? 0) <= databaseNow
        ) {
          return false;
        }
        stored = {
          ...stored,
          followUpClaimExpiresAt: databaseNow + leaseDurationMs,
          updatedAt: databaseNow,
        };
        return true;
      },
    );
    mocks.persistFollowUpEvent.mockResolvedValue(undefined);
    mocks.startFollowUpDispatch.mockImplementation(
      async (_id, expectedGeneration, claimId, start) => {
        if (
          stored.status !== "running" ||
          stored.followUpClaimId !== claimId ||
          stored.expiryCleanupId != null ||
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
    mocks.finalizeFollowUp.mockImplementation(async (input) => {
      if (
        stored.status !== "running" ||
        stored.generation !== input.expectedGeneration ||
        stored.followUpClaimId !== input.claimId ||
        stored.followUpId !== input.followUpId ||
        (stored.approvalResolutionId ?? null) !==
          input.expectedApprovalResolutionId
      ) {
        return null;
      }
      stored = {
        ...stored,
        status: "idle",
        resumeState: input.resumeState,
        pendingApproval: input.pendingApproval,
        followUpClaimId: null,
        followUpClaimExpiresAt: null,
        followUpDeadlineAt: null,
        followUpOutcome: "completed",
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      return stored;
    });
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
          stored.approvalResolutionId !== approvalId ||
          (stored.approvalResolutionClaimExpiresAt ?? 0) <= Date.now() ||
          stored.expiryCleanupId != null
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
      async (_id, expectedStatus, expectedGeneration, cleanupId, start) => {
        if (
          stored.status !== expectedStatus ||
          stored.generation !== expectedGeneration ||
          stored.followUpClaimId != null ||
          stored.approvalResolutionId != null ||
          stored.expiryCleanupId != null
        ) {
          return null;
        }
        stored = {
          ...stored,
          expiryCleanupId: cleanupId,
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return { session: stored, started: start() };
      },
    );
    mocks.finishExpiryCleanup.mockImplementation(
      async (_id, cleanupId, expectedGeneration) => {
        if (
          stored.expiryCleanupId !== cleanupId ||
          stored.generation !== expectedGeneration
        ) {
          return null;
        }
        stored = {
          ...stored,
          expiryCleanupId: null,
          generation: stored.generation + 1,
          updatedAt: Date.now(),
        };
        return stored;
      },
    );
  });

  afterEach(() => {
    releaseLiveAgentHarnessSession(stored.id);
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("keeps an approval retryable when dispatch admission does not start the provider", async () => {
    const approvalId = "approval-dispatch-not-started";
    const session = fakeSession();
    stored.pendingApproval = approvalEvent(approvalId);
    register(stored, session);
    mocks.startApprovalDispatch.mockResolvedValueOnce(null);

    const failed = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });

    expect(failed).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(session.approve).not.toHaveBeenCalled();
    expect(mocks.releaseApprovalBeforeDispatch).toHaveBeenCalledOnce();
    expect(stored).toMatchObject({
      pendingApproval: { id: approvalId },
      approvalResolutionId: null,
      resolvedApprovalIds: [],
    });

    const retry = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });

    expect(retry.ok).toBe(true);
    expect(session.approve).toHaveBeenCalledOnce();
    expect(stored.pendingApproval).toBeNull();
    expect(stored.resolvedApprovalIds).toContain(approvalId);
  });

  it("renews an approval claim while its provider call is still running", async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    stored.pendingApproval = approvalEvent("approval-long-running");
    let finishApproval!: () => void;
    session.approve.mockImplementation(
      () => new Promise<void>((resolve) => (finishApproval = resolve)),
    );
    register(stored, session);

    const resolution = resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-long-running", approved: true },
      scope: ownerScope(),
    });
    await vi.advanceTimersByTimeAsync(75_000);
    expect(mocks.renewApprovalResolutionClaim).toHaveBeenCalledTimes(3);

    finishApproval();
    await expect(resolution).resolves.toMatchObject({ ok: true });
  });

  it("keeps a recoverable idle status after delayed approval resolution", async () => {
    const session = fakeSession();
    stored = {
      ...stored,
      status: "idle",
      pendingApproval: approvalEvent("approval-timeout-recovery"),
    };
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-timeout-recovery", approved: true },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.approve).toHaveBeenCalledOnce();
    expect(stored).toMatchObject({
      status: "idle",
      pendingApproval: null,
      approvalResolutionId: null,
      resolvedApprovalIds: ["approval-timeout-recovery"],
    });
  });

  it("retries approval persistence after a concurrent session update", async () => {
    const session = fakeSession();
    stored.pendingApproval = approvalEvent("approval-racing-write");
    register(stored, session);
    const finalizeApproval =
      mocks.finalizeApprovalResolution.getMockImplementation()!;
    let attempts = 0;
    mocks.finalizeApprovalResolution.mockImplementation(async (...args) => {
      attempts += 1;
      if (attempts === 1) {
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
      return finalizeApproval(...args);
    });

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: "approval-racing-write", approved: true },
      scope: ownerScope(),
    });

    expect(result.ok).toBe(true);
    expect(session.approve).toHaveBeenCalledOnce();
    expect(mocks.finalizeApprovalResolution).toHaveBeenCalledTimes(2);
    expect(stored.pendingApproval).toBeNull();
    expect(stored.resolvedApprovalIds).toEqual([
      "approval-other",
      "approval-racing-write",
    ]);
    expect(stored.resumeState).toEqual({ token: "concurrent" });
  });

  it("returns a typed unavailable result when approval finalization loses its claim", async () => {
    const approvalId = "approval-finalization-conflict";
    const session = fakeSession();
    stored.pendingApproval = approvalEvent(approvalId);
    register(stored, session);
    mocks.finalizeApprovalResolution.mockResolvedValue(null);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(session.approve).toHaveBeenCalledOnce();
    expect(mocks.finalizeApprovalResolution).toHaveBeenCalledOnce();
    expect(stored).toMatchObject({
      pendingApproval: { id: approvalId },
      approvalResolutionId: approvalId,
      resolvedApprovalIds: [],
    });
  });

  it("preserves a newer approval while recording the resolved approval", async () => {
    const session = fakeSession();
    stored.pendingApproval = approvalEvent("approval-racing-write");
    register(stored, session);
    const finalizeApproval =
      mocks.finalizeApprovalResolution.getMockImplementation()!;
    let attempts = 0;
    mocks.finalizeApprovalResolution.mockImplementation(async (...args) => {
      attempts += 1;
      if (attempts === 1) {
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
      return finalizeApproval(...args);
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
    mocks.finalizeApprovalResolution.mockRejectedValue(
      Object.assign(new Error("database write failed"), {
        name: "AgentHarnessSessionConflictError",
      }),
    );

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

    stored.approvalResolutionClaimExpiresAt = Date.now() - 1;
    mocks.listExpiredApprovals.mockResolvedValueOnce([stored]);
    mocks.reconcileExpiredApproval.mockImplementationOnce(async () => {
      stored = {
        ...stored,
        approvalResolutionId: null,
        approvalResolutionClaimExpiresAt: null,
        pendingApproval: null,
        resolvedApprovalIds: [approvalId],
        generation: stored.generation + 1,
      };
      return stored;
    });
    await expect(
      sweepExpiredAgentHarnessApprovalResolutions(),
    ).resolves.toEqual({ recovered: 1, truncated: false });
    expect(session.stop).not.toHaveBeenCalled();
    expect(stored.approvalResolutionId).toBeNull();

    const afterRecovery = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
    });
    expect(afterRecovery).toMatchObject({ ok: true, idempotent: true });
    expect(session.approve).toHaveBeenCalledOnce();
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

  it("journals approval continuation events before forwarding them", async () => {
    const { approve: _approve, ...baseSession } = fakeSession();
    const session = {
      ...baseSession,
      continueTurn: vi.fn(async function* () {
        yield {
          type: "text-delta",
          text: "Approval accepted",
        } as AgentHarnessEvent;
        yield {
          type: "tool-start",
          callId: "call-1",
          name: "write_file",
          input: { path: "notes.txt" },
        } as AgentHarnessEvent;
        yield { type: "done" } as AgentHarnessEvent;
      }),
    };
    const approvalId = "approval-continuation-transcript";
    stored.pendingApproval = approvalEvent(approvalId);
    const order: string[] = [];
    mocks.persistApprovalEvent.mockImplementation(
      async (_sessionId, _approvalId, event) => {
        order.push(`persist:${event.type}`);
      },
    );
    const onHarnessEvent = vi.fn(async (event: AgentHarnessEvent) => {
      order.push(`publish:${event.type}`);
    });
    const finalizeApproval =
      mocks.finalizeApprovalResolution.getMockImplementation()!;
    mocks.finalizeApprovalResolution.mockImplementation(async (input) => {
      order.push("finalize");
      return finalizeApproval(input);
    });
    register(stored, session);

    const result = await resolveAgentHarnessApproval({
      runId: stored.runId!,
      approval: { id: approvalId, approved: true },
      scope: ownerScope(),
      onHarnessEvent,
    });

    expect(result.ok).toBe(true);
    expect(
      mocks.persistApprovalEvent.mock.calls.map(([, , event]) => event),
    ).toEqual([
      { type: "text", text: "Approval accepted" },
      { type: "tool_start", tool: "write_file", input: { path: "notes.txt" } },
    ]);
    expect(order).toEqual([
      "persist:text",
      "publish:text-delta",
      "persist:tool_start",
      "publish:tool-start",
      "finalize",
      "publish:done",
    ]);
  });

  it("releases an approval claim after a persisted stream error", async () => {
    const { approve: _approve, ...baseSession } = fakeSession();
    const session = {
      ...baseSession,
      continueTurn: vi.fn(async function* () {
        yield {
          type: "error",
          error: "provider returned an error",
        } as AgentHarnessEvent;
      }),
    };
    const approvalId = "approval-stream-error";
    stored.pendingApproval = approvalEvent(approvalId);
    register(stored, session);
    const order: string[] = [];
    mocks.persistApprovalEvent.mockImplementation(async () => {
      order.push("persist:error");
    });
    const onHarnessEvent = vi.fn(async () => {
      order.push("publish:error");
    });
    mocks.failApprovalResolution.mockImplementationOnce(async (input) => {
      order.push("release:claim");
      const defaultFailure =
        mocks.failApprovalResolution.getMockImplementation()!;
      return defaultFailure(input);
    });

    await expect(
      resolveAgentHarnessApproval({
        runId: stored.runId!,
        approval: { id: approvalId, approved: true },
        scope: ownerScope(),
        onHarnessEvent,
      }),
    ).rejects.toThrow("provider returned an error");

    expect(order).toEqual(["persist:error", "publish:error", "release:claim"]);
    expect(stored).toMatchObject({
      approvalResolutionId: null,
      pendingApproval: null,
      resolvedApprovalIds: [approvalId],
    });
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
    mocks.failFollowUp.mockImplementationOnce(async () => {
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
    expect(mocks.failFollowUp).toHaveBeenCalledTimes(2);
    expect(mocks.failFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "not_dispatched",
        errorEvent: expect.objectContaining({
          type: "error",
          errorCode: "harness_follow_up_not_dispatched",
        }),
      }),
    );
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
      "errored",
    );
    expect(stored.status).toBe("errored");
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
    const session = fakeSession([
      approvalEvent("approval-chained"),
      { type: "done" },
    ]);
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

  it("persists a chained approval while another approval resolution is reserved", async () => {
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      stored = {
        ...stored,
        approvalResolutionId: "approval-in-flight",
        generation: stored.generation + 1,
      };
      yield approvalEvent("approval-chained-after-resolution");
      yield { type: "done" } as AgentHarnessEvent;
    });
    register(stored, session);

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({
      ok: true,
      session: {
        status: "idle",
        followUpClaimId: null,
        approvalResolutionId: "approval-in-flight",
        pendingApproval: { id: "approval-chained-after-resolution" },
      },
    });
    expect(session.detach).not.toHaveBeenCalled();
    expect(
      mocks.updateIfFollowUpClaim.mock.calls.some(
        (call) => call[3]?.allowCurrentApprovalResolution === true,
      ),
    ).toBe(true);
    expect(mocks.finalizeFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedApprovalResolutionId: "approval-in-flight",
      }),
    );
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
    session.streamTurn.mockImplementation(async function* () {
      yield approval;
      stored = {
        ...stored,
        pendingApproval: null,
        resolvedApprovalIds: [approval.id],
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      yield { type: "done" } as AgentHarnessEvent;
    });
    register(stored, session);

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

  it("preserves a follow-up while an approval resolution lease is active", async () => {
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      stored = { ...stored, approvalResolutionId: "approval-in-flight" };
      throw new Error("provider stream failed");
    });
    register(stored, session);

    await expect(
      sendAgentHarnessFollowUp({
        runId: stored.runId!,
        prompt: "continue",
        scope: ownerScope(),
      }),
    ).rejects.toThrow("provider stream failed");

    expect(stored).toMatchObject({
      status: "running",
      followUpClaimId: expect.any(String),
      approvalResolutionId: "approval-in-flight",
    });
    expect(mocks.failFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "unknown",
      }),
    );
    expect(session.stop).not.toHaveBeenCalled();
  });

  it("retains a failed provider stop for a later cleanup attempt", async () => {
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      throw new Error("provider stream failed");
    });
    session.stop.mockRejectedValueOnce(new Error("provider stop failed"));
    register(stored, session);

    await expect(
      sendAgentHarnessFollowUp({
        runId: stored.runId!,
        prompt: "continue",
        scope: ownerScope(),
      }),
    ).rejects.toThrow("Harness follow-up failed and cleanup was incomplete.");

    expect(stored.status).toBe("errored");
    await expect(
      stopLiveAgentHarnessSession({
        sessionId: stored.id,
        scope: ownerScope(),
      }),
    ).resolves.toBe(true);
    expect(session.stop).toHaveBeenCalledTimes(2);
  });

  it("retries failed-claim cleanup after a same-claim generation conflict", async () => {
    const session = fakeSession();
    session.streamTurn.mockImplementation(async function* () {
      throw new Error("provider stream failed");
    });
    register(stored, session);
    mocks.failFollowUp.mockImplementationOnce(async () => {
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
    mocks.failFollowUp.mockRejectedValue(new Error("database unavailable"));

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

  it("journals an admission failure when claim monitoring aborts during acquisition", async () => {
    vi.useFakeTimers();
    stored.resumeState = { token: "saved" };
    releaseLiveAgentHarnessSession(stored.id);
    let finishCreateSession!: () => void;
    let reportCreateStarted!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      reportCreateStarted = resolve;
    });
    const session = fakeSession();
    const adapter = fakeAdapter(session);
    adapter.createSession = vi.fn(() => {
      reportCreateStarted();
      return new Promise<AgentHarnessSession>((resolve) => {
        finishCreateSession = () => resolve(session);
      });
    });
    mocks.resolveAdapter.mockReturnValue(adapter);

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });
    await createStarted;
    mocks.getById
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockRejectedValueOnce(new Error("database unavailable"));
    await vi.advanceTimersByTimeAsync(1_500);
    finishCreateSession();

    await expect(followUp).resolves.toMatchObject({
      ok: false,
      errorCode: "unavailable",
      session: { status: "idle", followUpOutcome: "not_dispatched" },
    });
    expect(mocks.failFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "not_dispatched" }),
    );
    expect(session.streamTurn).not.toHaveBeenCalled();
    expect(session.stop).not.toHaveBeenCalled();
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
    const finalizeFollowUp = mocks.finalizeFollowUp.getMockImplementation()!;
    let conflicted = false;
    mocks.finalizeFollowUp.mockImplementation(async (input) => {
      if (!conflicted) {
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
      return finalizeFollowUp(input);
    });

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
    expect(mocks.finalizeFollowUp).toHaveBeenCalledTimes(2);
    expect(session.stop).not.toHaveBeenCalled();
  });

  it("fails and cleans up after exhausting follow-up finalization retries", async () => {
    const session = fakeSession([{ type: "text-delta", text: "done" }]);
    register(stored, session);

    let finalizationAttempts = 0;
    mocks.finalizeFollowUp.mockImplementation(async () => {
      finalizationAttempts += 1;
      stored = {
        ...stored,
        generation: stored.generation + 1,
        updatedAt: Date.now(),
      };
      throw Object.assign(new Error("Harness session changed concurrently."), {
        name: "AgentHarnessSessionConflictError",
      });
    });

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

  it("marks a failed dispatch admission retryable when the provider never starts", async () => {
    const session = fakeSession();
    register(stored, session);
    mocks.startFollowUpDispatch.mockResolvedValueOnce(null);

    const result = await sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "continue",
      scope: ownerScope(),
    });

    expect(result).toMatchObject({ ok: false, errorCode: "unavailable" });
    expect(session.streamTurn).not.toHaveBeenCalled();
    expect(stored).toMatchObject({
      status: "idle",
      followUpClaimId: null,
      followUpOutcome: "not_dispatched",
    });
    expect(mocks.failFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "not_dispatched" }),
    );
    expect(session.stop).not.toHaveBeenCalled();
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
    mocks.failFollowUp.mockImplementationOnce(async () => {
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

  it("does not persist a continuation approval after stop wins", async () => {
    stored.pendingApproval = approvalEvent("approval-first");
    const session = {
      ...fakeSession(),
      approve: undefined,
      continueTurn: vi.fn(async function* () {
        await stopAndPersistAgentHarnessSession({
          sessionId: stored.id,
          scope: ownerScope(),
          status: "stopped",
        });
        yield approvalEvent("approval-after-stop");
      }),
    };
    register(stored, session);

    await expect(
      resolveAgentHarnessApproval({
        runId: stored.runId!,
        approval: { id: "approval-first", approved: true },
        scope: ownerScope(),
      }),
    ).rejects.toThrow("changed concurrently");

    expect(stored).toMatchObject({
      status: "stopped",
      pendingApproval: null,
      approvalResolutionId: null,
    });
    expect(mocks.update).not.toHaveBeenCalledWith(
      stored.id,
      expect.objectContaining({ id: "approval-after-stop" }),
    );
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
    const finalizeFollowUp = mocks.finalizeFollowUp.getMockImplementation()!;
    mocks.finalizeFollowUp.mockImplementation(async (input) => {
      finalizationStarted();
      return finalizeFollowUp(input);
    });

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
    expect(mocks.finalizeFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedApprovalResolutionId: null,
      }),
    );
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
    let releaseNext:
      | ((next: IteratorResult<AgentHarnessEvent>) => void)
      | undefined;
    const iterator = {
      next: vi.fn(
        () =>
          new Promise<IteratorResult<AgentHarnessEvent>>((resolve) => {
            releaseNext = resolve;
          }),
      ),
      return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
    const session = fakeSession();
    session.streamTurn.mockImplementation(
      (input: { abortSignal?: AbortSignal }) => {
        observedSignal = input.abortSignal;
        return { [Symbol.asyncIterator]: () => iterator };
      },
    );
    session.stop.mockImplementation(async () => {
      releaseNext?.({ done: true, value: undefined });
    });
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
    expect(iterator.return).toHaveBeenCalledOnce();
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

  it("renews the claim while a resumable adapter is being acquired", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    stored.resumeState = { token: "saved" };
    releaseLiveAgentHarnessSession(stored.id);
    let finishCreateSession!: () => void;
    const session = fakeSession([{ type: "done" }]);
    const adapter = fakeAdapter(session);
    adapter.createSession = vi.fn(
      () =>
        new Promise<AgentHarnessSession>((resolve) => {
          finishCreateSession = () => resolve(session);
        }),
    );
    mocks.resolveAdapter.mockReturnValue(adapter);

    const followUp = sendAgentHarnessFollowUp({
      runId: stored.runId!,
      prompt: "resume",
      scope: ownerScope(),
    });
    await vi.waitFor(() =>
      expect(adapter.createSession).toHaveBeenCalledOnce(),
    );
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const renewalWindowStartedAt = Date.now();
    await vi.advanceTimersByTimeAsync(75_000);
    expect(Date.now()).toBe(renewalWindowStartedAt + 75_000);
    expect(mocks.getById).toHaveBeenCalled();
    expect(mocks.renewFollowUpClaim).toHaveBeenCalledTimes(3);

    finishCreateSession();
    await expect(followUp).resolves.toMatchObject({
      ok: true,
      rehydrated: true,
    });
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
