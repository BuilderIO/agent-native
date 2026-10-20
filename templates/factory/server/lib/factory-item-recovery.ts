import { fail, type ActionRunContext } from "@agent-native/core/action";

import { getDb } from "../db/index.js";
import {
  dismissItem,
  requeueItem,
  type RecoveryResult,
} from "../workflow-host/item-recovery.js";
import { WorkflowStoreError } from "../workflow/adapter.js";
import { resolveWorkflowReadScope } from "./workflow-read-actions.js";

type Recovery = "requeue" | "dismiss";

const REFUSAL_CODE: Record<Recovery, string> = {
  requeue: "item_not_requeueable",
  dismiss: "item_not_dismissable",
};

/**
 * Who is calling and which factory they mean, then one recovery move on one
 * inbox item: the same call for the Items drawer and for the agent. A repeat
 * lands on `changed: false`; what cannot be done is a typed failure.
 */
export async function recoverFactoryItem(
  kind: Recovery,
  input: { factoryId: string; itemId: string },
  context: ActionRunContext | undefined,
) {
  const { userEmail, scope } = await resolveWorkflowReadScope(
    input.factoryId,
    context,
  );
  let result: RecoveryResult;
  try {
    result = await (kind === "requeue" ? requeueItem : dismissItem)(getDb(), {
      scope,
      itemId: input.itemId,
      actor: userEmail,
    });
  } catch (error) {
    if (
      error instanceof WorkflowStoreError &&
      error.code === "corrupt_record"
    ) {
      return fail(error.message, {
        errorCode: "stored_record_unreadable",
        statusCode: 500,
      });
    }
    throw error;
  }
  if (result.ok) {
    return {
      ok: true as const,
      itemId: result.itemId,
      status: result.status,
      previousStatus: result.previousStatus,
      changed: result.changed,
      workflowIds: result.workflowIds,
    };
  }
  switch (result.reason) {
    case "item_not_found":
      return fail(result.message, {
        errorCode: "factory_item_not_found",
        statusCode: 404,
      });
    case "status_not_allowed":
      return fail(result.message, {
        errorCode: REFUSAL_CODE[kind],
        statusCode: 409,
        details: { itemId: input.itemId, currentStatus: result.currentStatus },
      });
    case "item_unreadable":
      return fail(result.message, {
        errorCode: "stored_record_unreadable",
        statusCode: 500,
      });
  }
}
