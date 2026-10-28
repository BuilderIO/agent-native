import {
  hasActiveAgentRuns,
  type AgentThreadState,
} from "@agent-native/agentkit";

import type { RunReconcileOutcome } from "./RunStuckBanner.js";

/**
 * A run that yielded to a connection request ends on the server by design, so
 * the server reporting it settled says nothing about a chat that is waiting on
 * the user rather than on a response.
 */
export function isWaitingOnConnectionRequest(
  thread: AgentThreadState,
): boolean {
  const openRequestRunIds = new Set(
    Object.entries(thread.connectionRequests).flatMap(([id, request]) =>
      request.status === "requested" || request.status === "connecting"
        ? [thread.connectionRequestRunIds[id]]
        : [],
    ),
  );
  return (
    thread.activeRunIds.length > 0 &&
    thread.activeRunIds.every(
      (runId) =>
        thread.runs[runId]?.status === "awaiting_input" &&
        openRequestRunIds.has(runId),
    )
  );
}

/** An approval pauses an active run until the user responds. */
export function isWaitingOnApprovalRequest(thread: AgentThreadState): boolean {
  const openApprovalRunIds = new Set(
    Object.entries(thread.approvalRunIds).flatMap(([id, runId]) =>
      thread.approvals[id] ? [runId] : [],
    ),
  );
  return (
    thread.activeRunIds.length > 0 &&
    thread.activeRunIds.every(
      (runId) =>
        thread.runs[runId]?.status === "awaiting_approval" &&
        openApprovalRunIds.has(runId),
    )
  );
}

/**
 * The server stopped tracking a run this chat still shows as running, so the
 * run's ending, and the tool-done events that refresh the app's data, never
 * arrived. Reload the thread from the server to settle it, then replay the
 * tool completions for the runs that just ended so a write the agent made is
 * visible without the user retrying.
 */
export async function reconcileSettledRun(args: {
  load: () => Promise<unknown>;
  getThread: () => AgentThreadState;
  tabId: string;
}): Promise<RunReconcileOutcome> {
  const runningBefore = args.getThread().activeRunIds;
  await args.load();
  const after = args.getThread();
  const endedRunIds = new Set(
    runningBefore.filter(
      (runId) =>
        !after.activeRunIds.includes(runId) ||
        !hasActiveAgentRuns({ ...after, activeRunIds: [runId] }),
    ),
  );
  const endedTools = new Map<string, boolean>();
  for (const tool of Object.values(after.tools)) {
    if (!tool.runId || !endedRunIds.has(tool.runId)) continue;
    if (tool.status === "running") continue;
    // Unknown counts as a write: a refetch costs little, a stale screen does not.
    if (tool.metadata?.completedSideEffect === false) continue;
    endedTools.set(
      tool.name,
      (endedTools.get(tool.name) ?? false) || tool.status !== "completed",
    );
  }
  for (const [tool, failed] of endedTools) {
    window.dispatchEvent(
      new CustomEvent("agent-native:tool-done", {
        detail: {
          tool,
          isError: failed,
          completedSideEffect: true,
          tabId: args.tabId,
        },
      }),
    );
  }
  if (endedRunIds.size > 0) {
    window.dispatchEvent(new CustomEvent("agentNative:refresh-data"));
  }
  return hasActiveAgentRuns(after) ? "still_running" : "settled";
}
