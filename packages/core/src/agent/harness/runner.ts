import type {
  ActiveRun,
  RunChunkControl,
  StartRunOptions,
} from "../run-manager.js";
import { startRun } from "../run-manager.js";
import type { AgentChatEvent } from "../types.js";
import {
  getLiveAgentHarnessSessionGeneration,
  registerLiveAgentHarnessSession,
  refreshLiveAgentHarnessSessionGeneration,
  releaseLiveAgentHarnessSession,
} from "./lifecycle.js";
import { resolveAgentHarnessRunPolicy } from "./run-policy.js";
import {
  AgentHarnessSessionConflictError,
  getAgentHarnessSession,
  isAgentHarnessSessionConflictError,
  markAgentHarnessSessionStopped,
  saveAgentHarnessSession,
  updateAgentHarnessSession,
  updateAgentHarnessSessionAtGeneration,
} from "./store.js";
import { agentHarnessEventToAgentChatEvents } from "./translate.js";
import { driveAgentHarnessTurnChunks } from "./turn-driver.js";
import type {
  AgentHarnessAdapter,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
  AgentHarnessSession,
  AgentHarnessTurnInput,
} from "./types.js";

const APPROVAL_RESOLUTION_POLL_INTERVAL_MS = 500;
const APPROVAL_RESOLUTION_TIMEOUT_MS = 30_000;

export class AgentHarnessApprovalResolutionTimeoutError extends Error {
  readonly sessionId: string;
  readonly approvalId: string;

