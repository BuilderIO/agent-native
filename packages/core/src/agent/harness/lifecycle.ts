import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { startRun } from "../run-manager.js";
import type { RunChunkControl, StartedRun } from "../run-manager.js";
import type { AgentChatEvent } from "../types.js";
import { resolveAgentHarness } from "./registry.js";
import { agentHarnessFollowUpRunOptions } from "./run-policy.js";
import {
  APPROVAL_RESOLUTION_CLAIM_LEASE_MS,
  AgentHarnessSessionConflictError,
  claimAgentHarnessSessionFollowUp,
  claimAgentHarnessSessionApprovalResolution,
  failAgentHarnessSessionApprovalResolution,
  failAgentHarnessSessionFollowUp,
  finalizeAgentHarnessSessionApprovalResolution,
  finalizeAgentHarnessSessionFollowUp,
  finishAgentHarnessSessionExpiryCleanup,
  getAgentHarnessSession,
  getAgentHarnessSessionByRunId,
  isAgentHarnessSessionConflictError,
  listExpiredAgentHarnessApprovalResolutions,
  listExpiredAgentHarnessFollowUps,
  markAgentHarnessSessionStopped,
  markAgentHarnessSessionStoppedIfUnclaimed,
  markAgentHarnessSessionFollowUpDispatched,
  persistAgentHarnessApprovalEvent,
  persistAgentHarnessFollowUpEvent,
  reconcileExpiredAgentHarnessFollowUp,
  reconcileExpiredAgentHarnessApprovalResolution,
  renewAgentHarnessSessionApprovalResolutionClaim,
  renewAgentHarnessSessionFollowUpClaim,
  releaseAgentHarnessSessionApprovalResolutionBeforeDispatch,
  startAgentHarnessSessionApprovalDispatch,
  startAgentHarnessSessionExpiryCleanup,
  startAgentHarnessSessionFollowUpDispatch,
  updateAgentHarnessSession,
  updateAgentHarnessSessionAtGeneration,
  updateAgentHarnessSessionIfFollowUpClaim,
  RESOLVED_APPROVAL_LIMIT,
  type AgentHarnessSessionStatus,
  type StoredAgentHarnessSession,
} from "./store.js";
import { agentHarnessEventToAgentChatEvents } from "./translate.js";
import { driveAgentHarnessTurnChunks } from "./turn-driver.js";
import type {
  AgentHarnessAdapter,
  AgentHarnessApproval,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
  AgentHarnessSession,
} from "./types.js";

const LIVE_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const APPROVAL_CLAIM_POLL_INTERVAL_MS = 500;
const APPROVAL_CLAIM_RENEW_INTERVAL_MS = Math.floor(
  APPROVAL_RESOLUTION_CLAIM_LEASE_MS / 3,
);
const FOLLOW_UP_CLAIM_POLL_INTERVAL_MS = 500;
const FOLLOW_UP_CLAIM_LEASE_MS = 60_000;
const FOLLOW_UP_CLAIM_RENEW_INTERVAL_MS = 20_000;
const FOLLOW_UP_DEADLINE_MS = LIVE_SESSION_TTL_MS;
const MAX_FOLLOW_UP_FINALIZATION_ATTEMPTS = 3;

interface LiveAgentHarnessSession {
  adapter: AgentHarnessAdapter;
  session: AgentHarnessSession;
  createSession: AgentHarnessCreateSessionOptions;
  ownerEmail: string | null;
  orgId: string | null;
  generation: number;
  expiresAt: number;
  approvalResolutionInProgress: boolean;
  expiryCleanupInProgress: boolean;
}

function isAbortRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

const liveSessions = new Map<string, LiveAgentHarnessSession>();
const sessionOperations = new Map<string, Promise<void>>();
const activeFollowUps = new Set<string>();
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

export type AgentHarnessLifecycleErrorCode =
  | "not_found"
  | "owner_mismatch"
  | "approval_mismatch"
  | "unavailable"
  | "invalid_input";

export interface AgentHarnessLifecycleResult {
  ok: boolean;
  runId: string;
  session?: StoredAgentHarnessSession;
  events?: AgentHarnessEvent[];
  idempotent?: boolean;
  rehydrated?: boolean;
  error?: string;
  errorCode?: AgentHarnessLifecycleErrorCode;
}

export interface AgentHarnessOwnerScope {
  ownerEmail: string | null;
  orgId?: string | null;
}

export function registerLiveAgentHarnessSession(input: {
  sessionId: string;
  adapter: AgentHarnessAdapter;
  session: AgentHarnessSession;
  createSession?: AgentHarnessCreateSessionOptions;
  ownerEmail?: string | null;
  orgId?: string | null;
  generation: number;
}): void {
  liveSessions.set(input.sessionId, {
    adapter: input.adapter,
    session: input.session,
    createSession: withoutSignal(input.createSession ?? {}),
    ownerEmail: input.ownerEmail ?? null,
    orgId: input.orgId ?? null,
    generation: input.generation,
    expiresAt: Date.now() + LIVE_SESSION_TTL_MS,
    approvalResolutionInProgress: false,
    expiryCleanupInProgress: false,
  });
  scheduleCleanup();
}

export function refreshLiveAgentHarnessSessionGeneration(
  sessionId: string,
  session: AgentHarnessSession,
  generation: number,
): void {
  const live = liveSessions.get(sessionId);
  if (live?.session === session) {
    live.generation = Math.max(live.generation, generation);
  }
}

export function getLiveAgentHarnessSessionGeneration(
  sessionId: string,
  session: AgentHarnessSession,
): number | null {
  const live = liveSessions.get(sessionId);
  return live?.session === session && Number.isSafeInteger(live.generation)
    ? live.generation
    : null;
}

function refreshLiveAgentHarnessSessionGenerationById(
  sessionId: string,
  generation: number,
): void {
  const live = liveSessions.get(sessionId);
  if (live) live.generation = Math.max(live.generation, generation);
}

export function releaseLiveAgentHarnessSession(
  sessionId: string,
  session?: AgentHarnessSession,
): void {
  const live = liveSessions.get(sessionId);
  if (!live || (session && live.session !== session)) return;
  liveSessions.delete(sessionId);
}

