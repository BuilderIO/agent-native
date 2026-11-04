import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  SENTRY_ASSIGNEE_KINDS,
  assignSentryIssue,
  auditedIssueId,
  sentryWriteAuditSummary,
} from "../server/connectors/sentry-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";

const resultSchema = z.object({
  ok: z.literal(true),
  issueId: z.string(),
  assignedType: z.enum(["user", "team"]).nullable(),
  assignedName: z.string().nullable(),
  url: z.string().nullable(),
  externalRef: z.string().min(1).max(500),
});

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Assign one Sentry issue for a workflow, through the workspace's connected Sentry. assigneeKind is user (assignee is the person's email), team (assignee is the team slug, in lowercase; the team is read first to its id, and an unknown slug fails with sentry_team_not_found before anything is sent) or nobody (assignee empty, which unassigns). issueId is the numeric id and orgSlug the organization (the connected one when empty). Sentry's answer must show the assignment, and one that does not fails with unexpected_response_outcome_unknown. The write is sent once. Returns the issue id, who it is assigned to, and externalRef (id:user:email, id:team:slug or id:unassigned). When the error code ends in _outcome_unknown the assignment may have happened, so read the issue before trying again.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    issueId: z.string().trim().min(1).max(200),
    orgSlug: z.string().trim().max(200).optional(),
    assigneeKind: z.enum(SENTRY_ASSIGNEE_KINDS),
    assignee: z.string().trim().max(500).optional(),
  }),
  outputSchema: resultSchema,
  http: false,
  mcpTool: false,
  audit: {
    recordInputs: false,
    target: (args: { issueId: string }) => {
      const id = auditedIssueId(args.issueId);
      return {
        type: "sentry-issue",
        ...(id === undefined ? {} : { id }),
        visibility: "org",
      };
    },
    summary: (args: { issueId: string }) =>
      sentryWriteAuditSummary(args.issueId),
  },
  run: async (
    { factoryId: requestedFactoryId, issueId, orgSlug, assigneeKind, assignee },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    return assignSentryIssue(
      { identity: caller, signal: context?.signal },
      {
        issueId,
        orgSlug: orgSlug || undefined,
        assigneeKind,
        assignee: assignee || undefined,
      },
    );
  },
});
