import type { ActiveRun, StartRunOptions } from "../run-manager.js";
import { startRun } from "../run-manager.js";
import type { AgentChatEvent } from "../types.js";
import {
  registerLiveAgentHarnessSession,
  releaseLiveAgentHarnessSession,
} from "./lifecycle.js";
import {
  getAgentHarnessSession,
  markAgentHarnessSessionStopped,
  saveAgentHarnessSession,
  updateAgentHarnessSession,
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
    async (send, signal) => {
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
        signal,
      });

      await saveAgentHarnessSession({
        id: opts.createSession?.sessionId ?? harnessSession.id,
        harnessName: opts.adapter.name,
        threadId: opts.threadId,
        runId: opts.runId,
        providerSessionId: harnessSession.id,
        status: "running",
        resumeState: opts.createSession?.resumeState,
        ownerEmail: opts.ownerEmail ?? opts.createSession?.ownerEmail ?? null,
        orgId: opts.orgId ?? opts.createSession?.orgId ?? null,
      });
      const storedSessionId =
        opts.createSession?.sessionId ?? harnessSession.id;
      registerLiveAgentHarnessSession({
        sessionId: storedSessionId,
        adapter: opts.adapter,
        session: harnessSession,
        createSession: opts.createSession,
        ownerEmail: opts.ownerEmail ?? opts.createSession?.ownerEmail ?? null,
        orgId: opts.orgId ?? opts.createSession?.orgId ?? null,
      });

      const input: AgentHarnessTurnInput = {
        ...opts.input,
        abortSignal: signal,
      };

      let pendingApproval: Extract<
        AgentHarnessEvent,
        { type: "approval-request" }
      > | null = null;
      for await (const event of harnessSession.streamTurn(input)) {
        if (signal.aborted) break;
        await opts.onHarnessEvent?.(event);
        if (event.type === "approval-request") {
          pendingApproval = event;
          await updateAgentHarnessSession(
            opts.createSession?.sessionId ?? harnessSession.id,
            {
              status: "idle",
              pendingApproval: event,
            },
          );
        }
        if (event.type === "error") {
          throw new Error(event.error);
        }
        for (const chatEvent of agentHarnessEventToAgentChatEvents(event)) {
          send(chatEvent);
        }
      }

      if (signal.aborted) {
        await stopHarnessSession(harnessSession);
        releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
        await markAgentHarnessSessionStopped(
          opts.createSession?.sessionId ?? harnessSession.id,
          "stopped",
        );
        return;
      }

      if (pendingApproval) {
        const stored = await getAgentHarnessSession(storedSessionId);
        const stillPending =
          stored?.pendingApproval &&
          typeof stored.pendingApproval === "object" &&
          "id" in stored.pendingApproval &&
          stored.pendingApproval.id === pendingApproval.id;
        if (stillPending) {
          await updateAgentHarnessSession(storedSessionId, {
            status: "idle",
            pendingApproval,
          });
          return;
        }
      }

      let resumeState: unknown = opts.createSession?.resumeState;
      if (detachOnComplete && harnessSession.detach) {
        resumeState = await harnessSession.detach();
      }
      releaseLiveAgentHarnessSession(storedSessionId, harnessSession);
      await updateAgentHarnessSession(
        opts.createSession?.sessionId ?? harnessSession.id,
        {
          status: "idle",
          resumeState,
          pendingApproval: null,
        },
      );
    },
    opts.onRunComplete,
    {
      ...(opts.runOptions ?? {}),
      turnId: opts.turnId ?? opts.runOptions?.turnId,
    },
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
