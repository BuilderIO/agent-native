import { randomUUID } from "node:crypto";

import { resolveAgentHarness } from "./registry.js";
import {
  AgentHarnessSessionConflictError,
  claimAgentHarnessSessionFollowUp,
  getAgentHarnessSession,
  getAgentHarnessSessionByRunId,
  isAgentHarnessSessionConflictError,
  markAgentHarnessSessionStoppedIfUnclaimed,
  updateAgentHarnessSession,
  updateAgentHarnessSessionAtGeneration,
  updateAgentHarnessSessionIfFollowUpClaim,
  type SaveAgentHarnessSessionInput,
  type StoredAgentHarnessSession,
} from "./store.js";
import type {
  AgentHarnessAdapter,
  AgentHarnessApproval,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
  AgentHarnessSession,
} from "./types.js";

const LIVE_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const RESOLVED_APPROVAL_LIMIT = 32;
const FOLLOW_UP_CLAIM_POLL_INTERVAL_MS = 500;
const MAX_FOLLOW_UP_FINALIZATION_ATTEMPTS = 3;

interface LiveAgentHarnessSession {
  adapter: AgentHarnessAdapter;
  session: AgentHarnessSession;
  createSession: AgentHarnessCreateSessionOptions;
  ownerEmail: string | null;
  orgId: string | null;
  expiresAt: number;
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
}): void {
  liveSessions.set(input.sessionId, {
    adapter: input.adapter,
    session: input.session,
    createSession: withoutSignal(input.createSession ?? {}),
    ownerEmail: input.ownerEmail ?? null,
    orgId: input.orgId ?? null,
    expiresAt: Date.now() + LIVE_SESSION_TTL_MS,
  });
  scheduleCleanup();
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
    if (resolvedIds.includes(input.approval.id)) {
      return {
        ok: true,
        runId: input.runId,
        session,
        idempotent: true,
      };
    }
    const pending = asPendingApproval(session.pendingApproval);
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

    const live = ownedLiveSession(session.id, input.scope);
    if (!live) {
      return failure(
        input.runId,
        session,
        "unavailable",
        "The pending approval belongs to a harness process that is no longer live and cannot be reconstructed safely.",
      );
    }

    const events: AgentHarnessEvent[] = [];
    let continued = false;
    if (live.session.approve) {
      await live.session.approve(input.approval);
    } else if (live.session.continueTurn) {
      continued = true;
      await consumeEvents(
        live.session.continueTurn({ approval: input.approval }),
        events,
        input.onHarnessEvent,
        session.id,
        {
          followUpClaimId: session.followUpClaimId ?? undefined,
        },
      );
    } else {
      return failure(
        input.runId,
        session,
        "unavailable",
        `Harness ${session.harnessName} does not expose approval continuation.`,
      );
    }

    let detachedResumeState: unknown;
    const nextPending = events.find(
      (
        event,
      ): event is Extract<AgentHarnessEvent, { type: "approval-request" }> =>
        event.type === "approval-request",
    );
    const followUpOwnsSession = Boolean(session.followUpClaimId);
    if (continued && !nextPending && !followUpOwnsSession) {
      if (live.session.detach) {
        const detached = await live.session.detach();
        if (detached !== undefined) detachedResumeState = detached;
      }
    }
    let updated: StoredAgentHarnessSession | null;
    try {
      updated = await persistResolvedApproval({
        session,
        runId: input.runId,
        approvalId: input.approval.id,
        nextPending,
        detachedResumeState,
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
        "The harness session changed while resolving approval.",
      );
    }
    if (
      continued &&
      !asPendingApproval(updated.pendingApproval) &&
      !updated.followUpClaimId
    ) {
      releaseLiveAgentHarnessSession(session.id, live.session);
    }
    return {
      ok: true,
      runId: input.runId,
      session: updated ?? session,
      events,
    };
  });
}

