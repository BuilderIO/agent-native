import {
  hasActiveAgentRuns,
  type AgentThreadState,
} from "@agent-native/agentkit";

import type { RunReconcileOutcome } from "./RunStuckBanner.js";

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
