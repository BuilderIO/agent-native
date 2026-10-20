import type { ActionRunContext } from "@agent-native/core/action";

import { factoryIdFromAutomationName } from "./factory-automation-resources.js";
import { requireFactoryAutomation } from "./require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "./require-workspace-member.js";
import { failWorkflowAction } from "./workflow-action-errors.js";

/** The engine reads a tool result up to 50,000 characters; a bigger one is cut. */
export const WORKFLOW_ACTION_OUTPUT_LIMIT_CHARS = 40_000;
/** What an action fills before it stops adding and says `truncated`. */
export const WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS = 34_000;

interface WorkflowActionCaller {
  userEmail: string;
  orgId: string;
  factoryId: string;
}

/**
 * Who may call an action that only a workflow runs. The graph must name the
 * action; no legacy job name or inbox source grants it. `factoryId` defaults to
 * the factory the calling job lives in, and a different one is refused. Such an
 * action sets `mcpTool: false`: it refuses every other caller, so advertising
 * it to external agents would only list tools they cannot use.
 */
export async function requireWorkflowActionCaller(
  context: ActionRunContext | undefined,
  input: { factoryId?: string },
): Promise<WorkflowActionCaller> {
  const { userEmail, orgId } = await requireWorkspaceMember(
    workspaceMemberIdentityFromContext(context),
  );
  const factoryId =
    input.factoryId ??
    (context?.automation
      ? factoryIdFromAutomationName(context.automation.triggerName)
      : null);
  if (!factoryId) {
    failWorkflowAction({
      message:
        "This action needs a factoryId, or a calling workflow job that belongs to one factory.",
      errorCode: "factory_id_required",
      statusCode: 400,
    });
  }
  await requireFactoryAutomation(
    context,
    { userEmail, orgId },
    "workflow",
    factoryId,
  );
  return { userEmail, orgId, factoryId };
}

/**
 * The last check on a result before it leaves: an action budgets what it
 * returns, so reaching this over the limit is a bug to see, never a result to
 * clip silently.
 */
export function assertResultWithinLimit<T>(actionName: string, result: T): T {
  const chars = JSON.stringify(result).length;
  if (chars > WORKFLOW_ACTION_OUTPUT_LIMIT_CHARS) {
    failWorkflowAction({
      message: `${actionName} built a ${chars}-character result; the limit is ${WORKFLOW_ACTION_OUTPUT_LIMIT_CHARS}.`,
      errorCode: "output_over_cap",
      statusCode: 500,
      details: { chars, limit: WORKFLOW_ACTION_OUTPUT_LIMIT_CHARS },
    });
  }
  return result;
}

/**
 * Keeps leading entries while the running JSON size stays inside `budget`.
 * The caller reports `truncated` when `kept.length < entries.length`.
 */
export function takeWithinBudget<T>(
  entries: readonly T[],
  budget: number,
  spent = 0,
): { kept: T[]; truncated: boolean } {
  const kept: T[] = [];
  let used = spent;
  for (const entry of entries) {
    const cost = JSON.stringify(entry).length + 1;
    if (used + cost > budget) return { kept, truncated: true };
    kept.push(entry);
    used += cost;
  }
  return { kept, truncated: false };
}

export function clipText(
  value: string,
  max: number,
): { text: string; clipped: boolean } {
  if (value.length <= max) return { text: value, clipped: false };
  const cut = value.slice(0, max);
  // Never end on half a surrogate pair.
  const last = cut.charCodeAt(cut.length - 1);
  return {
    text: last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut,
    clipped: true,
  };
}
