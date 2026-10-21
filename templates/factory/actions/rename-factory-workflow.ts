import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  requireWorkflow,
  resolveWorkflowScope,
  withWorkflowFailures,
  workflowNameSchema,
  workflowSummaryView,
} from "../server/lib/factory-workflow-context.js";
import {
  WorkflowJobError,
  renameWorkflowJob,
} from "../server/lib/factory-workflow-job.js";
import { watchAgentCall } from "../server/lib/factory-workflow-tripwires.js";

interface RenameOutcome {
  id: string;
  previousName: string;
  name: string;
  changed: boolean;
}

export default defineAction({
  description:
    "Rename a workflow: change the name people see in the workflow list and the canvas toolbar. Returns the updated workflow summary, the previousName and whether anything changed. Only the name changes: the graph, version, on/off state and dry-run record stay as they were, so no new dry run is needed. The scheduled job's display name follows. To change a node's title, set its label in the graph with save-factory-workflow instead.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    name: workflowNameSchema.describe(
      "The new name: one line, up to 120 characters.",
    ),
  }),
  http: { method: "POST" },
  // Sets an end state, so a repeat after a lost result lands in the same place.
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  audit: {
    target: (args: { workflowId: string }) => ({
      type: "factory-workflow",
      id: args.workflowId,
      visibility: "org",
    }),
    summary: (args: { workflowId: string }, result: unknown) => {
      const renamed = result as RenameOutcome | undefined;
      if (!renamed) return `Workflow ${args.workflowId} rename refused`;
      return renamed.changed
        ? `Renamed workflow ${renamed.id} from "${renamed.previousName}" to "${renamed.name}"`
        : `Workflow ${renamed.id} already named "${renamed.name}"`;
    },
  },
  run: async (input, context) =>
    watchAgentCall(
      {
        action: "rename-factory-workflow",
        input,
        context,
        factoryId: input.factoryId,
        workflowId: input.workflowId,
      },
      (watch) =>
        withWorkflowFailures(async () => {
          const { factoryId, workflowId, name } = input;
          const scoped = await resolveWorkflowScope(factoryId, context);
          watch.inOrg(scoped.orgId);
          const current = await requireWorkflow(scoped, workflowId);
          if (current.name === name) {
            return {
              ...workflowSummaryView(current),
              previousName: current.name,
              changed: false,
              job: null,
            };
          }
          const summary = await scoped.store.renameWorkflow(scoped.scope, {
            workflowId,
            name,
          });

          // The rows are the workflow's name; the job file only mirrors it for
          // the scheduler's own screens. A job that is already gone cannot show
          // a stale name, so it is not an error here (a read reports it).
          let job: {
            automationId: string;
            path: string;
            changed: boolean;
          } | null = null;
          if (summary.automationId) {
            try {
              const written = await renameWorkflowJob({
                orgId: scoped.orgId,
                factoryId,
                automationId: summary.automationId,
                name: summary.name,
              });
              job = {
                automationId: written.id,
                path: written.path,
                changed: written.changed,
              };
            } catch (error) {
              if (!(error instanceof WorkflowJobError)) throw error;
              if (error.code !== "job_missing") {
                fail(
                  `The workflow was renamed to "${summary.name}", but its job file did not follow: ${error.message} Rename it again to retry.`,
                  {
                    errorCode: "job_sync_failed",
                    statusCode: 500,
                    details: {
                      workflowId,
                      renamed: true,
                      jobError: error.code,
                    },
                  },
                );
              }
            }
          }
          return {
            ...workflowSummaryView(summary),
            previousName: current.name,
            changed: true,
            job,
          };
        }),
    ),
});
