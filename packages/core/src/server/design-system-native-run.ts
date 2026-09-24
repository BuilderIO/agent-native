import { fail } from "../action.js";
import type { DesignSystemWorkspace } from "../shared/design-system-authoring.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export type DesignSystemNativeThreadState = {
  exists: boolean;
  messageCount: number;
  kickoffReceived: boolean;
  run: { runId: string; status: string; terminalReason?: string | null } | null;
};

export async function readDesignSystemNativeThreadState(
  workspace: DesignSystemWorkspace,
  options?: { runId: string },
): Promise<DesignSystemNativeThreadState> {
  const { getThread, resolveThreadAccess } =
    await import("../chat-threads/store.js");
  const existing = await getThread(workspace.conversationId);
  if (!existing)
    return {
      exists: false,
      messageCount: 0,
      kickoffReceived: false,
      run: null,
    };
  const thread = await resolveThreadAccess(
    getRequestUserEmail(),
    workspace.conversationId,
    "viewer",
    { orgId: getRequestOrgId() },
  );
  if (!thread)
    return fail(
      "Access to the system's conversation is required to resume its authoring run.",
      { errorCode: "design_system_conversation_forbidden", statusCode: 403 },
    );
  const { getActiveRunForThreadAsync } =
    await import("../agent/run-manager.js");
  const { countRunsForTurn, getRunById, getRunByThread } =
    await import("../agent/run-store.js");
  await getActiveRunForThreadAsync(workspace.conversationId);
  const latest = await getRunByThread(workspace.conversationId, {
    includeTerminal: true,
  });
  const requested = options ? await getRunById(options.runId) : null;
  if (requested && requested.threadId !== workspace.conversationId)
    return fail("The requested run does not belong to this conversation.", {
      errorCode: "design_system_run_mismatch",
      statusCode: 409,
    });
  if (
    requested &&
    latest &&
    latest.id !== requested.id &&
    latest.startedAt >= requested.startedAt
  )
    return fail(
      "A newer native turn owns this system's progress. Refresh the workspace before binding a run.",
      {
        errorCode: "design_system_run_superseded",
        statusCode: 409,
      },
    );
  const run = options ? requested : latest;
  return {
    exists: true,
    messageCount: thread.messageCount,
    kickoffReceived: workspace.kickoff
      ? (await countRunsForTurn(
          workspace.conversationId,
          workspace.kickoff.requestId,
        )) > 0
      : false,
    run: run
      ? {
          runId: run.id,
          status: run.status,
          terminalReason: run.terminalReason,
        }
      : null,
  };
}
