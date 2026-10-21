import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listFactoryAutomationDefinitions } from "../server/lib/factory-automation-resources.js";
import { retireLegacyAgentJobs } from "../server/lib/factory-legacy-agent-jobs.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  resolveWorkflowScope,
  withWorkflowFailures,
  workflowSummaryView,
} from "../server/lib/factory-workflow-context.js";
import { summarizeWorkflowJob } from "../server/lib/factory-workflow-job.js";
import {
  cursorSchema,
  withReadFailures,
} from "../server/lib/workflow-read-actions.js";
import {
  decodeCursor,
  encodeCursor,
  workflowsCursorSchema,
} from "../server/workflow-host/read-models/shared.js";
import {
  WORKFLOW_STORE_LIMITS,
  type WorkflowListPosition,
} from "../server/workflow/adapter.js";

export default defineAction({
  description:
    "List the workflows in one Factory, newest first, without their graphs. Each row carries its version, whether it is enabled, whether the current version has a clean dry run, and the health of its scheduled job (last run, next run, failures, pause). A page holds up to limit (50 by default, 100 at most); while hasMore is true, pass the returned nextCursor as cursor to get the next page. Use get-factory-workflow for a graph.",
  schema: z.object({
    factoryId: factoryIdSchema,
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(WORKFLOW_STORE_LIMITS.workflowsPageMax)
      .default(50),
    cursor: cursorSchema,
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId, limit, cursor }, context) =>
    withReadFailures(() =>
      withWorkflowFailures(async () => {
        const scoped = await resolveWorkflowScope(factoryId, context);
        const page = await scoped.store.listWorkflows(scoped.scope, {
          limit,
          ...(cursor === undefined ? {} : { after: positionOf(cursor) }),
        });
        const jobs = await listFactoryAutomationDefinitions(
          scoped.orgId,
          factoryId,
        );
        // The landing read for a factory: the app's own screen pauses the seeded
        // agent jobs that workflows replaced, once each. Not part of the response.
        // An agent's, MCP's or A2A's listing stays a read: plan mode and a
        // read-only MCP scope run this action because it declares `readOnly`.
        if (context?.caller === "frontend") {
          await retireLegacyAgentJobs({
            identity: { userEmail: scoped.userEmail, orgId: scoped.orgId },
            factoryId,
            definitions: jobs,
          });
        }
        const byId = new Map(jobs.map((job) => [job.resource.id, job]));
        return {
          workflows: page.items.map((summary) => ({
            ...workflowSummaryView(summary),
            job: summarizeWorkflowJob(
              (summary.automationId && byId.get(summary.automationId)) || null,
              { enabled: summary.enabled },
            ),
          })),
          hasMore: page.hasMore,
          nextCursor:
            page.nextAfter === null
              ? null
              : encodeCursor("workflows", {
                  at: page.nextAfter.updatedAt,
                  id: page.nextAfter.id,
                }),
        };
      }),
    ),
});

/**
 * The place a cursor names. A malformed or foreign cursor throws here, and
 * `withReadFailures` turns it into `bad_cursor`.
 */
function positionOf(cursor: string): WorkflowListPosition {
  const decoded = decodeCursor("workflows", cursor, workflowsCursorSchema);
  return { updatedAt: decoded.at, id: decoded.id };
}
