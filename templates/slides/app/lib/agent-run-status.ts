import {
  isContinuationTerminalReason,
  readAgentRunStatus,
  type AgentRunStatusRead,
} from "@agent-native/core/client/agent-chat";

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

export type PreviousGenerationRun = "settled" | "running" | "unreadable";

/**
 * Asks the server whether a generation thread's run has finished. A failed
 * read is `unreadable`, never `settled`: starting another run while the first
 * still writes puts two agents on the same deck.
 */
export async function readPreviousGenerationRun(
  threadId: string,
): Promise<PreviousGenerationRun> {
  const run = await readAgentRunStatus({ threadId });
  if (!run.ok) return "unreadable";
  return isAgentRunSettled(run) ? "settled" : "running";
}