export async function resolveAgentHarnessApproval(input: {
  runId: string;
  approval: AgentHarnessApproval;
  scope: AgentHarnessOwnerScope;
  onHarnessEvent?: (event: AgentHarnessEvent) => void | Promise<void>;
}): Promise<AgentHarnessLifecycleResult> {
  return withSessionLock(input.runId, async () => {
    const stored = await getAgentHarnessSessionByRunId(input.runId);
    const scoped = checkScope(input.runId, stored, input.scope);
    if (scoped) return scoped;
    const session = stored!;
    const resolvedIds = session.resolvedApprovalIds ?? [];
    const pending = asPendingApproval(session.pendingApproval);
    if (session.approvalResolutionId) {
      return failure(
        input.runId,
        session,
        "unavailable",
        session.approvalResolutionId === input.approval.id
          ? "This approval may already have been sent to the harness; its outcome is uncertain and it cannot be retried safely."
          : "Another approval resolution is already in progress for this harness session.",
      );
    }
    if (resolvedIds.includes(input.approval.id)) {
      if (pending?.id === input.approval.id) {
        return failure(
          input.runId,
          session,
          "unavailable",
          "This approval may already have been sent to the harness; its outcome is uncertain and it cannot be retried safely.",
        );
      }
      return {
        ok: true,
        runId: input.runId,
        session,
        idempotent: true,
      };
    }
    if (!pending || pending.id !== input.approval.id) {
      return failure(
        input.runId,
        session,
        "approval_mismatch",
        pending
          ? `Approval ${input.approval.id} does not match pending approval ${pending.id}.`
          : "This harness session has no pending approval.",
      );
    }

    let live = ownedLiveSession(session.id, input.scope);
    if (live && !live.session.approve && !live.session.continueTurn) {
      return failure(
        input.runId,
        session,
        "unavailable",
        `Harness ${session.harnessName} does not expose approval continuation.`,
      );
    }
    if (live?.expiryCleanupInProgress) {
      return failure(
        input.runId,
        session,
        "unavailable",
        "The live harness session is being cleaned up and cannot resolve approval.",
      );
    }
    const approvalAbort = new AbortController();
    let finalizing = false;
    let stopWatchingApprovalClaim: (() => void) | undefined;
    let approvalClaimAcquired = false;
    let approvalResolutionStarted: StoredAgentHarnessSession | null = null;
    let rehydratedSession: AgentHarnessSession | undefined;
    let providerDispatchStarted = false;
    try {
      const resolutionStarted = await beginApprovalResolution(
        input.runId,
        input.approval.id,
        live?.session,
      );
      if (!resolutionStarted) {
        const latest = await getAgentHarnessSessionByRunId(input.runId);
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          "The harness session changed before approval dispatch; its latest state was preserved.",
        );
      }
      approvalResolutionStarted = resolutionStarted;
      approvalClaimAcquired = true;
      stopWatchingApprovalClaim = watchApprovalResolutionClaim(
        session.id,
        input.approval.id,
        approvalAbort,
        () => finalizing,
      );

      if (!live) {
        const acquired = await acquireSession(resolutionStarted, input.scope);
        if (!acquired.ok) {
          const latest = await releaseUndispatchedApprovalResolution({
            runId: input.runId,
            session: resolutionStarted,
            approvalId: input.approval.id,
          });
          return failure(
            input.runId,
            latest ?? acquired.result.session ?? session,
            acquired.result.errorCode ?? "unavailable",
            acquired.result.error ?? "Harness session could not be resumed.",
          );
        }
        live = acquired.live;
        if (acquired.rehydrated) {
          rehydratedSession = acquired.live.session;
        }
      }
      const activeLive = live;
      if (!activeLive.session.approve && !activeLive.session.continueTurn) {
        const latest = await releaseUndispatchedApprovalResolution({
          runId: input.runId,
          session: resolutionStarted,
          approvalId: input.approval.id,
          liveSession: activeLive.session,
        });
        if (rehydratedSession) {
          await stopAcquiredHarnessSession(session.id, rehydratedSession);
        }
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          `Harness ${session.harnessName} does not expose approval continuation.`,
        );
      }
      if (activeLive.expiryCleanupInProgress) {
        const latest = await releaseUndispatchedApprovalResolution({
          runId: input.runId,
          session: resolutionStarted,
          approvalId: input.approval.id,
          liveSession: activeLive.session,
        });
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          "The live harness session is being cleaned up and cannot resolve approval.",
        );
      }
      if (
        activeLive.session.canResolveApproval &&
        !(await activeLive.session.canResolveApproval(input.approval))
      ) {
        const failed = await failAgentHarnessSessionApprovalResolution({
          sessionId: session.id,
          approvalId: input.approval.id,
          recordResolvedId: false,
          errorEvent: {
            type: "error",
            error:
              "The provider session resumed without its pending approval request. The approval was not sent and cannot be retried on this session.",
            errorCode: "harness_approval_not_resumable",
          },
        });
        if (failed) {
          refreshLiveAgentHarnessSessionGeneration(
            session.id,
            activeLive.session,
            failed.generation,
          );
        }
        if (rehydratedSession) {
          await stopAcquiredHarnessSession(session.id, rehydratedSession);
        }
        const latest =
          failed ?? (await getAgentHarnessSessionByRunId(input.runId));
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          "The provider session resumed without the pending approval request. The approval was not sent and the session cannot resume it.",
        );
      }
      activeLive.approvalResolutionInProgress = true;

      const dispatch = await startAgentHarnessSessionApprovalDispatch(
        session.id,
        resolutionStarted.status,
        resolutionStarted.generation,
        input.approval.id,
        () => {
          providerDispatchStarted = true;
          const liveSession = activeLive.session;
          if (liveSession.approve) {
            const result = liveSession.approve(input.approval);
            void result.catch(() => {});
            return {
              kind: "approve" as const,
              result,
            };
          }
          const stream = liveSession.continueTurn?.({
            approval: input.approval,
          });
          if (!stream) {
            throw new Error("Harness session cannot continue an approval.");
          }
          const iterator = stream[Symbol.asyncIterator]();
          const firstNext = nextHarnessEvent(iterator, approvalAbort.signal);
          void firstNext.catch(() => {});
          return {
            kind: "continue" as const,
            stream,
            iterator,
            firstNext,
          };
        },
      );
      if (!dispatch) {
        const latest = await releaseUndispatchedApprovalResolution({
          runId: input.runId,
          session: resolutionStarted,
          approvalId: input.approval.id,
          liveSession: activeLive.session,
        });
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          "The harness session changed before approval dispatch; its latest state was preserved.",
        );
      }
      refreshLiveAgentHarnessSessionGeneration(
        session.id,
        activeLive.session,
        dispatch.session.generation,
      );

      const events: AgentHarnessEvent[] = [];
      const continued = dispatch.started.kind === "continue";
      if (dispatch.started.kind === "approve") {
        await dispatch.started.result;
      } else {
        await consumeEvents(
          dispatch.started.stream,
          events,
          async (event) => {
            if (event.type !== "done") await input.onHarnessEvent?.(event);
          },
          session.id,
          {
            followUpClaimId: session.followUpClaimId ?? undefined,
            approvalResolutionId: input.approval.id,
            approvalResolutionStatus: dispatch.session.status,
            firstNext: dispatch.started.firstNext,
            iterator: dispatch.started.iterator,
            liveSession: activeLive.session,
            abortSignal: approvalAbort.signal,
            persistEvent: async (event) => {
              if (event.type === "done") return;
              const chatEvents = agentHarnessEventToAgentChatEvents(event);
              for (const chatEvent of chatEvents) {
                await persistAgentHarnessApprovalEvent(
                  session.id,
                  input.approval.id,
                  chatEvent,
                );
              }
            },
          },
        );
      }
      approvalAbort.signal.throwIfAborted();

      const nextPending = events.find(
        (
          event,
        ): event is Extract<AgentHarnessEvent, { type: "approval-request" }> =>
          event.type === "approval-request",
      );
      const detachResumeState =
        continued && !nextPending && activeLive.session.detach
          ? async () => activeLive.session.detach?.()
          : undefined;
      let updated: StoredAgentHarnessSession | null;
      finalizing = true;
      try {
        updated = await persistResolvedApproval({
          runId: input.runId,
          approvalId: input.approval.id,
          nextPending,
          detachResumeState,
          liveSession: activeLive.session,
        });
      } catch (error) {
        if (!isAgentHarnessSessionConflictError(error)) throw error;
        const latest = await getAgentHarnessSessionByRunId(input.runId);
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          "The harness session changed while resolving approval; its latest state was preserved.",
        );
      }
      if (!updated) {
        const latest = await getAgentHarnessSessionByRunId(input.runId);
        if (latest?.resolvedApprovalIds?.includes(input.approval.id)) {
          return {
            ok: true,
            runId: input.runId,
            session: latest,
            events,
          };
        }
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          "The harness session changed while resolving approval; its latest state was preserved.",
        );
      }
      if (
        continued &&
        !asPendingApproval(updated.pendingApproval) &&
        !updated.followUpClaimId
      ) {
        releaseLiveAgentHarnessSession(session.id, activeLive.session);
      }
      if (continued && events.some((event) => event.type === "done")) {
        await input.onHarnessEvent?.({ type: "done" });
      }
      return {
        ok: true,
        runId: input.runId,
        session: updated ?? session,
        events,
      };
    } catch (error) {
      if (
        approvalClaimAcquired &&
        !finalizing &&
        (!providerDispatchStarted || !isAgentHarnessSessionConflictError(error))
      ) {
        try {
          const recovered = providerDispatchStarted
            ? await failAgentHarnessSessionApprovalResolution({
                sessionId: session.id,
                approvalId: input.approval.id,
              })
            : approvalResolutionStarted
              ? await releaseUndispatchedApprovalResolution({
                  runId: input.runId,
                  session: approvalResolutionStarted,
                  approvalId: input.approval.id,
                  liveSession: live?.session,
                })
              : null;
          if (recovered && live) {
            refreshLiveAgentHarnessSessionGeneration(
              session.id,
              live.session,
              recovered.generation,
            );
          }
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Harness approval failed and its resolution claim could not be released.",
          );
        }
      }
      throw error;
    } finally {
      stopWatchingApprovalClaim?.();
      if (live) live.approvalResolutionInProgress = false;
    }
  });
}

