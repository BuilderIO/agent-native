import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listJiraTransitions } from "../server/connectors/jira-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";

const resultSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  transitions: z
    .array(z.object({ id: z.string(), name: z.string(), toStatus: z.string() }))
    .max(50),
  truncated: z.boolean(),
});

export default defineAction({
  description:
    "List the transitions a Jira issue can take now, for a workflow: id, name and destination status of each (count is how many Jira offered; at most 50 are listed and truncated says when more were). Jira offers only what the connected account may do from the issue's current status. A key that is not PROJ-123 shaped is refused before Jira is called.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    issueKey: z.string().trim().min(1).max(200),
  }),
  outputSchema: resultSchema,
  http: false,
  mcpTool: false,
  readOnly: true,
  run: async ({ factoryId: requestedFactoryId, issueKey }, context) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    return listJiraTransitions(
      { identity: caller, signal: context?.signal },
      { issueKey },
    );
  },
});
