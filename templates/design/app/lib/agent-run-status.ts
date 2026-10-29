import {
  readAgentRunStatus as readSharedAgentRunStatus,
  type AgentRunStatusRead,
} from "@agent-native/core/client/agent-chat";

export type { AgentRunStatusRead };

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
export function readAgentRunStatus(
  threadId: string,
  runId?: string,
): Promise<AgentRunStatusRead> {
  return readSharedAgentRunStatus({
    threadId,
    ...(runId ? { runId } : {}),
  });
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