async function persistResolvedApproval(input: {
  runId: string;
  approvalId: string;
  nextPending?: Extract<AgentHarnessEvent, { type: "approval-request" }>;
  detachResumeState?: () => Promise<unknown>;
  liveSession: AgentHarnessSession;
}): Promise<StoredAgentHarnessSession | null> {
  let conflict: AgentHarnessSessionConflictError | undefined;
  let hasDetachedResumeState = false;
  let detachedResumeState: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await getAgentHarnessSessionByRunId(input.runId);
    if (!latest) return null;
    const resolvedIds = latest.resolvedApprovalIds ?? [];
    const pending = asPendingApproval(latest.pendingApproval);
    if (latest.approvalResolutionId !== input.approvalId) return null;
    if (
      resolvedIds.includes(input.approvalId) &&
      pending?.id !== input.approvalId
    ) {
      return latest;
    }

    const pendingApproval =
      pending?.id === input.approvalId
        ? latest.status === "stopped" ||
          latest.status === "errored" ||
          latest.status === "destroyed"
          ? null
          : (input.nextPending ?? null)
        : latest.pendingApproval;
    let resumeStatePatch: { resumeState?: unknown } = {};
    if (!latest.followUpClaimId && input.detachResumeState) {
      if (!hasDetachedResumeState) {
        detachedResumeState = await input.detachResumeState();
        hasDetachedResumeState = true;
      }
      if (detachedResumeState !== undefined) {
        resumeStatePatch = { resumeState: detachedResumeState };
      }
    }
    try {
      const updated = await finalizeAgentHarnessSessionApprovalResolution({
        sessionId: latest.id,
        approvalId: input.approvalId,
        expectedStatus: latest.status,
        expectedGeneration: latest.generation,
        expectedFollowUpClaimId: latest.followUpClaimId ?? null,
        pendingApproval,
        resumeState:
          resumeStatePatch.resumeState !== undefined
            ? resumeStatePatch.resumeState
            : latest.resumeState,
        resolvedApprovalIds: resolvedIds.includes(input.approvalId)
          ? resolvedIds
          : [...resolvedIds, input.approvalId].slice(-RESOLVED_APPROVAL_LIMIT),
      });
      if (updated) {
        refreshLiveAgentHarnessSessionGeneration(
          latest.id,
          input.liveSession,
          updated.generation,
        );
        return updated;
      }
      return null;
    } catch (error) {
      if (!isAgentHarnessSessionConflictError(error) || attempt === 2) {
        throw error;
      }
      conflict = error;
    }
  }
  if (conflict) throw conflict;
  return null;
}

async function beginApprovalResolution(
  runId: string,
  approvalId: string,
  liveSession?: AgentHarnessSession,
): Promise<StoredAgentHarnessSession | null> {
  let conflict: AgentHarnessSessionConflictError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await getAgentHarnessSessionByRunId(runId);
    if (
      !latest ||
      latest.approvalResolutionId ||
      latest.resolvedApprovalIds?.includes(approvalId) ||
      asPendingApproval(latest.pendingApproval)?.id !== approvalId ||
      latest.status === "stopped" ||
      latest.status === "errored" ||
      latest.status === "destroyed"
    ) {
      return null;
    }
    try {
      const updated = await claimAgentHarnessSessionApprovalResolution(
        latest.id,
        approvalId,
        latest.status,
        latest.generation,
        latest.followUpClaimId ?? null,
      );
      if (!updated) return null;
      if (liveSession) {
        refreshLiveAgentHarnessSessionGeneration(
          latest.id,
          liveSession,
          updated.generation,
        );
      }
      return updated;
    } catch (error) {
      if (!isAgentHarnessSessionConflictError(error) || attempt === 2) {
        throw error;
      }
      conflict = error;
    }
  }
  if (conflict) throw conflict;
  return null;
}

async function releaseUndispatchedApprovalResolution(input: {
  runId: string;
  session: StoredAgentHarnessSession;
  approvalId: string;
  liveSession?: AgentHarnessSession;
}): Promise<StoredAgentHarnessSession | null> {
  let latest: StoredAgentHarnessSession | null = input.session;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (
      !latest ||
      latest.approvalResolutionId !== input.approvalId ||
      asPendingApproval(latest.pendingApproval)?.id !== input.approvalId ||
      latest.expiryCleanupId != null
    ) {
      return latest;
    }
    const released =
      await releaseAgentHarnessSessionApprovalResolutionBeforeDispatch({
        sessionId: latest.id,
        approvalId: input.approvalId,
        expectedStatus: latest.status,
        expectedGeneration: latest.generation,
        expectedFollowUpClaimId: latest.followUpClaimId ?? null,
      });
    if (released) {
      if (input.liveSession) {
        refreshLiveAgentHarnessSessionGeneration(
          latest.id,
          input.liveSession,
          released.generation,
        );
      }
      return released;
    }
    latest = await getAgentHarnessSessionByRunId(input.runId);
  }
  return latest;
}

