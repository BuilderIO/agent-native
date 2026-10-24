import { randomUUID } from "node:crypto";

import { resolveAgentHarness } from "./registry.js";
import {
  AgentHarnessSessionConflictError,
  claimAgentHarnessSessionFollowUp,
  getAgentHarnessSessionByRunId,
  isAgentHarnessSessionConflictError,
  markAgentHarnessSessionStopped,
  updateAgentHarnessSession,
  updateAgentHarnessSessionAtGeneration,
  updateAgentHarnessSessionIfFollowUpClaim,
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
          persistApproval: false,
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

    let resumeState = session.resumeState;
    const nextPending = events.find(
      (event) => event.type === "approval-request",
    );
    if (continued && !nextPending) {
      if (live.session.detach) {
        const detached = await live.session.detach();
        if (detached !== undefined) resumeState = detached;
      }
    }
    let updated: StoredAgentHarnessSession | null;
    try {
      updated = await updateAgentHarnessSessionAtGeneration(
        session.id,
        session.status,
        session.generation,
        {
          status: session.status,
          pendingApproval: nextPending ?? null,
          resumeState,
          resolvedApprovalIds: [...resolvedIds, input.approval.id].slice(
            -RESOLVED_APPROVAL_LIMIT,
          ),
        },
        session.followUpClaimId ?? undefined,
      );
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
      return failure(
        input.runId,
        latest ?? session,
        "unavailable",
        "The harness session changed while resolving approval.",
      );
    }
    if (continued && !nextPending) {
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
      let reset: StoredAgentHarnessSession | null = null;
      try {
        reset = await updateAgentHarnessSessionIfFollowUpClaim(
          claimed.id,
          claimId,
          { status: "idle", followUpClaimId: null },
        );
      } catch (error) {
        if (!isAgentHarnessSessionConflictError(error)) throw error;
      }
      const latest =
        reset ?? (await getAgentHarnessSessionByRunId(input.runId));
      return { ...acquired.result, session: latest ?? acquired.result.session };
    }
    const events: AgentHarnessEvent[] = [];
    try {
      await consumeEvents(
        acquired.live.session.streamTurn({
          prompt,
          metadata: input.metadata,
        }),
        events,
        input.onHarnessEvent,
        session.id,
        { followUpClaimId: claimId },
      );

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
        const latest = await getAgentHarnessSessionByRunId(input.runId);
        if (!latest) {
          return failure(
            input.runId,
            session,
            "not_found",
            "Harness session disappeared before the follow-up completed.",
          );
        }
        if (latest.status !== "running" || latest.followUpClaimId !== claimId) {
          return failure(
            input.runId,
            latest,
            "unavailable",
            "The harness follow-up no longer owns the active session claim.",
          );
        }
        const pending =
          approvalRequest &&
          !latest.resolvedApprovalIds?.includes(approvalRequest.id)
            ? approvalRequest
            : undefined;
        let resumeState = latest.resumeState ?? session.resumeState;
        if (!pending && acquired.live.session.detach) {
          const detached = await acquired.live.session.detach();
          if (detached !== undefined) resumeState = detached;
        }
        const updatedSession = await updateAgentHarnessSessionAtGeneration(
          session.id,
          "running",
          latest.generation,
          {
            status: "idle",
            resumeState,
            pendingApproval: pending ?? null,
            followUpClaimId: null,
          },
          claimId,
        );
        if (!updatedSession) {
          const current = await getAgentHarnessSessionByRunId(input.runId);
          return failure(
            input.runId,
            current ?? latest,
            "unavailable",
            "The harness follow-up was interrupted before its final state could be saved.",
          );
        }
        if (!pending) {
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
      if (!updated) {
        return failure(
          input.runId,
          session,
          "unavailable",
          "The harness follow-up was interrupted before its final state could be saved.",
        );
      }
      if (!updated.ok) return updated;
      return updated;
    } catch (error) {
      if (isAgentHarnessSessionConflictError(error)) {
        const latest = await getAgentHarnessSessionByRunId(input.runId);
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
        failedSession = await updateAgentHarnessSessionIfFollowUpClaim(
          session.id,
          claimId,
          { status: "errored", pendingApproval: null, followUpClaimId: null },
        );
      } catch (persistError) {
        if (!isAgentHarnessSessionConflictError(persistError)) {
          failures.push(persistError);
        }
      }
      if (failedSession) {
        try {
          if (acquired.live.session.stop) {
            await acquired.live.session.stop();
          } else {
            await acquired.live.session.destroy?.();
          }
        } catch (stopError) {
          failures.push(stopError);
        } finally {
          releaseLiveAgentHarnessSession(session.id, acquired.live.session);
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
    liveSessions.delete(sessionId);
    removed += 1;
    try {
      if (live.session.stop) await live.session.stop();
      else await live.session.destroy?.();
      await markAgentHarnessSessionStopped(sessionId, "stopped");
    } catch {
      await markAgentHarnessSessionStopped(sessionId, "errored").catch(
        () => {},
      );
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
  options?: { followUpClaimId?: string; persistApproval?: boolean },
): Promise<void> {
  for await (const event of stream) {
    events.push(event);
    if (event.type === "approval-request") {
      if (options?.persistApproval !== false) {
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
    }
    if (event.type === "error") throw new Error(event.error);
    await onHarnessEvent?.(event);
  }
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