  constructor(sessionId: string, approvalId: string, cause?: unknown) {
    super(
      `Harness approval ${approvalId} did not finish resolving before checkpointing session ${sessionId}.`,
    );
    this.name = "AgentHarnessApprovalResolutionTimeoutError";
    this.sessionId = sessionId;
    this.approvalId = approvalId;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface StartAgentHarnessRunOptions {
  runId: string;
  threadId: string;
  turnId?: string;
  adapter: AgentHarnessAdapter;
  input: AgentHarnessTurnInput;
  session?: AgentHarnessSession;
  createSession?: AgentHarnessCreateSessionOptions;
  ownerEmail?: string | null;
  orgId?: string | null;
  detachOnComplete?: boolean;
  runOptions?: StartRunOptions;
  onHarnessEvent?: (event: AgentHarnessEvent) => void | Promise<void>;
  onRunComplete?: (run: ActiveRun) => void | Promise<void>;
}

export function startAgentHarnessRun(
  opts: StartAgentHarnessRunOptions,
): ActiveRun {
  let harnessSession: AgentHarnessSession | undefined = opts.session;
  const detachOnComplete = opts.detachOnComplete !== false;
  const runOptions: StartRunOptions = {
    ...(opts.runOptions ?? {}),
    turnId: opts.turnId ?? opts.runOptions?.turnId,
    recoverChunkBoundaries: opts.runOptions?.recoverChunkBoundaries ?? true,
    useHostedSoftTimeoutDefault:
      opts.runOptions?.useHostedSoftTimeoutDefault ?? true,
    engineName: opts.runOptions?.engineName ?? opts.adapter.name,
    executionLease: opts.runOptions?.executionLease ?? true,
  };
  const runPolicy = resolveAgentHarnessRunPolicy(runOptions, opts.adapter.name);

  return startRun(
    opts.runId,
    opts.threadId,
    async (send, signal, control?: RunChunkControl) => {
      const runControl: RunChunkControl = control ?? {
        turnSignal: signal,
        chunkSignal: signal,
        chunkBoundaryReason: () => null,
        beginChunk: () => signal,
        flushEvents: async () => {},
      };
      let storedSessionId: string | undefined;
      let harnessSessionRegistered = false;
      let keepLiveSession = false;
      let liveSessionReleasedBeforeCheckpoint = false;
      const wasLiveSessionReleasedBeforeCheckpoint = (): boolean =>
        liveSessionReleasedBeforeCheckpoint;
      const releaseLiveSessionBeforeCheckpoint = () => {
        if (
          !liveSessionReleasedBeforeCheckpoint &&
          storedSessionId &&
          harnessSession
        ) {
          releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
          liveSessionReleasedBeforeCheckpoint = true;
        }
      };
      try {
        await send({
          type: "activity",
          label: `Starting ${opts.adapter.label}`,
          tool: "harness",
        });

        harnessSession ??= await opts.adapter.createSession({
          ...(opts.createSession ?? {}),
          threadId: opts.threadId,
          runId: opts.runId,
          ownerEmail: opts.ownerEmail ?? opts.createSession?.ownerEmail ?? null,
          orgId: opts.orgId ?? opts.createSession?.orgId ?? null,
          signal: runControl.turnSignal,
        });

        storedSessionId = opts.createSession?.sessionId ?? harnessSession.id;
        const storedSession = await saveAgentHarnessSession({
          id: storedSessionId,
          harnessName: opts.adapter.name,
          threadId: opts.threadId,
          runId: opts.runId,
          providerSessionId: harnessSession.id,
          runPolicy,
          status: "running",
          resumeState: opts.createSession?.resumeState,
          ownerEmail: opts.ownerEmail ?? opts.createSession?.ownerEmail ?? null,
          orgId: opts.orgId ?? opts.createSession?.orgId ?? null,
        });
        registerLiveAgentHarnessSession({
          sessionId: storedSessionId,
          adapter: opts.adapter,
          session: harnessSession,
          createSession: opts.createSession,
          ownerEmail: opts.ownerEmail ?? opts.createSession?.ownerEmail ?? null,
          orgId: opts.orgId ?? opts.createSession?.orgId ?? null,
          generation: storedSession.generation,
        });
        harnessSessionRegistered = true;

        const input: AgentHarnessTurnInput = {
          ...opts.input,
          abortSignal: runControl.chunkSignal,
        };
        const currentHarnessSession = harnessSession;
        if (!storedSessionId) {
          throw new Error("Harness session is unavailable for turn driving.");
        }
        const currentStoredSessionId = storedSessionId;
        let checkpointHandled = false;
        const wasCheckpointHandled = (): boolean => checkpointHandled;

        let pendingApproval: Extract<
          AgentHarnessEvent,
          { type: "approval-request" }
        > | null = null;
        await driveAgentHarnessTurnChunks({
          session: currentHarnessSession,
          input,
          control: runControl,
          consume: async (events) => {
            pendingApproval = null;
            try {
              for await (const event of events) {
                if (runControl.turnSignal.aborted) break;
                if (event.type === "approval-request") {
                  pendingApproval = event;
                  const resumeState = currentHarnessSession.checkpoint
                    ? await currentHarnessSession.checkpoint()
                    : storedSession.resumeState;
                  await updateLiveAgentHarnessSession(
                    currentStoredSessionId,
                    currentHarnessSession,
                    { pendingApproval: event, resumeState },
                  );
                }
                await opts.onHarnessEvent?.(event);
                if (event.type === "error") {
                  throw new Error(event.error);
                }
                for (const chatEvent of agentHarnessEventToAgentChatEvents(
                  event,
                )) {
                  await send(chatEvent);
                }
              }
            } catch (error) {
              if (
                runControl.turnSignal.aborted ||
                !runControl.chunkBoundaryReason()
              ) {
                throw error;
              }
            }
          },
          afterStream: async () => {
            if (pendingApproval) {
              const stored = await getAgentHarnessSession(
                currentStoredSessionId,
              );
              const stillPending =
                stored?.pendingApproval &&
                typeof stored.pendingApproval === "object" &&
                "id" in stored.pendingApproval &&
                stored.pendingApproval.id === pendingApproval.id &&
                !stored.resolvedApprovalIds?.includes(pendingApproval.id);
              if (stillPending) {
                keepLiveSession = true;
                await persistHarnessCheckpoint(
                  currentStoredSessionId,
                  currentHarnessSession,
                  stored.resumeState,
                  undefined,
                  async () =>
                    currentHarnessSession.checkpoint
                      ? currentHarnessSession.checkpoint()
                      : stored.resumeState,
                  true,
                );
                checkpointHandled = true;
                return "stop";
              }
            }

            if (
              runControl.chunkBoundaryReason() &&
              !currentHarnessSession.continueTurn
            ) {
              await saveHarnessCheckpoint(
                currentStoredSessionId,
                currentHarnessSession,
                opts.createSession?.resumeState,
                detachOnComplete,
                detachOnComplete
                  ? releaseLiveSessionBeforeCheckpoint
                  : undefined,
              );
              checkpointHandled = true;
              if (!detachOnComplete) {
                keepLiveSession = true;
              }
              return "stop";
            }
            return;
          },
        });

        if (runControl.turnSignal.aborted) {
          await markAgentHarnessSessionStopped(storedSessionId, "stopped");
          releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
          await stopHarnessSession(harnessSession);
          return;
        }
        if (wasCheckpointHandled()) return;

        let resumeState: unknown = opts.createSession?.resumeState;
        await persistHarnessCheckpoint(
          storedSessionId,
          harnessSession,
          resumeState,
          releaseLiveSessionBeforeCheckpoint,
          detachOnComplete && harnessSession.detach
            ? () => harnessSession!.detach!()
            : undefined,
        );
      } catch (error) {
        if (
          error instanceof AgentHarnessApprovalResolutionTimeoutError ||
          (error instanceof Error &&
            error.name === "AgentHarnessApprovalResolutionTimeoutError")
        ) {
          keepLiveSession = true;
          try {
            if (storedSessionId && harnessSession) {
              await persistRecoverableCheckpointAfterApprovalTimeout(
                storedSessionId,
                harnessSession,
              );
            }
          } catch (persistenceError) {
            if (error instanceof AgentHarnessApprovalResolutionTimeoutError) {
              throw new AgentHarnessApprovalResolutionTimeoutError(
                error.sessionId,
                error.approvalId,
                new AggregateError(
                  [error, persistenceError],
                  "Approval timeout and recoverable checkpoint persistence both failed.",
                ),
              );
            }
            if (error instanceof Error) {
              error.cause = persistenceError;
              throw error;
            }
            throw new AggregateError(
              [error, persistenceError],
              "Approval timeout and recoverable checkpoint persistence both failed.",
            );
          }
          throw error;
        }
        if (isAgentHarnessSessionConflictError(error)) {
          if (!harnessSessionRegistered) {
            await stopHarnessSession(harnessSession);
            return;
          }
          keepLiveSession = true;
          const latest = storedSessionId
            ? await getAgentHarnessSession(storedSessionId)
            : null;
          const terminal =
            latest?.status === "stopped" ||
            latest?.status === "errored" ||
            latest?.status === "destroyed";
          keepLiveSession = !terminal;
          if (terminal && storedSessionId) {
            await stopHarnessSession(harnessSession).catch(() => undefined);
            releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
          }
          return;
        }
        if (harnessSession) {
          await stopHarnessSession(harnessSession).catch(() => undefined);
        }
        if (storedSessionId) {
          releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
          await updateAgentHarnessSession(storedSessionId, {
            status: "errored",
            pendingApproval: null,
          }).catch(() => undefined);
        }
        throw error;
      } finally {
        if (
          !keepLiveSession &&
          !wasLiveSessionReleasedBeforeCheckpoint() &&
          storedSessionId
        ) {
          releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
        }
      }
    },
    opts.onRunComplete,
    runOptions,
  );
}

async function persistRecoverableCheckpointAfterApprovalTimeout(
  sessionId: string,
  session: AgentHarnessSession,
): Promise<void> {
  let conflict: AgentHarnessSessionConflictError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await getAgentHarnessSession(sessionId);
    if (
      !stored ||
      stored.status === "stopped" ||
      stored.status === "errored" ||
      stored.status === "destroyed" ||
      stored.status === "idle" ||
      stored.followUpClaimId ||
      stored.expiryCleanupId
    ) {
      return;
    }
    try {
      const updated = await updateAgentHarnessSessionAtGeneration(
        sessionId,
        stored.status,
        stored.generation,
        {
          status: "idle",
          resumeState: stored.resumeState,
          pendingApproval: checkpointPendingApproval(stored),
        },
        undefined,
        { expectedApprovalResolutionId: stored.approvalResolutionId ?? null },
      );
      if (updated) {
        refreshLiveAgentHarnessSessionGeneration(
          sessionId,
          session,
          updated.generation,
        );
        return;
      }
      conflict = new AgentHarnessSessionConflictError(sessionId);
    } catch (error) {
      if (!isAgentHarnessSessionConflictError(error)) throw error;
      conflict = error;
    }
  }
  const latest = await getAgentHarnessSession(sessionId);
  if (
    !latest ||
    latest.status === "stopped" ||
    latest.status === "errored" ||
    latest.status === "destroyed" ||
    latest.status === "idle" ||
    latest.followUpClaimId ||
    latest.expiryCleanupId
  ) {
    return;
  }
  throw conflict ?? new AgentHarnessSessionConflictError(sessionId);
}

async function saveHarnessCheckpoint(
  sessionId: string,
  session: AgentHarnessSession,
  resumeState: unknown,
  detachOnComplete: boolean,
  beforeCheckpoint?: () => void,
): Promise<void> {
  await persistHarnessCheckpoint(
    sessionId,
    session,
    resumeState,
    beforeCheckpoint,
    detachOnComplete && session.detach ? () => session.detach!() : undefined,
  );
}

async function persistHarnessCheckpoint(
  sessionId: string,
  session: AgentHarnessSession,
  resumeState: unknown,
  beforeCheckpoint?: () => void,
  resolveResumeState?: () => Promise<unknown>,
  preserveLatestResumeState = false,
): Promise<void> {
  let conflict: AgentHarnessSessionConflictError | undefined;
  let attempt = 0;
  let waitedForApprovalResolution = false;
  const approvalResolutionDeadline =
    Date.now() + APPROVAL_RESOLUTION_TIMEOUT_MS;
  while (attempt < 3) {
    const stored = await getAgentHarnessSession(sessionId);
    if (
      !stored ||
      stored.status === "stopped" ||
      stored.status === "errored" ||
      stored.status === "destroyed" ||
      stored.followUpClaimId
    ) {
      return;
    }
    if (stored.approvalResolutionId) {
      const remainingWait = approvalResolutionDeadline - Date.now();
      if (remainingWait <= 0) {
        throw new AgentHarnessApprovalResolutionTimeoutError(
          sessionId,
          stored.approvalResolutionId,
        );
      }
      waitedForApprovalResolution = true;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(APPROVAL_RESOLUTION_POLL_INTERVAL_MS, remainingWait),
        ),
      );
      continue;
    }
    const pendingApproval = checkpointPendingApproval(stored);
    try {
      const preserveStoredResumeState =
        waitedForApprovalResolution ||
        (preserveLatestResumeState && !pendingApproval);
      const checkpointResumeState = preserveStoredResumeState
        ? stored.resumeState
        : resolveResumeState
          ? await resolveResumeState()
          : resumeState;
      beforeCheckpoint?.();
      const updated = await updateAgentHarnessSessionAtGeneration(
        sessionId,
        stored.status,
        stored.generation,
        {
          status: "idle",
          resumeState: checkpointResumeState,
          pendingApproval,
        },
        undefined,
        true,
      );
      if (!updated) {
        attempt += 1;
        continue;
      }
      refreshLiveAgentHarnessSessionGeneration(
        sessionId,
        session,
        updated.generation,
      );
      return;
    } catch (error) {
      if (!isAgentHarnessSessionConflictError(error) || attempt === 2) {
        throw error;
      }
      conflict = error;
      attempt += 1;
    }
  }
  throw conflict ?? new AgentHarnessSessionConflictError(sessionId);
}

