import { fail, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { getWorkflowReadModels } from "../workflow-host/factory-read-models.js";
import {
  READ_LIMITS,
  WorkflowReadError,
  type WorkflowReadErrorCode,
  type WorkflowReadModels,
} from "../workflow-host/read-models.js";
import { WorkflowStoreError } from "../workflow/adapter.js";
import { readFactoryDefinition } from "./factory-definitions.js";
import { DEFAULT_FACTORY_ID } from "./factory-ids.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "./require-workspace-member.js";

export const pageLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(READ_LIMITS.pageMax)
  .default(READ_LIMITS.pageDefault);

export const cursorSchema = z
  .string()
  .trim()
  .min(1)
  .max(READ_LIMITS.cursorChars)
  .optional()
  .describe("The nextCursor of the previous page; omit for the first page.");

export const workflowIdSchema = z.string().trim().min(1).max(64);
export const itemIdSchema = z.string().trim().min(1).max(200);
export const nodeIdSchema = z.string().trim().min(1).max(64);

interface WorkflowReadScope {
  userEmail: string;
  orgId: string;
  scope: { orgId: string; factoryId: string };
  models: WorkflowReadModels;
}

/** Who is calling and which factory they mean; every read below stays inside that org and factory. */
export async function resolveWorkflowReadScope(
  factoryId: string,
  context: ActionRunContext | undefined,
): Promise<WorkflowReadScope> {
  const { userEmail, orgId } = await requireWorkspaceMember(
    workspaceMemberIdentityFromContext(context),
  );
  const factory = await readFactoryDefinition(orgId, factoryId);
  if (!factory && factoryId !== DEFAULT_FACTORY_ID) {
    fail("Factory not found.", {
      errorCode: "factory_not_found",
      statusCode: 404,
    });
  }
  return {
    userEmail,
    orgId,
    scope: { orgId, factoryId },
    models: getWorkflowReadModels(),
  };
}

const READ_FAILURES: Record<
  WorkflowReadErrorCode,
  { errorCode: string; statusCode: number }
> = {
  workflow_not_found: { errorCode: "workflow_not_found", statusCode: 404 },
  run_not_found: { errorCode: "workflow_run_not_found", statusCode: 404 },
  item_not_found: { errorCode: "workflow_item_not_found", statusCode: 404 },
  node_not_found: { errorCode: "workflow_node_not_found", statusCode: 404 },
  bad_cursor: { errorCode: "bad_cursor", statusCode: 400 },
  invalid_input: { errorCode: "invalid_request", statusCode: 400 },
};

/**
 * Turns what a read can fail with into typed action failures: not found, a bad
 * cursor, and a stored value that no longer parses. The last is a 500 with its
 * own code, so no caller reads it as an empty list.
 */
export async function withReadFailures<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WorkflowReadError) {
      return fail(error.message, {
        ...READ_FAILURES[error.code],
        ...(error.details === undefined
          ? {}
          : { details: { ...error.details } }),
      });
    }
    if (
      error instanceof WorkflowStoreError &&
      error.code === "corrupt_record"
    ) {
      return fail(error.message, {
        errorCode: "stored_record_unreadable",
        statusCode: 500,
        ...(error.details === undefined
          ? {}
          : { details: { ...error.details } }),
      });
    }
    throw error;
  }
}
