import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getJiraIssue } from "../server/connectors/jira-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";

const resultSchema = z.object({
  ok: z.literal(true),
  issueKey: z.string(),
  summary: z.string(),
  status: z.string(),
  statusCategory: z.string().nullable(),
  resolution: z.string().nullable(),
  assignee: z.string().nullable(),
  labels: z.array(z.string()).max(50),
  transitionNames: z.array(z.string()).max(50),
  truncated: z.boolean(),
});

export default defineAction({
  description:
    "Read one Jira issue for a workflow, through the workspace's connected Jira: its status (and statusCategory new, indeterminate or done), summary, resolution, assignee, labels, and the names of the transitions it can take now. Up to 50 labels and 50 transition names, each clipped; truncated says when anything was cut. A key that is not PROJ-123 shaped is refused before Jira is called.",
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
    return getJiraIssue(
      { identity: caller, signal: context?.signal },
      { issueKey },
    );
  },
});