export async function sendAgentHarnessFollowUp(input: {
  runId: string;
  prompt: string;
  scope: AgentHarnessOwnerScope;
  metadata?: Record<string, unknown>;
  onHarnessEvent?: (event: AgentHarnessEvent) => void | Promise<void>;
}): Promise<AgentHarnessLifecycleResult> {
  if (activeFollowUps.has(input.runId)) {
    const session = await getAgentHarnessSessionByRunId(input.runId);
    return failure(
      input.runId,
      session ?? undefined,
      "unavailable",
      session &&
        (session.status === "stopped" ||
          session.status === "errored" ||
          session.status === "destroyed")
        ? `This harness session is ${session.status} and cannot accept a follow-up.`
        : "A harness follow-up is already running.",
    );
  }
  activeFollowUps.add(input.runId);
  try {
    const prompt = input.prompt.trim();
    const stored = await getAgentHarnessSessionByRunId(input.runId);
    const scoped = checkScope(input.runId, stored, input.scope);
    if (scoped) return scoped;
    const session = stored!;
    if (!prompt) {
      return failure(
        input.runId,
        session,
        "invalid_input",
        "Follow-up prompt is required.",
      );
    }
    if (session.pendingApproval) {
      return failure(
        input.runId,
        session,
        "unavailable",
        "Resolve the pending harness approval before sending a follow-up.",
      );
    }
    if (session.status !== "idle") {
      return failure(
        input.runId,
        session,
        "unavailable",
        session.status === "running"
          ? "A harness follow-up is already running."
          : `This harness session is ${session.status} and cannot accept a follow-up.`,
      );
    }

    const claimId = randomUUID();
    const followUpId = randomUUID();
    const claimed = await claimAgentHarnessSessionFollowUp(
      session.id,
      session.generation,
      claimId,
      {
        followUpId,
        prompt,
        metadata: input.metadata,
        claimLeaseMs: FOLLOW_UP_CLAIM_LEASE_MS,
        deadlineDurationMs: FOLLOW_UP_DEADLINE_MS,
      },
    );
    if (!claimed) {
      const latest = await getAgentHarnessSessionByRunId(input.runId);
      return failure(
        input.runId,
        latest ?? session,
        "unavailable",
        latest?.status === "running"
          ? "A harness follow-up is already running."
          : "The harness session changed before the follow-up could start.",
      );
    }

    const deadlineDurationMs =
      (claimed.followUpDeadlineAt ?? 0) - claimed.updatedAt;
    if (!Number.isSafeInteger(deadlineDurationMs) || deadlineDurationMs <= 0) {
      throw new Error(
        "The AgentHarness follow-up claim has no database deadline.",
      );
    }

    const followUpAbort = new AbortController();
    let finalizing = false;
    const stopWatchingClaim = watchFollowUpClaim(
      claimed.id,
      claimId,
      followUpAbort,
      () => finalizing,
      deadlineDurationMs,
    );
    let acquired: Awaited<ReturnType<typeof acquireSession>>;
    try {
      acquired = await acquireSession(claimed, input.scope);
    } catch (error) {
      stopWatchingClaim();
      throw error;
    }
    if (!acquired.ok) {
      let latest: StoredAgentHarnessSession | null;
      try {
        latest = await markOwnedFollowUpErrored(
          claimed.id,
          claimId,
          undefined,
          "not_dispatched",
          {
            type: "error",
            error:
              acquired.result.error ?? "Harness session could not be resumed.",
            errorCode: "harness_follow_up_not_dispatched",
          },
        );
      } catch (releaseError) {
        throw new AggregateError(
          [acquired.result, releaseError],
          "Harness resume failed and its follow-up claim could not be released.",
        );
      } finally {
        stopWatchingClaim();
      }
      return { ...acquired.result, session: latest ?? acquired.result.session };
    }
    if (followUpAbort.signal.aborted) {
      let failedSession: StoredAgentHarnessSession | null = null;
      try {
        failedSession = await markOwnedFollowUpErrored(
          session.id,
          claimId,
          acquired.live.session,
          "not_dispatched",
        );
      } catch (error) {
        try {
          await stopAcquiredHarnessSession(session.id, acquired.live.session);
        } catch (stopError) {
          throw new AggregateError(
            [error, stopError],
            "Harness follow-up acquisition was interrupted and cleanup was incomplete.",
          );
        }
        throw error;
      } finally {
        stopWatchingClaim();
      }
      if (!failedSession) {
        await stopAcquiredHarnessSession(session.id, acquired.live.session);
      }
      const latest =
        failedSession ?? (await getAgentHarnessSessionByRunId(input.runId));
      return failure(
        input.runId,
        latest ?? session,
        "unavailable",
        "The harness follow-up claim changed while its session was being acquired.",
      );
    }
    const events: AgentHarnessEvent[] = [];
    let iteratorClosePromise: Promise<unknown> | undefined;
    let providerDispatchStarted = false;
    let activeRun: StartedRun | undefined;
    try {
      const dispatchIntent = await markAgentHarnessSessionFollowUpDispatched(
        session.id,
        claimed.generation,
        claimId,
      );
      if (!dispatchIntent) {
        throw new AgentHarnessSessionConflictError(session.id);
      }
      refreshLiveAgentHarnessSessionGeneration(
        session.id,
        acquired.live.session,
        dispatchIntent.generation,
      );
      let dispatchGeneration = dispatchIntent.generation;
      let continuingNativeTurn = false;
      let physicalRunId = followUpId;
      let softTimeoutDeadlineAt: number | undefined;
      const followUpRunOptions = agentHarnessFollowUpRunOptions(
        session.runPolicy,
      );
      const followUpSoftTimeoutMs = followUpRunOptions.softTimeoutMs ?? 0;
      for (;;) {
        if (isAbortRequested(followUpAbort.signal)) {
          throw (
            followUpAbort.signal.reason ??
            new AgentHarnessSessionConflictError(session.id)
          );
        }
        let firstDispatchResolved = false;
        const checkpointState = { attempted: false, available: false };
        let runFailure: unknown;
        let resolveFirstDispatch!: (run: StartedRun) => void;
        let rejectFirstDispatch!: (error: unknown) => void;
        const firstDispatch = new Promise<StartedRun>((resolve, reject) => {
          resolveFirstDispatch = resolve;
          rejectFirstDispatch = reject;
        });
        void firstDispatch.catch(() => {});
        const persistNativeCheckpoint = async (): Promise<boolean> => {
          if (checkpointState.attempted) return checkpointState.available;
          checkpointState.attempted = true;
          const resumeState = await acquired.live.session.checkpoint?.();
          if (resumeState === undefined) return false;
          const checkpointed = await updateAgentHarnessSessionIfFollowUpClaim(
            session.id,
            claimId,
            { resumeState },
            { allowCurrentApprovalResolution: true },
          );
          if (!checkpointed) {
            throw new AgentHarnessSessionConflictError(session.id);
          }
          refreshLiveAgentHarnessSessionGeneration(
            session.id,
            acquired.live.session,
            checkpointed.generation,
          );
          dispatchGeneration = checkpointed.generation;
          checkpointState.available = true;
          return true;
        };

        const abortActiveRun = () => {
          if (activeRun && !activeRun.abort.signal.aborted) {
            activeRun.abort.abort(followUpAbort.signal.reason);
          }
        };
        followUpAbort.signal.addEventListener("abort", abortActiveRun, {
          once: true,
        });
        try {
          const dispatch = await startAgentHarnessSessionFollowUpDispatch(
            session.id,
            dispatchGeneration,
            claimId,
            () => {
              try {
                if (
                  softTimeoutDeadlineAt === undefined &&
                  followUpSoftTimeoutMs > 0
                ) {
                  softTimeoutDeadlineAt = Date.now() + followUpSoftTimeoutMs;
                }
                const started = startRun(
                  physicalRunId,
                  session.threadId,
                  async (send, _signal, control) => {
                    const runControl: RunChunkControl = control;
                    try {
                      await driveAgentHarnessTurnChunks({
                        session: acquired.live.session,
                        ...(continuingNativeTurn
                          ? {}
                          : {
                              input: {
                                prompt,
                                ...(input.metadata === undefined
                                  ? {}
                                  : { metadata: input.metadata }),
                              },
                            }),
                        control: runControl,
                        consume: async (stream) => {
                          const iterator = stream[Symbol.asyncIterator]();
                          const firstNext = nextHarnessEvent(
                            iterator,
                            runControl.chunkSignal,
                          );
                          void firstNext.catch(() => {});
                          providerDispatchStarted = true;
                          if (!firstDispatchResolved) {
                            firstDispatchResolved = true;
                            if (activeRun) resolveFirstDispatch(activeRun);
                          }

                          try {
                            await consumeEvents(
                              stream,
                              events,
                              input.onHarnessEvent,
                              session.id,
                              {
                                followUpClaimId: claimId,
                                abortSignal: runControl.chunkSignal,
                                firstNext,
                                iterator,
                                liveSession: acquired.live.session,
                                allowCurrentApprovalResolution: true,
                                persistEvent: async (event) => {
                                  for (const chatEvent of agentHarnessEventToAgentChatEvents(
                                    event,
                                  )) {
                                    await persistAgentHarnessFollowUpEvent(
                                      session.id,
                                      followUpId,
                                      claimId,
                                      chatEvent,
                                    );
                                    await send(chatEvent);
                                  }
                                },
                                onAbortIteratorClose: (closePromise) => {
                                  iteratorClosePromise = closePromise;
                                  void closePromise.catch(() => {});
                                },
                              },
                            );
                            return;
                          } catch (error) {
                            if (followUpAbort.signal.aborted) {
                              runFailure = error;
                              throw error;
                            }
                            if (isAbortRequested(runControl.turnSignal)) {
                              await persistNativeCheckpoint();
                              return "stop";
                            }
                            if (!runControl.chunkBoundaryReason()) {
                              runFailure = error;
                              throw error;
                            }
                          }

                          if (isAbortRequested(runControl.turnSignal)) {
                            if (isAbortRequested(followUpAbort.signal)) {
                              throw (
                                followUpAbort.signal.reason ??
                                new AgentHarnessSessionConflictError(session.id)
                              );
                            }
                            await persistNativeCheckpoint();
                            return "stop";
                          }
                        },
                        afterStream: async () => {
                          if (isAbortRequested(runControl.turnSignal)) {
                            if (isAbortRequested(followUpAbort.signal)) {
                              throw (
                                followUpAbort.signal.reason ??
                                new AgentHarnessSessionConflictError(session.id)
                              );
                            }
                            await persistNativeCheckpoint();
                            return "stop";
                          }
                          const latest = await getAgentHarnessSessionByRunId(
                            input.runId,
                          );
                          const pending = asPendingApproval(
                            latest?.pendingApproval,
                          );
                          if (
                            pending &&
                            !latest?.resolvedApprovalIds?.includes(pending.id)
                          ) {
                            return "stop";
                          }
                          if (
                            runControl.chunkBoundaryReason() &&
                            acquired.live.session.continueTurn &&
                            iteratorClosePromise
                          ) {
                            await iteratorClosePromise;
                            iteratorClosePromise = undefined;
                          }
                          return;
                        },
                      });
                    } catch (error) {
                      runFailure ??= error;
                      throw error;
                    }
                  },
                  undefined,
                  {
                    ...followUpRunOptions,
                    ...(softTimeoutDeadlineAt === undefined
                      ? {}
                      : { softTimeoutDeadlineAt }),
                    turnId: followUpId,
                    parentId: input.runId,
                  },
                );
                activeRun = started;
                void started.finalized.then(() => {
                  if (!firstDispatchResolved) {
                    rejectFirstDispatch(
                      new Error(
                        "The AgentHarness follow-up run ended before provider dispatch.",
                      ),
                    );
                  }
                }, rejectFirstDispatch);
                if (followUpAbort.signal.aborted) abortActiveRun();
                return firstDispatch;
              } catch (error) {
                rejectFirstDispatch(error);
                throw error;
              }
            },
          );
          if (!dispatch) {
            throw new AgentHarnessSessionConflictError(session.id);
          }
          activeRun = dispatch.started;
          dispatchGeneration = dispatch.session.generation;
          refreshLiveAgentHarnessSessionGeneration(
            session.id,
            acquired.live.session,
            dispatch.session.generation,
          );
          if (isAbortRequested(followUpAbort.signal)) abortActiveRun();
          await activeRun.finalized;
        } finally {
          followUpAbort.signal.removeEventListener("abort", abortActiveRun);
        }

        if (isAbortRequested(followUpAbort.signal)) {
          throw (
            followUpAbort.signal.reason ??
            new AgentHarnessSessionConflictError(session.id)
          );
        }
        if (activeRun.status === "errored") {
          if (runFailure instanceof Error) throw runFailure;
          throw new Error("The AgentHarness follow-up run failed.", {
            cause: runFailure,
          });
        }
        if (activeRun.status === "aborted") {
          throw new Error(
            `The AgentHarness follow-up run was aborted${activeRun.abortReason ? `: ${activeRun.abortReason}` : "."}`,
          );
        }
        if (activeRun.status !== "truncated") break;
        if (
          softTimeoutDeadlineAt !== undefined &&
          Date.now() >= softTimeoutDeadlineAt
        ) {
          throw new Error(
            "The AgentHarness follow-up reached its soft timeout before the truncated response completed.",
          );
        }
        if (iteratorClosePromise) {
          await iteratorClosePromise;
          iteratorClosePromise = undefined;
        }
        if (!checkpointState.attempted && !(await persistNativeCheckpoint())) {
          throw new Error(
            "The AgentHarness follow-up was truncated without a resumable checkpoint.",
          );
        }
        if (!checkpointState.available) {
          throw new Error(
            "The AgentHarness follow-up was truncated without a resumable checkpoint.",
          );
        }

        const latest = await getAgentHarnessSessionByRunId(input.runId);
        if (
          !latest ||
          latest.status !== "running" ||
          latest.followUpClaimId !== claimId
        ) {
          throw new AgentHarnessSessionConflictError(session.id);
        }
        const pending = asPendingApproval(latest.pendingApproval);
        if (pending && !latest.resolvedApprovalIds?.includes(pending.id)) {
          break;
        }
        if (!acquired.live.session.continueTurn) {
          throw new Error(
            "The AgentHarness follow-up was truncated and the provider cannot continue the turn.",
          );
        }
        dispatchGeneration = latest.generation;
        continuingNativeTurn = true;
        physicalRunId = randomUUID();
      }
      if (isAbortRequested(followUpAbort.signal)) {
        throw (
          followUpAbort.signal.reason ??
          new AgentHarnessSessionConflictError(session.id)
        );
      }
      const approvalRequest = [...events]
        .reverse()
        .find(
          (
            event,
          ): event is Extract<
            AgentHarnessEvent,
            { type: "approval-request" }
          > => event.type === "approval-request",
        );
      const updated = await withSessionLock(input.runId, async () => {
        let detachedResumeState: unknown;
        let hasDetachedResumeState = false;
        finalizing = true;
        let updatedSession: StoredAgentHarnessSession | null = null;
        let expectedApprovalResolutionId: string | null = null;
        for (
          let attempt = 0;
          attempt < MAX_FOLLOW_UP_FINALIZATION_ATTEMPTS;
          attempt += 1
        ) {
          try {
            const latest = await getAgentHarnessSessionByRunId(input.runId);
            if (
              !latest ||
              latest.status !== "running" ||
              latest.followUpClaimId !== claimId
            ) {
              break;
            }
            expectedApprovalResolutionId = latest.approvalResolutionId ?? null;
            const currentApproval =
              approvalRequest &&
              !latest.resolvedApprovalIds?.includes(approvalRequest.id)
                ? approvalRequest
                : undefined;
            const persistedApproval = asPendingApproval(latest.pendingApproval);
            const pending =
              currentApproval ??
              (persistedApproval &&
              !latest.resolvedApprovalIds?.includes(persistedApproval.id)
                ? persistedApproval
                : undefined);
            let resumeState = latest.resumeState ?? session.resumeState;
            if (pending && acquired.live.session.checkpoint) {
              const checkpoint = await acquired.live.session.checkpoint();
              if (checkpoint !== undefined) resumeState = checkpoint;
            }
            if (
              !pending &&
              !latest.approvalResolutionId &&
              acquired.live.session.detach
            ) {
              if (!hasDetachedResumeState) {
                detachedResumeState = await acquired.live.session.detach();
                hasDetachedResumeState = true;
              }
              if (detachedResumeState !== undefined) {
                resumeState = detachedResumeState;
              }
            }
            updatedSession = await finalizeAgentHarnessSessionFollowUp({
              sessionId: session.id,
              followUpId,
              claimId,
              expectedGeneration: latest.generation,
              expectedApprovalResolutionId,
              resumeState,
              pendingApproval: pending ?? null,
            });
            if (updatedSession) {
              refreshLiveAgentHarnessSessionGeneration(
                session.id,
                acquired.live.session,
                updatedSession.generation,
              );
            }
            if (!updatedSession) {
              const latest = await getAgentHarnessSessionByRunId(input.runId);
              if (
                latest?.status === "running" &&
                latest.followUpClaimId === claimId
              ) {
                expectedApprovalResolutionId =
                  latest.approvalResolutionId ?? null;
                if (attempt + 1 < MAX_FOLLOW_UP_FINALIZATION_ATTEMPTS) {
                  continue;
                }
              }
            }
            break;
          } catch (error) {
            if (!isAgentHarnessSessionConflictError(error)) throw error;
            const current = await getAgentHarnessSessionByRunId(input.runId);
            if (
              current?.status === "running" &&
              current.followUpClaimId === claimId
            ) {
              if (attempt + 1 < MAX_FOLLOW_UP_FINALIZATION_ATTEMPTS) continue;
              throw error;
            }
            return failure(
              input.runId,
              current ?? session,
              current ? "unavailable" : "not_found",
              current
                ? "The harness follow-up no longer owns the active session claim."
                : "Harness session disappeared before the follow-up completed.",
            );
          }
        }
        if (!updatedSession) {
          const current = await getAgentHarnessSessionByRunId(input.runId);
          return failure(
            input.runId,
            current ?? session,
            current ? "unavailable" : "not_found",
            current
              ? "The harness follow-up no longer owns the active session claim."
              : "Harness session disappeared before the follow-up completed.",
          );
        }
        if (!asPendingApproval(updatedSession.pendingApproval)) {
          releaseLiveAgentHarnessSession(session.id, acquired.live.session);
        }
        return {
          ok: true,
          runId: input.runId,
          session: updatedSession,
          events,
          rehydrated: acquired.rehydrated,
        } satisfies AgentHarnessLifecycleResult;
      });
      stopWatchingClaim();
      if (!updated) {
        return failure(
          input.runId,
          session,
          "unavailable",
          "The harness follow-up was interrupted before its final state could be saved.",
        );
      }
      if (!updated.ok) {
        if (
          updated.session?.status === "idle" ||
          updated.session?.status === "stopped" ||
          updated.session?.status === "errored" ||
          updated.session?.status === "destroyed"
        ) {
          await stopAcquiredHarnessSession(session.id, acquired.live.session);
        }
        return updated;
      }
      return updated;
    } catch (error) {
      stopWatchingClaim();
      if (followUpAbort.signal.aborted) {
        const reason = followUpAbort.signal.reason;
        if (isAgentHarnessSessionConflictError(reason)) {
          const latest = await getAgentHarnessSessionByRunId(input.runId);
          const cleanupErrors: unknown[] = [];
          if (
            !latest ||
            (latest.status === "idle" && latest.followUpClaimId == null) ||
            latest.status === "stopped" ||
            latest.status === "errored" ||
            latest.status === "destroyed"
          ) {
            try {
              await stopAcquiredHarnessSession(
                session.id,
                acquired.live.session,
              );
            } catch (stopError) {
              cleanupErrors.push(stopError);
            }
          }
          if (iteratorClosePromise) {
            try {
              await iteratorClosePromise;
            } catch (closeError) {
              cleanupErrors.push(closeError);
            }
          }
          if (cleanupErrors.length > 0) {
            throw new AggregateError(
              [reason ?? error, ...cleanupErrors],
              "Harness follow-up was interrupted and stream cleanup was incomplete.",
            );
          }
          return failure(
            input.runId,
            latest ?? session,
            "unavailable",
            "The harness follow-up was interrupted because its session claim changed or stopped.",
          );
        }

        const failures: unknown[] = [reason ?? error];
        let failedSession: StoredAgentHarnessSession | null = null;
        try {
          failedSession = await markOwnedFollowUpErrored(
            session.id,
            claimId,
            acquired.live.session,
            providerDispatchStarted ? "unknown" : "not_dispatched",
          );
        } catch (persistError) {
          failures.push(persistError);
        }
        if (failedSession && providerDispatchStarted) {
          try {
            await stopAcquiredHarnessSession(session.id, acquired.live.session);
          } catch (stopError) {
            failures.push(stopError);
          }
        }
        if (iteratorClosePromise) {
          try {
            await iteratorClosePromise;
          } catch (closeError) {
            failures.push(closeError);
          }
        }
        if (failures.length > 1) {
          throw new AggregateError(
            failures,
            "Harness follow-up claim monitoring failed and cleanup was incomplete.",
          );
        }
        const latest =
          failedSession ?? (await getAgentHarnessSessionByRunId(input.runId));
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          "The harness follow-up was stopped because its session claim could not be verified.",
        );
      }
      if (isAgentHarnessSessionConflictError(error)) {
        let latest = await getAgentHarnessSessionByRunId(input.runId);
        let retryableAdmissionFailure = false;
        if (
          latest?.status === "running" &&
          latest.followUpClaimId === claimId
        ) {
          let failedSession: StoredAgentHarnessSession | null;
          try {
            failedSession = await markOwnedFollowUpErrored(
              session.id,
              claimId,
              acquired.live.session,
              providerDispatchStarted ? "unknown" : "not_dispatched",
            );
            retryableAdmissionFailure = Boolean(
              failedSession && !providerDispatchStarted,
            );
          } catch (cleanupError) {
            const failures: unknown[] = [error, cleanupError];
            throw new AggregateError(
              failures,
              "Harness follow-up conflict cleanup was incomplete.",
            );
          }
          if (failedSession && providerDispatchStarted) {
            try {
              await stopAcquiredHarnessSession(
                session.id,
                acquired.live.session,
              );
            } catch (stopError) {
              throw new AggregateError(
                [error, stopError],
                "Harness follow-up conflict cleanup was incomplete.",
              );
            }
            return failure(
              input.runId,
              failedSession,
              "unavailable",
              "The harness follow-up failed after a same-claim session update.",
            );
          }
          latest = await getAgentHarnessSessionByRunId(input.runId);
        }
        if (
          !retryableAdmissionFailure &&
          (!latest ||
            (latest.status === "idle" && latest.followUpClaimId == null) ||
            latest.status === "stopped" ||
            latest.status === "errored" ||
            latest.status === "destroyed")
        ) {
          await stopAcquiredHarnessSession(session.id, acquired.live.session);
        }
        return failure(
          input.runId,
          latest ?? session,
          "unavailable",
          "The harness session changed during the follow-up; its latest state was preserved.",
        );
      }
      const failures: unknown[] = [error];
      let failedSession: StoredAgentHarnessSession | null = null;
      try {
        failedSession = await markOwnedFollowUpErrored(
          session.id,
          claimId,
          acquired.live.session,
          providerDispatchStarted ? "unknown" : "not_dispatched",
        );
      } catch (persistError) {
        failures.push(persistError);
      }
      if (failedSession && providerDispatchStarted) {
        try {
          await stopAcquiredHarnessSession(session.id, acquired.live.session);
        } catch (stopError) {
          failures.push(stopError);
        }
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          "Harness follow-up failed and cleanup was incomplete.",
        );
      }
      throw error;
    }
  } finally {
    activeFollowUps.delete(input.runId);
  }
}

