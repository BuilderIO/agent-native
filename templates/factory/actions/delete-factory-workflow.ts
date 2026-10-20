import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  requireWorkflow,
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import { removeWorkflowJob } from "../server/lib/factory-workflow-job.js";
import { WORKFLOW_STORE_LIMITS } from "../server/workflow/adapter.js";

// Far enough ahead that every parked item counts as due, whatever it waits for.
const EVERY_PARKED_ITEM = "9999-12-31T23:59:59.999Z";

export default defineAction({
  description:
    "Permanently delete a workflow: its graph, every version, runs, parked items and receipts, and its scheduled job with the job's run history. Items still parked at a Wait node are never dropped silently: the call fails with parked_items_exist and the count unless force is true. Disable and look at the parked items first; a deleted workflow cannot be restored. Pauses for the user's approval in chat before it runs, so say which workflow goes and what it takes with it.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    force: z
      .boolean()
      .default(false)
      .describe("Delete even though items are parked at a Wait node."),
  }),
  http: { method: "POST" },
  // The end state is "gone": a repeat after a lost result is workflow_not_found.
  // parked_items_exist refuses before anything is removed, and the retry with
  // force has to be allowed.
  retrySafe: true,
  // As delete-factory: the agent's, MCP and WebMCP calls ask a person, and the
  // canvas delete is the person. A deleted workflow cannot be restored, so
  // always-allow is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  audit: {
    target: (args: { workflowId: string }) => ({
      type: "factory-workflow",
      id: args.workflowId,
      visibility: "org",
    }),
    summary: (args: { workflowId: string }, result: unknown) => {
      const deleted = result as { parkedItems: number } | undefined;
      return deleted
        ? `Deleted workflow ${args.workflowId}${deleted.parkedItems > 0 ? ` with ${deleted.parkedItems} parked item(s)` : ""}`
        : `Workflow ${args.workflowId} delete refused`;
    },
  },
  run: async ({ factoryId, workflowId, force }, context) =>
    withWorkflowFailures(async () => {
      const scoped = await resolveWorkflowScope(factoryId, context);
      const workflow = await requireWorkflow(scoped, workflowId);

      // A parked item is a row with a wake time, so asking for everything due
      // at the end of time lists all of them, held by a run or not.
      const limit = WORKFLOW_STORE_LIMITS.dueParkedMax;
      const parked = await scoped.store.listDueParked(scoped.scope, {
        workflowId,
        now: EVERY_PARKED_ITEM,
        limit,
      });
      if (parked.length > 0 && !force) {
        fail(
          `Workflow "${workflowId}" has ${parked.length >= limit ? `at least ${limit}` : parked.length} item(s) waiting at a Wait node. Deleting it drops them. Pass force: true to delete anyway.`,
          {
            errorCode: "parked_items_exist",
            statusCode: 409,
            details: {
              workflowId,
              parkedItems: parked.length,
              atLeast: parked.length >= limit,
            },
          },
        );
      }

      // The job goes first: with the rows gone and the job left, every tick
      // would fail for a workflow that no longer exists.
      const jobRemoved = workflow.automationId
        ? await removeWorkflowJob({
            orgId: scoped.orgId,
            factoryId,
            automationId: workflow.automationId,
          })
        : false;
      const deleted = await scoped.store.deleteWorkflow(
        scoped.scope,
        workflowId,
      );
      if (!deleted) {
        fail(`Workflow "${workflowId}" was already deleted.`, {
          errorCode: "workflow_not_found",
          statusCode: 404,
        });
      }
      return {
        workflowId,
        deleted: true,
        jobRemoved,
        parkedItems: parked.length,
      };
    }),
});
