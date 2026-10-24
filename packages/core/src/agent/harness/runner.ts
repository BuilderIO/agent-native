import type {
  ActiveRun,
  RunChunkControl,
  StartRunOptions,
} from "../run-manager.js";
import { startRun } from "../run-manager.js";
import type { AgentChatEvent } from "../types.js";
import {
  registerLiveAgentHarnessSession,
  refreshLiveAgentHarnessSessionGeneration,
  releaseLiveAgentHarnessSession,
} from "./lifecycle.js";
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
import type {
  AgentHarnessAdapter,
  AgentHarnessCreateSessionOptions,
  AgentHarnessEvent,
  AgentHarnessSession,
  AgentHarnessTurnInput,
} from "./types.js";

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

  return startRun(
    opts.runId,
    opts.threadId,
    async (send, signal, control) => {
      const runControl: RunChunkControl = control ?? {
        turnSignal: signal,
        chunkSignal: signal,
        chunkBoundaryReason: () => null,
        beginChunk: () => signal,
      };
      let storedSessionId: string | undefined;
      let harnessSessionRegistered = false;
      let keepLiveSession = false;
      try {
        send({
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

        let firstStream = true;
        let pendingApproval: Extract<
          AgentHarnessEvent,
          { type: "approval-request" }
        > | null = null;
        while (true) {
          pendingApproval = null;
          const events = firstStream
            ? harnessSession.streamTurn(input)
            : harnessSession.continueTurn!({
                abortSignal: runControl.chunkSignal,
              });
          firstStream = false;
          try {
            for await (const event of events) {
              if (runControl.turnSignal.aborted) break;
              if (event.type === "approval-request") {
                pendingApproval = event;
                await updateLiveAgentHarnessSession(
                  storedSessionId,
                  harnessSession,
                  { pendingApproval: event },
                );
              }
              await opts.onHarnessEvent?.(event);
              if (event.type === "error") {
                throw new Error(event.error);
              }
              for (const chatEvent of agentHarnessEventToAgentChatEvents(
                event,
              )) {
                send(chatEvent);
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

          if (runControl.turnSignal.aborted) {
            await stopHarnessSession(harnessSession);
            releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
            await markAgentHarnessSessionStopped(storedSessionId, "stopped");
            return;
          }

          if (pendingApproval) {
            const stored = await getAgentHarnessSession(storedSessionId);
            const stillPending =
              stored?.pendingApproval &&
              typeof stored.pendingApproval === "object" &&
              "id" in stored.pendingApproval &&
              stored.pendingApproval.id === pendingApproval.id &&
              !stored.resolvedApprovalIds?.includes(pendingApproval.id);
            if (stillPending) {
              keepLiveSession = true;
              await updateLiveAgentHarnessSession(
                storedSessionId,
                harnessSession,
                {
                  status: "idle",
                },
              );
              return;
            }
          }

          if (!runControl.chunkBoundaryReason()) break;
          if (!harnessSession.continueTurn) {
            await saveHarnessCheckpoint(
              storedSessionId,
              harnessSession,
              opts.createSession?.resumeState,
              detachOnComplete,
            );
            if (detachOnComplete) {
              releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
            } else {
              keepLiveSession = true;
            }
            return;
          }
          if (runControl.beginChunk().aborted) {
            await stopHarnessSession(harnessSession);
            releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
            await markAgentHarnessSessionStopped(storedSessionId, "stopped");
            return;
          }
        }

        if (runControl.turnSignal.aborted) {
          await stopHarnessSession(harnessSession);
          releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
          await markAgentHarnessSessionStopped(storedSessionId, "stopped");
          return;
        }

        let resumeState: unknown = opts.createSession?.resumeState;
        if (detachOnComplete && harnessSession.detach) {
          resumeState = await harnessSession.detach();
        }
        await persistHarnessCheckpoint(
          storedSessionId,
          harnessSession,
          resumeState,
        );
        releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
      } catch (error) {
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
            releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
          }
          return;
        }
        if (harnessSession && !keepLiveSession) {
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
        if (!keepLiveSession && storedSessionId) {
          releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
        }
      }
    },
    opts.onRunComplete,
    {
      ...(opts.runOptions ?? {}),
      turnId: opts.turnId ?? opts.runOptions?.turnId,
      recoverChunkBoundaries: opts.runOptions?.recoverChunkBoundaries ?? true,
      useHostedSoftTimeoutDefault:
        opts.runOptions?.useHostedSoftTimeoutDefault ?? true,
      engineName: opts.runOptions?.engineName ?? opts.adapter.name,
      executionLease: opts.runOptions?.executionLease ?? true,
    },
  );
}

async function saveHarnessCheckpoint(
  sessionId: string,
  session: AgentHarnessSession,
  resumeState: unknown,
  detachOnComplete: boolean,
): Promise<void> {
  let nextResumeState = resumeState;
  if (detachOnComplete && session.detach) {
    nextResumeState = await session.detach();
  }
  await persistHarnessCheckpoint(sessionId, session, nextResumeState);
}

async function persistHarnessCheckpoint(
  sessionId: string,
  session: AgentHarnessSession,
  resumeState: unknown,
): Promise<void> {
  let conflict: AgentHarnessSessionConflictError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
    const pendingApproval = checkpointPendingApproval(stored);
    try {
      const updated = await updateAgentHarnessSessionAtGeneration(
        sessionId,
        stored.status,
        stored.generation,
        {
          status: "idle",
          resumeState,
          pendingApproval,
        },
      );
      if (!updated) continue;
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
  const updated = await updateAgentHarnessSession(sessionId, patch);
  if (updated) {
    refreshLiveAgentHarnessSessionGeneration(
      sessionId,
      session,
      updated.generation,
    );
  }
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