export async function stopLiveAgentHarnessSession(input: {
  sessionId: string;
  scope: AgentHarnessOwnerScope;
}): Promise<boolean> {
  const live = ownedLiveSession(input.sessionId, input.scope);
  if (!live) return false;
  if (live.session.stop) await live.session.stop();
  else await live.session.destroy?.();
  releaseLiveAgentHarnessSession(input.sessionId, live.session);
  return true;
}

export async function stopAndPersistAgentHarnessSession(input: {
  sessionId: string;
  scope: AgentHarnessOwnerScope;
  status: "stopped" | "errored";
}): Promise<StoredAgentHarnessSession | null> {
  let stopped: StoredAgentHarnessSession | null;
  try {
    stopped = await markAgentHarnessSessionStopped(
      input.sessionId,
      input.status,
    );
  } catch (persistError) {
    try {
      await stopLiveAgentHarnessSession(input);
    } catch (stopError) {
      throw new AggregateError(
        [persistError, stopError],
        "Harness stop persistence and provider teardown failed.",
      );
    }
    throw persistError;
  }
  if (stopped) {
    refreshLiveAgentHarnessSessionGenerationById(
      input.sessionId,
      stopped.generation,
    );
  }

  try {
    await stopLiveAgentHarnessSession(input);
  } catch (stopError) {
    if (input.status !== "errored") {
      try {
        const errored = await markAgentHarnessSessionStopped(
          input.sessionId,
          "errored",
        );
        if (errored) {
          refreshLiveAgentHarnessSessionGenerationById(
            input.sessionId,
            errored.generation,
          );
        }
      } catch (persistError) {
        throw new AggregateError(
          [stopError, persistError],
          "Harness teardown failed and its errored state could not be persisted.",
        );
      }
    }
    throw stopError;
  }

  return stopped;
}

