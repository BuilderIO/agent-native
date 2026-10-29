import { isContinuationTerminalReason } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";

export type AgentRunStatusRead =
  | {
      ok: true;
      status: string;
      active: boolean;
      runId?: string;
      turnId?: string;
      terminalReason?: string;
      awaitingRedispatch?: boolean;
    }
  | { ok: false };

const SETTLED_RUN_STATUSES = new Set([
  "idle",
  "completed",
  "errored",
  "aborted",
]);

/**
 * Whether the thread has no run in progress and none waiting to continue.
 * `unknown` is what the route reports for a thread it will not reveal, so it
 * is never settled.
 */
export function isAgentRunSettled(
  run: Extract<AgentRunStatusRead, { ok: true }>,
): boolean {
  if (run.active || run.awaitingRedispatch) return false;
  if (!SETTLED_RUN_STATUSES.has(run.status)) return false;
  const reason = run.terminalReason?.startsWith("aborted:")
    ? run.terminalReason.slice("aborted:".length)
    : run.terminalReason;
  return !isContinuationTerminalReason(reason);
}

export interface PreviousRunBaseline {
  runId: string | null;
  verified: boolean;
  turnId?: string;
}

/**
 * The run state the editor already polls while a generation is active. A
 * failed or malformed read is `{ ok: false }`, never a status, so a caller
 * cannot mistake "could not tell" for a finished run.
 */
export async function readAgentRunStatus(
  threadId: string,
): Promise<AgentRunStatusRead> {
  try {
    const response = await fetch(
      `${agentNativePath("/_agent-native/agent-chat")}/runs/active?threadId=${encodeURIComponent(threadId)}`,
      { credentials: "same-origin", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return { ok: false };
    const state = (await response.json()) as {
      active?: unknown;
      status?: unknown;
      runId?: unknown;
      turnId?: unknown;
      terminalReason?: unknown;
      awaitingRedispatch?: unknown;
    };
    if (typeof state.active !== "boolean" || typeof state.status !== "string") {
      return { ok: false };
    }
    return {
      ok: true,
      status: state.status,
      active: state.active,
      ...(typeof state.runId === "string" && state.runId
        ? { runId: state.runId }
        : {}),
      ...(typeof state.turnId === "string" && state.turnId
        ? { turnId: state.turnId }
        : {}),
      ...(typeof state.terminalReason === "string" && state.terminalReason
        ? { terminalReason: state.terminalReason }
        : {}),
      ...(state.awaitingRedispatch === true
        ? { awaitingRedispatch: true }
        : {}),
    };
  } catch {
    // coercion-ok: an unreadable run state is reported as unreadable, never as a status.
    return { ok: false };
  }
}

export async function readPreviousRunBaseline(
  threadId: string,
): Promise<PreviousRunBaseline> {
  const run = await readAgentRunStatus(threadId);
  if (!run.ok) return { runId: null, verified: false };
  if (run.runId) {
    return {
      runId: run.runId,
      verified: true,
      ...(run.turnId ? { turnId: run.turnId } : {}),
    };
  }
  return {
    runId: null,
    verified: !run.active && run.status === "idle",
  };
}
