import { agentNativePath } from "./api-path.js";

export type AgentRunStatusRead =
  | {
      ok: true;
      status: string;
      active: boolean;
      runId?: string;
      turnId?: string;
      terminalReason?: string;
      /** A truncated run whose continuation the server has not started yet. */
      awaitingRedispatch?: boolean;
    }
  | { ok: false };

/** Reads a thread's active run or the durable terminal state for a known run. */
export async function readAgentRunStatus(input: {
  threadId: string;
  runId?: string;
}): Promise<AgentRunStatusRead> {
  const params = new URLSearchParams({ threadId: input.threadId });
  const route = input.runId ? "runs/latest" : "runs/active";
  if (input.runId) params.set("runId", input.runId);

  try {
    const response = await fetch(
      `${agentNativePath(`/_agent-native/agent-chat/${route}`)}?${params}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
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
    if (typeof state.status !== "string") return { ok: false };

    const active =
      typeof state.active === "boolean"
        ? state.active
        : input.runId && ["queued", "running"].includes(state.status)
          ? true
          : input.runId
            ? false
            : undefined;
    if (active === undefined) return { ok: false };

    return {
      ok: true,
      status: state.status,
      active,
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
    return { ok: false };
  }
}