export async function sweepExpiredAgentHarnessSessions(
  now = Date.now(),
): Promise<number> {
  let removed = 0;
  const failures: unknown[] = [];
  for (const [sessionId, live] of liveSessions) {
    if (
      live.expiresAt > now ||
      live.approvalResolutionInProgress ||
      live.expiryCleanupInProgress
    ) {
      continue;
    }
    let stopped: StoredAgentHarnessSession | null = null;
    try {
      const current = await getAgentHarnessSession(sessionId);
      // Approval can claim this live session while the read is in flight.
      if (live.approvalResolutionInProgress) continue;
      if (!current) {
        if (live.session.stop) await live.session.stop();
        else await live.session.destroy?.();
        releaseLiveAgentHarnessSession(sessionId, live.session);
        removed += 1;
        continue;
      }
      if (current.followUpClaimId != null) continue;
      if (current.generation !== live.generation) {
        if (
          !(await detachStaleLiveSession(
            sessionId,
            live,
            current.status,
            current.generation,
          ))
        ) {
          continue;
        }
        releaseLiveAgentHarnessSession(sessionId, live.session);
        removed += 1;
        continue;
      }
      stopped = await markAgentHarnessSessionStoppedIfUnclaimed(
        sessionId,
        current.status,
        live.generation,
        current.status === "errored" || current.status === "destroyed"
          ? current.status
          : "stopped",
      );
      if (!stopped) {
        const latest = await getAgentHarnessSession(sessionId);
        if (live.approvalResolutionInProgress) continue;
        if (!latest) {
          if (live.session.stop) await live.session.stop();
          else await live.session.destroy?.();
          releaseLiveAgentHarnessSession(sessionId, live.session);
          removed += 1;
          continue;
        }
        if (latest.followUpClaimId != null) continue;
        if (latest.generation !== live.generation) {
          if (
            !(await detachStaleLiveSession(
              sessionId,
              live,
              latest.status,
              latest.generation,
            ))
          ) {
            continue;
          }
          releaseLiveAgentHarnessSession(sessionId, live.session);
          removed += 1;
          continue;
        }
        continue;
      }
      refreshLiveAgentHarnessSessionGeneration(
        sessionId,
        live.session,
        stopped.generation,
      );
      if (live.session.stop) await live.session.stop();
      else await live.session.destroy?.();
      releaseLiveAgentHarnessSession(sessionId, live.session);
      removed += 1;
    } catch (teardownError) {
      if (stopped?.status === "stopped") {
        try {
          const errored = await markAgentHarnessSessionStoppedIfUnclaimed(
            sessionId,
            "stopped",
            stopped.generation,
            "errored",
          );
          if (errored) {
            refreshLiveAgentHarnessSessionGeneration(
              sessionId,
              live.session,
              errored.generation,
            );
          } else {
            const latest = await getAgentHarnessSession(sessionId);
            if (
              latest?.status === "stopped" &&
              latest.generation === stopped.generation &&
              latest.followUpClaimId == null
            ) {
              failures.push(
                new AggregateError(
                  [
                    teardownError,
                    new AgentHarnessSessionConflictError(sessionId),
                  ],
                  "Expired harness provider teardown failed and its state could not be updated.",
                ),
              );
              continue;
            }
          }
        } catch (persistError) {
          failures.push(
            new AggregateError(
              [teardownError, persistError],
              "Expired harness provider teardown and error-state persistence both failed.",
            ),
          );
          continue;
        }
      }
      failures.push(teardownError);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Expired harness session cleanup was incomplete.",
    );
  }
  return removed;
}

export async function sweepExpiredAgentHarnessFollowUps(
  limit = 50,
): Promise<{ recovered: number; truncated: boolean }> {
  const candidates = await listExpiredAgentHarnessFollowUps(limit);
  let recovered = 0;
  const failures: unknown[] = [];
  for (const session of candidates) {
    if (!session.followUpClaimId) continue;
    try {
      const reconciled = await reconcileExpiredAgentHarnessFollowUp(
        session.id,
        session.followUpClaimId,
        session.generation,
      );
      if (reconciled) recovered += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more expired AgentHarness follow-ups could not be recovered.",
    );
  }
  return { recovered, truncated: candidates.length >= limit };
}

