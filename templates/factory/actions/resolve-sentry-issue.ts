import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  SENTRY_RESOLUTIONS,
  resolveSentryIssue,
  auditedIssueId,
  sentryWriteAuditSummary,
} from "../server/connectors/sentry-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";

const resultSchema = z.object({
  ok: z.literal(true),
  issueId: z.string(),
  inNextRelease: z.boolean(),
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
    "Resolve one Sentry issue for a workflow, through the workspace's connected Sentry. resolution is resolved or resolvedInNextRelease. issueId is the numeric id and orgSlug the organization (the connected one when empty). Sentry takes a repeat as it is, so there is no read first; its answer must say the issue is resolved, and one that does not fails with unexpected_response_outcome_unknown. The write is sent once. Returns the issue id, the permalink as url when Sentry sent one, and externalRef (id:resolved). When the error code ends in _outcome_unknown the issue may have been resolved, so read it before trying again.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    issueId: z.string().trim().min(1).max(200),
    orgSlug: z.string().trim().max(200).optional(),
    resolution: z.enum(SENTRY_RESOLUTIONS).default("resolved"),
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
    { factoryId: requestedFactoryId, issueId, orgSlug, resolution },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    return resolveSentryIssue(
      { identity: caller, signal: context?.signal },
      { issueId, orgSlug: orgSlug || undefined, resolution },
    );
  },
});
