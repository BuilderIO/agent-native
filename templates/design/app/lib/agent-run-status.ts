import { agentNativePath } from "@agent-native/core/client/api-path";

export type AgentRunStatusRead =
  | {
      ok: true;
      status: string;
      active: boolean;
      runId?: string;
      terminalReason?: string;
    }
  | { ok: false };

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
      terminalReason?: unknown;
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
      ...(typeof state.terminalReason === "string" && state.terminalReason
        ? { terminalReason: state.terminalReason }
        : {}),
    };
  } catch {
    // coercion-ok: an unreadable run state is reported as unreadable, never as a status.
    return { ok: false };
  }
}
