import type { ActionRunContext } from "@agent-native/core/action";
import { getRunTurnRef } from "@agent-native/core/server";

import { readOwnedAskNotebook } from "../model/ask-thread-notebook.js";
import { ensureAnalyticsDatabase } from "../model/database.js";
import type { WorkspaceScope } from "../model/scope.js";
import { reviewContextRequired } from "../model/thread-projects.js";
import { APPLICATION_ID, requireCurrentWorkspace } from "./workspace-access.js";

export function isNotebookToolWrite(context?: ActionRunContext): boolean {
  return (
    context !== undefined &&
    ((context.caller !== "frontend" && context.caller !== "http") ||
      context.networkProtocol !== undefined ||
      context.automation !== undefined ||
      context.requestHeaders?.has("authorization") === true)
  );
}

/** True for an external caller (WebMCP, MCP, A2A) that carries no Analytics chat thread. */
export function isThreadlessNotebookCaller(context?: ActionRunContext) {
  return isNotebookToolWrite(context) && context?.threadId === undefined;
}

export function notebookThreadMatches(
  context: ActionRunContext | undefined,
  threadId: string | undefined,
) {
  return (
    context?.threadId === undefined ||
    threadId === undefined ||
    context.threadId === threadId
  );
}

export async function privateAskNotebookWrite(
  projectId: string,
  context?: ActionRunContext,
) {
  if (!context?.threadId || context.appId !== APPLICATION_ID) return null;
  const scope = await requireCurrentWorkspace();
  await ensureAnalyticsDatabase();
  const binding = await readOwnedAskNotebook(
    { ...scope, appId: APPLICATION_ID },
    { projectId, threadId: context.threadId },
  );
  if (!binding || binding.listed) return null;
  await requireNotebookToolIdentity(scope, context);
  return { id: binding.bindingId, threadId: context.threadId };
}

export async function requireNotebookToolIdentity(
  scope: WorkspaceScope,
  context?: ActionRunContext,
  requestedThreadId?: string,
) {
  if (
    !context ||
    !isNotebookToolWrite(context) ||
    context.appId !== APPLICATION_ID ||
    context.userEmail?.trim().toLowerCase() !== scope.ownerEmail ||
    context.orgId !== scope.orgId ||
    !context.threadId ||
    !context.runId ||
    !context.turnId ||
    !context.toolCallId ||
    !notebookThreadMatches(context, requestedThreadId)
  )
    reviewContextRequired(context?.threadId === undefined);
  const { threadId, runId, turnId, toolCallId } = context;
  const run = await getRunTurnRef(runId);
  if (run?.threadId !== threadId || run.turnId !== turnId)
    reviewContextRequired();
  return {
    scope: { ...scope, appId: APPLICATION_ID },
    threadId,
    runId,
    turnId,
    toolCallId,
  };
}
