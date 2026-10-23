import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  requireWorkflow,
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import { WORKFLOW_STORE_LIMITS } from "../server/workflow/adapter.js";

export default defineAction({
  description:
    "List the saved versions of one workflow, newest first, without their graphs: version number, who made it (save, agent, restore, template), a summary, and when. Read one with get-factory-workflow and its version; bring one back with restore-factory-workflow-version.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(WORKFLOW_STORE_LIMITS.versionsPageMax)
      .default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId, workflowId, limit }, context) =>
    withWorkflowFailures(async () => {
      const scoped = await resolveWorkflowScope(factoryId, context);
      const workflow = await requireWorkflow(scoped, workflowId);
      const page = await scoped.store.listWorkflowVersions(
        scoped.scope,
        workflowId,
        { limit },
      );
      return {
        workflowId,
        currentVersion: workflow.version,
        versions: page.items.map((version) => ({
          version: version.version,
          source: version.source,
          summary: version.summary,
          createdAt: version.createdAt,
          createdBy: version.createdBy,
          current: version.version === workflow.version,
        })),
        hasMore: page.hasMore,
      };
    }),
});