function checkpointPendingApproval(
  stored: NonNullable<Awaited<ReturnType<typeof getAgentHarnessSession>>>,
): unknown | null {
  const pending = stored.pendingApproval;
  if (
    !pending ||
    typeof pending !== "object" ||
    !("id" in pending) ||
    typeof pending.id !== "string" ||
    stored.resolvedApprovalIds?.includes(pending.id)
  ) {
    return null;
  }
  return pending;
}

async function updateLiveAgentHarnessSession(
  sessionId: string,
  session: AgentHarnessSession,
  patch: Parameters<typeof updateAgentHarnessSession>[1],
): Promise<void> {
  const expectedGeneration = getLiveAgentHarnessSessionGeneration(
    sessionId,
    session,
  );
  if (expectedGeneration === null) {
    throw new AgentHarnessSessionConflictError(sessionId);
  }
  const updated = await updateAgentHarnessSessionAtGeneration(
    sessionId,
    "running",
    expectedGeneration,
    patch,
    undefined,
    true,
  );
  if (!updated) throw new AgentHarnessSessionConflictError(sessionId);
  refreshLiveAgentHarnessSessionGeneration(
    sessionId,
    session,
    updated.generation,
  );
}

async function stopHarnessSession(
  session: AgentHarnessSession | undefined,
): Promise<void> {
  if (!session) return;
  if (session.stop) {
    await session.stop();
    return;
  }
  await session.destroy?.();
}

export function sendAgentHarnessEvent(
  send: (event: AgentChatEvent) => void,
  event: AgentHarnessEvent,
): void {
  for (const chatEvent of agentHarnessEventToAgentChatEvents(event)) {
    send(chatEvent);
  }
}