export async function sweepExpiredAgentHarnessApprovalResolutions(
  limit = 50,
): Promise<{ recovered: number; truncated: boolean }> {
  const candidates = await listExpiredAgentHarnessApprovalResolutions(limit);
  let recovered = 0;
  const failures: unknown[] = [];
  for (const session of candidates) {
    if (!session.approvalResolutionId) continue;
    try {
      const reconciled = await reconcileExpiredAgentHarnessApprovalResolution(
        session.id,
        session.approvalResolutionId,
        session.generation,
      );
      if (reconciled) recovered += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more expired AgentHarness approvals could not be recovered.",
    );
  }
  return { recovered, truncated: candidates.length >= limit };
}

async function acquireSession(
  stored: StoredAgentHarnessSession,
  scope: AgentHarnessOwnerScope,
): Promise<
  | { ok: true; live: LiveAgentHarnessSession; rehydrated: boolean }
  | { ok: false; result: AgentHarnessLifecycleResult }
> {
  const existing = ownedLiveSession(stored.id, scope);
  if (existing) {
    if (existing.expiryCleanupInProgress) {
      return {
        ok: false,
        result: failure(
          stored.runId ?? stored.id,
          stored,
          "unavailable",
          "The live harness session is being cleaned up and cannot accept a follow-up.",
        ),
      };
    }
    existing.generation = Math.max(existing.generation, stored.generation);
    existing.expiresAt = Date.now() + LIVE_SESSION_TTL_MS;
    return { ok: true, live: existing, rehydrated: false };
  }
  if (stored.resumeState === undefined || stored.resumeState === null) {
    return {
      ok: false,
      result: failure(
        stored.runId ?? stored.id,
        stored,
        "unavailable",
        `Harness ${stored.harnessName} has no persisted resume state.`,
      ),
    };
  }

  let adapter: AgentHarnessAdapter;
  try {
    adapter = resolveAgentHarness(stored.harnessName);
  } catch (error) {
    return {
      ok: false,
      result: failure(
        stored.runId ?? stored.id,
        stored,
        "unavailable",
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  if (!adapter.capabilities.resumable) {
    return {
      ok: false,
      result: failure(
        stored.runId ?? stored.id,
        stored,
        "unavailable",
        `Harness ${stored.harnessName} does not support resumable sessions.`,
      ),
    };
  }
  try {
    const native = await adapter.createSession({
      sessionId: stored.id,
      threadId: stored.threadId,
      runId: stored.runId ?? undefined,
      resumeState: stored.resumeState,
      ownerEmail: stored.ownerEmail,
      orgId: stored.orgId,
    });
    registerLiveAgentHarnessSession({
      sessionId: stored.id,
      adapter,
      session: native,
      createSession: { resumeState: stored.resumeState },
      ownerEmail: stored.ownerEmail,
      orgId: stored.orgId,
      generation: stored.generation,
    });
    return {
      ok: true,
      live: liveSessions.get(stored.id)!,
      rehydrated: true,
    };
  } catch (error) {
    return {
      ok: false,
      result: failure(
        stored.runId ?? stored.id,
        stored,
        "unavailable",
        `Harness session could not be resumed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
}

async function consumeEvents(
  stream: AsyncIterable<AgentHarnessEvent>,
  events: AgentHarnessEvent[],
  onHarnessEvent:
    | ((event: AgentHarnessEvent) => void | Promise<void>)
    | undefined,
  sessionId: string,
  options?: {
    abortSignal?: AbortSignal;
    approvalResolutionId?: string;
    approvalResolutionStatus?: AgentHarnessSessionStatus;
    firstNext?: Promise<IteratorResult<AgentHarnessEvent>>;
    followUpClaimId?: string;
    allowCurrentApprovalResolution?: boolean;
    persistEvent?: (event: AgentHarnessEvent) => void | Promise<void>;
    iterator?: AsyncIterator<AgentHarnessEvent>;
    liveSession?: AgentHarnessSession;
    onAbortIteratorClose?: (closePromise: Promise<unknown>) => void;
  },
): Promise<void> {
  const iterator = options?.iterator ?? stream[Symbol.asyncIterator]();
  let firstNext = options?.firstNext;
  try {
    while (true) {
      const next = await (firstNext ??
        nextHarnessEvent(iterator, options?.abortSignal));
      firstNext = undefined;
      if (next.done) return;
      const event = next.value;
      events.push(event);
      if (event.type === "approval-request") {
        const updated = options?.followUpClaimId
          ? await updateAgentHarnessSessionIfFollowUpClaim(
              sessionId,
              options.followUpClaimId,
              { pendingApproval: event },
              {
                expectedApprovalResolutionId: options.approvalResolutionId,
                allowCurrentApprovalResolution:
                  options.allowCurrentApprovalResolution,
              },
            )
          : options?.approvalResolutionId !== undefined
            ? await updateApprovalContinuationPending(
                sessionId,
                options.approvalResolutionId,
                options.approvalResolutionStatus,
                options.liveSession,
                event,
              )
            : await updateAgentHarnessSession(sessionId, {
                pendingApproval: event,
              });
        if (
          (options?.followUpClaimId ||
            options?.approvalResolutionId !== undefined) &&
          !updated
        ) {
          throw new AgentHarnessSessionConflictError(sessionId);
        }
        if (updated && options?.liveSession) {
          refreshLiveAgentHarnessSessionGeneration(
            sessionId,
            options.liveSession,
            updated.generation,
          );
        }
      }
      await options?.persistEvent?.(event);
      await onHarnessEvent?.(event);
      if (event.type === "error") throw new Error(event.error);
    }
  } catch (error) {
    if (options?.abortSignal?.aborted) {
      const closePromise = Promise.resolve(iterator.return?.());
      if (options.onAbortIteratorClose) {
        options.onAbortIteratorClose(closePromise);
      } else {
        await closePromise;
      }
    } else {
      try {
        await iterator.return?.();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          "Harness stream failed and its iterator could not be closed.",
        );
      }
    }
    throw error;
  }
}

function nextHarnessEvent(
  iterator: AsyncIterator<AgentHarnessEvent>,
  signal?: AbortSignal,
): Promise<IteratorResult<AgentHarnessEvent>> {
  if (!signal) return iterator.next();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const removeAbortListener = () =>
      signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      removeAbortListener();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    let next: Promise<IteratorResult<AgentHarnessEvent>>;
    try {
      next = iterator.next();
    } catch (error) {
      removeAbortListener();
      reject(error);
      return;
    }
    next.then(
      (next) => {
        removeAbortListener();
        resolve(next);
      },
      (error) => {
        removeAbortListener();
        reject(error);
      },
    );
  });
}

function watchFollowUpClaim(
  sessionId: string,
  claimId: string,
  controller: AbortController,
  isFinalizing: () => boolean,
  deadlineDurationMs: number,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const readErrors: unknown[] = [];
  const deadlineAt = performance.now() + deadlineDurationMs;
  let renewAt = performance.now() + FOLLOW_UP_CLAIM_RENEW_INTERVAL_MS;
  const schedule = () => {
    if (!stopped && !controller.signal.aborted) {
      timer = setTimeout(() => void check(), FOLLOW_UP_CLAIM_POLL_INTERVAL_MS);
    }
  };
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  const check = async () => {
    try {
      const current = await getAgentHarnessSession(sessionId);
      if (stopped) return;
      readErrors.length = 0;
      const now = performance.now();
      if (now >= deadlineAt) {
        controller.abort(
          new Error(
            "The AgentHarness follow-up reached its persisted deadline.",
          ),
        );
        return;
      }
      if (
        current?.status === "idle" &&
        current.followUpClaimId == null &&
        isFinalizing()
      ) {
        stop();
        return;
      }
      if (
        current?.status !== "running" ||
        current.followUpClaimId !== claimId
      ) {
        controller.abort(new AgentHarnessSessionConflictError(sessionId));
        return;
      }
      if (now >= renewAt) {
        const renewed = await renewAgentHarnessSessionFollowUpClaim(
          sessionId,
          claimId,
          FOLLOW_UP_CLAIM_LEASE_MS,
        );
        if (!renewed) {
          controller.abort(new AgentHarnessSessionConflictError(sessionId));
          return;
        }
        renewAt = performance.now() + FOLLOW_UP_CLAIM_RENEW_INTERVAL_MS;
      }
    } catch (error) {
      if (stopped) return;
      readErrors.push(error);
      if (readErrors.length >= 3) {
        controller.abort(
          new AggregateError(
            readErrors,
            "Could not verify the harness follow-up claim after repeated reads.",
          ),
        );
      } else {
        schedule();
      }
      return;
    }
    schedule();
  };
  schedule();
  return stop;
}

function watchApprovalResolutionClaim(
  sessionId: string,
  approvalId: string,
  controller: AbortController,
  isFinalizing: () => boolean,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const readErrors: unknown[] = [];
  let renewAt = Date.now() + APPROVAL_CLAIM_RENEW_INTERVAL_MS;
  const schedule = () => {
    if (!stopped && !controller.signal.aborted) {
      timer = setTimeout(() => void check(), APPROVAL_CLAIM_POLL_INTERVAL_MS);
    }
  };
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  const check = async () => {
    try {
      const current = await getAgentHarnessSession(sessionId);
      if (stopped) return;
      readErrors.length = 0;
      if (current?.approvalResolutionId == null && isFinalizing()) {
        stop();
        return;
      }
      if (
        current?.approvalResolutionId !== approvalId ||
        current.status === "stopped" ||
        current.status === "errored" ||
        current.status === "destroyed"
      ) {
        controller.abort(new AgentHarnessSessionConflictError(sessionId));
        return;
      }
      const now = Date.now();
      if (now >= renewAt) {
        const renewed = await renewAgentHarnessSessionApprovalResolutionClaim(
          sessionId,
          approvalId,
        );
        if (!renewed) {
          controller.abort(new AgentHarnessSessionConflictError(sessionId));
          return;
        }
        renewAt = now + APPROVAL_CLAIM_RENEW_INTERVAL_MS;
      }
    } catch (error) {
      if (stopped) return;
      readErrors.push(error);
      if (readErrors.length >= 3) {
        controller.abort(
          new AggregateError(
            readErrors,
            "Could not verify the AgentHarness approval claim after repeated reads.",
          ),
        );
      } else {
        schedule();
      }
      return;
    }
    schedule();
  };
  schedule();
  return stop;
}

async function stopAcquiredHarnessSession(
  sessionId: string,
  session: AgentHarnessSession,
): Promise<void> {
  if (liveSessions.get(sessionId)?.session !== session) return;
  if (session.stop) await session.stop();
  else await session.destroy?.();
  releaseLiveAgentHarnessSession(sessionId, session);
}

async function markOwnedFollowUpErrored(
  sessionId: string,
  claimId: string,
  liveSession: AgentHarnessSession | undefined,
  outcome: "not_dispatched" | "unknown",
  errorEvent?: Extract<AgentChatEvent, { type: "error" }>,
): Promise<StoredAgentHarnessSession | null> {
  const errors: unknown[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const updated = await failAgentHarnessSessionFollowUp({
        sessionId,
        claimId,
        outcome,
        errorEvent,
      });
      if (updated) {
        if (liveSession) {
          refreshLiveAgentHarnessSessionGeneration(
            sessionId,
            liveSession,
            updated.generation,
          );
        }
        return updated;
      }
      return null;
    } catch (error) {
      errors.push(error);
      const latest = await getAgentHarnessSession(sessionId);
      if (
        !latest ||
        latest.status !== "running" ||
        latest.followUpClaimId !== claimId
      ) {
        return latest;
      }
    }
  }
  throw new AggregateError(
    errors,
    "Could not persist and release the harness follow-up failure.",
  );
}

async function updateApprovalContinuationPending(
  sessionId: string,
  approvalResolutionId: string,
  expectedStatus: AgentHarnessSessionStatus | undefined,
  liveSession: AgentHarnessSession | undefined,
  event: Extract<AgentHarnessEvent, { type: "approval-request" }>,
): Promise<StoredAgentHarnessSession | null> {
  if (!expectedStatus || !liveSession) return null;
  const liveGeneration = getLiveAgentHarnessSessionGeneration(
    sessionId,
    liveSession,
  );
  if (liveGeneration === null) return null;
  const current = await getAgentHarnessSession(sessionId);
  if (
    !current ||
    current.status === "stopped" ||
    current.status === "errored" ||
    current.status === "destroyed" ||
    current.approvalResolutionId !== approvalResolutionId
  ) {
    return null;
  }
  return updateAgentHarnessSessionAtGeneration(
    sessionId,
    current.status,
    current.generation,
    { pendingApproval: event },
    current.followUpClaimId ?? undefined,
    {
      expectedApprovalResolutionId: approvalResolutionId,
      requiresActiveApprovalResolution: true,
    },
  );
}

function checkScope(
  runId: string,
  stored: StoredAgentHarnessSession | null,
  scope: AgentHarnessOwnerScope,
): AgentHarnessLifecycleResult | null {
  if (!stored) {
    return failure(runId, undefined, "not_found", "Harness run not found.");
  }
  if (
    stored.ownerEmail !== scope.ownerEmail ||
    (scope.orgId !== undefined && stored.orgId !== scope.orgId)
  ) {
    return failure(
      runId,
      undefined,
      "owner_mismatch",
      "Harness run is not available for this owner.",
    );
  }
  return null;
}

function ownedLiveSession(
  sessionId: string,
  scope: AgentHarnessOwnerScope,
): LiveAgentHarnessSession | undefined {
  const live = liveSessions.get(sessionId);
  if (!live) return undefined;
  if (
    live.ownerEmail !== scope.ownerEmail ||
    (scope.orgId !== undefined && live.orgId !== scope.orgId)
  ) {
    return undefined;
  }
  return live;
}

async function detachStaleLiveSession(
  sessionId: string,
  live: LiveAgentHarnessSession,
  durableStatus: AgentHarnessSessionStatus,
  expectedGeneration: number,
): Promise<boolean> {
  if (live.approvalResolutionInProgress || live.expiryCleanupInProgress) {
    return false;
  }
  live.expiryCleanupInProgress = true;
  try {
    const cleanupId = randomUUID();
    const cleanup = await startAgentHarnessSessionExpiryCleanup(
      sessionId,
      durableStatus,
      expectedGeneration,
      cleanupId,
      () => {
        if (
          durableStatus === "stopped" ||
          durableStatus === "errored" ||
          durableStatus === "destroyed"
        ) {
          const stopped = live.session.stop
            ? live.session.stop()
            : live.session.destroy?.();
          if (stopped) void stopped.catch(() => {});
          return stopped;
        }
        const detached = live.session.detach?.();
        if (detached) void detached.catch(() => {});
        return detached;
      },
    );
    if (!cleanup) return false;
    refreshLiveAgentHarnessSessionGeneration(
      sessionId,
      live.session,
      cleanup.session.generation,
    );
    try {
      await cleanup.started;
    } catch (cleanupError) {
      try {
        const released = await finishAgentHarnessSessionExpiryCleanup(
          sessionId,
          cleanupId,
          cleanup.session.generation,
        );
        if (released) {
          refreshLiveAgentHarnessSessionGeneration(
            sessionId,
            live.session,
            released.generation,
          );
        }
      } catch (releaseError) {
        throw new AggregateError(
          [cleanupError, releaseError],
          "Harness expiry cleanup and reservation release both failed.",
        );
      }
      throw cleanupError;
    }
    const released = await finishAgentHarnessSessionExpiryCleanup(
      sessionId,
      cleanupId,
      cleanup.session.generation,
    );
    if (released) {
      refreshLiveAgentHarnessSessionGeneration(
        sessionId,
        live.session,
        released.generation,
      );
    }
    return true;
  } finally {
    live.expiryCleanupInProgress = false;
  }
}

function asPendingApproval(
  value: unknown,
): Extract<AgentHarnessEvent, { type: "approval-request" }> | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<AgentHarnessEvent> & { id?: unknown };
  return event.type === "approval-request" && typeof event.id === "string"
    ? (value as Extract<AgentHarnessEvent, { type: "approval-request" }>)
    : null;
}

function failure(
  runId: string,
  session: StoredAgentHarnessSession | undefined,
  errorCode: AgentHarnessLifecycleErrorCode,
  error: string,
): AgentHarnessLifecycleResult {
  return { ok: false, runId, session, errorCode, error };
}

function withoutSignal(
  input: AgentHarnessCreateSessionOptions,
): AgentHarnessCreateSessionOptions {
  const { signal: _signal, ...rest } = input;
  return rest;
}

async function withSessionLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = sessionOperations.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  sessionOperations.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (sessionOperations.get(key) === tail) sessionOperations.delete(key);
  }
}

function scheduleCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setTimeout(() => {
    cleanupTimer = undefined;
    void sweepExpiredAgentHarnessSessions()
      .catch((error) => {
        console.error("Expired AgentHarness session cleanup failed.", error);
      })
      .finally(() => {
        if (liveSessions.size > 0) scheduleCleanup();
      });
  }, LIVE_SESSION_TTL_MS);
  cleanupTimer.unref?.();
}