async function persistResolvedApproval(input: {
  session: StoredAgentHarnessSession;
  runId: string;
  approvalId: string;
  nextPending?: Extract<AgentHarnessEvent, { type: "approval-request" }>;
  detachedResumeState?: unknown;
}): Promise<StoredAgentHarnessSession | null> {
  let conflict: AgentHarnessSessionConflictError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await getAgentHarnessSessionByRunId(input.runId);
    if (!latest) return null;
    const resolvedIds = latest.resolvedApprovalIds ?? [];
    const pending = asPendingApproval(latest.pendingApproval);
    if (
      resolvedIds.includes(input.approvalId) &&
      pending?.id !== input.approvalId
    ) {
      return latest;
    }

    const pendingApproval =
      pending?.id === input.approvalId
        ? latest.status === input.session.status
          ? (input.nextPending ?? null)
          : null
        : latest.pendingApproval;
    try {
      const updated = await updateAgentHarnessSessionAtGeneration(
        latest.id,
        latest.status,
        latest.generation,
        {
          status: latest.status,
          pendingApproval,
          resolvedApprovalIds: resolvedIds.includes(input.approvalId)
            ? resolvedIds
            : [...resolvedIds, input.approvalId].slice(
                -RESOLVED_APPROVAL_LIMIT,
              ),
          ...(input.detachedResumeState !== undefined &&
          latest.generation === input.session.generation &&
          !latest.followUpClaimId
            ? { resumeState: input.detachedResumeState }
            : {}),
        },
        latest.followUpClaimId ?? undefined,
      );
      if (updated) return updated;
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
    const claimed = await claimAgentHarnessSessionFollowUp(
      session.id,
      session.generation,
      claimId,
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

    const acquired = await acquireSession(claimed, input.scope);
    if (!acquired.ok) {
      const reset = await updateOwnedFollowUpClaim(claimed.id, claimId, {
        status: "idle",
        followUpClaimId: null,
      });
      const latest =
        reset ?? (await getAgentHarnessSessionByRunId(input.runId));
      return { ...acquired.result, session: latest ?? acquired.result.session };
    }
    const events: AgentHarnessEvent[] = [];
    const followUpAbort = new AbortController();
    let finalizing = false;
    const stopWatchingClaim = watchFollowUpClaim(
      claimed.id,
      claimId,
      followUpAbort,
      () => finalizing,
    );
    try {
      const beforeDispatch = await getAgentHarnessSession(session.id);
      if (
        beforeDispatch?.status !== "running" ||
        beforeDispatch.followUpClaimId !== claimId
      ) {
        throw new AgentHarnessSessionConflictError(session.id);
      }

      await consumeEvents(
        acquired.live.session.streamTurn({
          prompt,
          metadata: input.metadata,
          abortSignal: followUpAbort.signal,
        }),
        events,
        input.onHarnessEvent,
        session.id,
        { followUpClaimId: claimId, abortSignal: followUpAbort.signal },
      );
      if (followUpAbort.signal.aborted) {
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
        for (
          let attempt = 0;
          attempt < MAX_FOLLOW_UP_FINALIZATION_ATTEMPTS;
          attempt += 1
        ) {
          try {
            updatedSession = await updateAgentHarnessSessionIfFollowUpClaim(
              session.id,
              claimId,
              async (latest) => {
                const currentApproval =
                  approvalRequest &&
                  !latest.resolvedApprovalIds?.includes(approvalRequest.id)
                    ? approvalRequest
                    : undefined;
                const persistedApproval = asPendingApproval(
                  latest.pendingApproval,
                );
                const pending =
                  currentApproval ??
                  (persistedApproval &&
                  !latest.resolvedApprovalIds?.includes(persistedApproval.id)
                    ? persistedApproval
                    : undefined);
                let resumeState = latest.resumeState ?? session.resumeState;
                if (!pending && acquired.live.session.detach) {
                  if (!hasDetachedResumeState) {
                    detachedResumeState = await acquired.live.session.detach();
                    hasDetachedResumeState = true;
                  }
                  if (detachedResumeState !== undefined) {
                    resumeState = detachedResumeState;
                  }
                }
                return {
                  status: "idle",
                  resumeState,
                  pendingApproval: pending ?? null,
                  followUpClaimId: null,
                };
              },
            );
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
          if (
            !latest ||
            (latest.status === "idle" && latest.followUpClaimId == null) ||
            latest.status === "stopped" ||
            latest.status === "errored" ||
            latest.status === "destroyed"
          ) {
            await stopAcquiredHarnessSession(session.id, acquired.live.session);
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
          failedSession = await markOwnedFollowUpErrored(session.id, claimId);
        } catch (persistError) {
          failures.push(persistError);
        }
        if (failedSession) {
          try {
            await stopAcquiredHarnessSession(session.id, acquired.live.session);
          } catch (stopError) {
            failures.push(stopError);
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
        if (
          latest?.status === "running" &&
          latest.followUpClaimId === claimId
        ) {
          let failedSession: StoredAgentHarnessSession | null;
          try {
            failedSession = await markOwnedFollowUpErrored(session.id, claimId);
          } catch (cleanupError) {
            const failures: unknown[] = [error, cleanupError];
            throw new AggregateError(
              failures,
              "Harness follow-up conflict cleanup was incomplete.",
            );
          }
          if (failedSession) {
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
          !latest ||
          (latest.status === "idle" && latest.followUpClaimId == null) ||
          latest.status === "stopped" ||
          latest.status === "errored" ||
          latest.status === "destroyed"
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
        failedSession = await markOwnedFollowUpErrored(session.id, claimId);
      } catch (persistError) {
        failures.push(persistError);
      }
      if (failedSession) {
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

export async function sweepExpiredAgentHarnessSessions(
  now = Date.now(),
): Promise<number> {
  let removed = 0;
  for (const [sessionId, live] of liveSessions) {
    if (live.expiresAt > now) continue;
    let stoppedGeneration: number | undefined;
    try {
      const current = await getAgentHarnessSession(sessionId);
      if (!current || current.followUpClaimId != null) {
        liveSessions.delete(sessionId);
        removed += 1;
        continue;
      }
      const stopped = await markAgentHarnessSessionStoppedIfUnclaimed(
        sessionId,
        current.status,
        current.generation,
        "stopped",
      );
      if (!stopped) {
        liveSessions.delete(sessionId);
        removed += 1;
        continue;
      }
      stoppedGeneration = stopped.generation;
      liveSessions.delete(sessionId);
      removed += 1;
      if (live.session.stop) await live.session.stop();
      else await live.session.destroy?.();
    } catch {
      if (stoppedGeneration !== undefined) {
        await markAgentHarnessSessionStoppedIfUnclaimed(
          sessionId,
          "stopped",
          stoppedGeneration,
          "errored",
        ).catch(() => {});
      }
    }
  }
  return removed;
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
    followUpClaimId?: string;
  },
): Promise<void> {
  const iterator = stream[Symbol.asyncIterator]();
  while (true) {
    const next = await nextHarnessEvent(iterator, options?.abortSignal);
    if (next.done) return;
    const event = next.value;
    events.push(event);
    if (event.type === "approval-request") {
      const updated = options?.followUpClaimId
        ? await updateAgentHarnessSessionIfFollowUpClaim(
            sessionId,
            options.followUpClaimId,
            { pendingApproval: event },
          )
        : await updateAgentHarnessSession(sessionId, {
            pendingApproval: event,
          });
      if (options?.followUpClaimId && !updated) {
        throw new AgentHarnessSessionConflictError(sessionId);
      }
    }
    await onHarnessEvent?.(event);
    if (event.type === "error") throw new Error(event.error);
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
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const readErrors: unknown[] = [];
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

async function stopAcquiredHarnessSession(
  sessionId: string,
  session: AgentHarnessSession,
): Promise<void> {
  if (liveSessions.get(sessionId)?.session !== session) return;
  try {
    if (session.stop) await session.stop();
    else await session.destroy?.();
  } finally {
    releaseLiveAgentHarnessSession(sessionId, session);
  }
}

async function markOwnedFollowUpErrored(
  sessionId: string,
  claimId: string,
): Promise<StoredAgentHarnessSession | null> {
  return updateOwnedFollowUpClaim(sessionId, claimId, {
    status: "errored",
    pendingApproval: null,
    followUpClaimId: null,
  });
}

async function updateOwnedFollowUpClaim(
  sessionId: string,
  claimId: string,
  patch: Partial<Omit<SaveAgentHarnessSessionInput, "id">>,
): Promise<StoredAgentHarnessSession | null> {
  let conflict: AgentHarnessSessionConflictError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const updated = await updateAgentHarnessSessionIfFollowUpClaim(
        sessionId,
        claimId,
        patch,
      );
      if (updated) return updated;
    } catch (error) {
      if (!isAgentHarnessSessionConflictError(error)) throw error;
      conflict = error;
    }

    const latest = await getAgentHarnessSession(sessionId);
    if (latest?.status !== "running" || latest.followUpClaimId !== claimId) {
      return null;
    }
  }
  throw conflict ?? new AgentHarnessSessionConflictError(sessionId);
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
    void sweepExpiredAgentHarnessSessions().finally(() => {
      if (liveSessions.size > 0) scheduleCleanup();
    });
  }, LIVE_SESSION_TTL_MS);
  cleanupTimer.unref?.();
}
