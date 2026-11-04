import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  auditedIssueKey,
  jiraTransitionAuditSummary,
  transitionJiraIssue,
} from "../server/connectors/jira-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";

const resultSchema = z.object({
  ok: z.literal(true),
  issueKey: z.string(),
  fromStatus: z.string(),
  status: z.string(),
  alreadyInState: z.boolean(),
  transitionName: z.string().nullable(),
  externalRef: z.string().min(1).max(500),
});

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Move one Jira issue through a transition for a workflow, through the workspace's connected Jira. The issue is read first and transition (a name, matched without regard to case, or an id) is resolved against the transitions Jira offers the issue now; an unknown name fails with jira_transition_not_found and an ambiguous one with jira_transition_ambiguous, and nothing is sent. Naming the status the issue is already in succeeds with alreadyInState true and sends nothing. The write is sent once, with the id Jira itself offered. Returns the key, fromStatus, the status the issue is in now, and externalRef (key:status), which reads the same whether this call moved the issue or found it there. When the error code ends in _outcome_unknown the transition may have happened, so read the issue before trying again.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    issueKey: z.string().trim().min(1).max(200),
    transition: z.string().trim().min(1).max(500),
  }),
  outputSchema: resultSchema,
  http: false,
  mcpTool: false,
  audit: {
    recordInputs: false,
    target: (args: { issueKey: string }) => {
      const id = auditedIssueKey(args.issueKey);
      return {
        type: "jira-issue",
        ...(id === undefined ? {} : { id }),
        visibility: "org",
      };
    },
    summary: (args: { issueKey: string }) =>
      jiraTransitionAuditSummary(args.issueKey),
  },
  run: async (
    { factoryId: requestedFactoryId, issueKey, transition },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    return transitionJiraIssue(
      { identity: caller, signal: context?.signal },
      { issueKey, transition },
    );
  },
});
