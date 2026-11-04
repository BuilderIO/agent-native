import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  readWorkflowSlackUserEmail,
  resolveFactorySlackWorkspace,
} from "../server/connectors/slack-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";
import { createSlackWorkflowClient } from "../server/triage/slack-client.js";

export default defineAction({
  description:
    "Read one Slack member's email for a workflow, so work started for a report is attributed to whoever wrote it. userId is a Slack user id (U...). emailSource is slack when Slack gave the address, and fallback when the person has none and fallbackEmail was used. A person with no email and no valid fallbackEmail is refused. A lookup that failed is an error, never a fallback: an unknown id, a missing users:read.email scope (a token without it gets no email from Slack, which this reads as the scope missing and not as a person with none), Slack down or an unreadable key.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    userId: z.string().trim().min(1).max(64),
    fallbackEmail: z.string().trim().max(320).optional(),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    userId: z.string(),
    email: z.string(),
    emailSource: z.enum(["slack", "fallback"]),
  }),
  http: false,
  mcpTool: false,
  readOnly: true,
  run: async (
    { factoryId: requestedFactoryId, userId, fallbackEmail },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    const workspace = await resolveFactorySlackWorkspace(
      context,
      caller,
      caller.factoryId,
    );
    return readWorkflowSlackUserEmail(
      createSlackWorkflowClient({
        ownerEmail: caller.userEmail,
        orgId: caller.orgId,
      }),
      {
        workspace,
        userId,
        ...(fallbackEmail === undefined ? {} : { fallbackEmail }),
      },
    );
  },
});
