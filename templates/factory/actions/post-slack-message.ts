import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  SLACK_POST_TEXT_MAX,
  isSlackTimestamp,
  postWorkflowSlackMessage,
  resolveFactorySlackWorkspace,
} from "../server/connectors/slack-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";
import { createSlackWorkflowClient } from "../server/triage/slack-client.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Post one Slack message for a workflow: to a channel (C...), to a person by Slack id (U...) or by email, or as a reply when threadTs is given (then to is the thread's channel). Mentions (<!channel>, <!here>, <!everyone>, <!subteam^...>, <@U...>) are posted as plain text unless allowMentions is true. Returns ts and permalink. Not idempotent, because Slack has no idempotency key: when the error code ends in _outcome_unknown the message may have been posted, so check before sending again.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    to: z.string().trim().min(1).max(320),
    text: z.string().trim().min(1).max(SLACK_POST_TEXT_MAX),
    threadTs: z
      .string()
      .trim()
      .refine(
        isSlackTimestamp,
        "use a Slack timestamp such as 1700000000.000100",
      )
      .optional(),
    allowMentions: z.boolean().optional(),
  }),
  http: false,
  mcpTool: false,
  audit: {
    target: (_args: unknown, result: unknown) => {
      const post = result as { channel?: string; ts?: string } | undefined;
      return {
        type: "slack-message",
        id: post?.ts ? `${post.channel}:${post.ts}` : undefined,
        visibility: "org",
      };
    },
    summary: (args: { threadTs?: string }, result: unknown) => {
      const channel =
        (result as { channel?: string } | undefined)?.channel ?? "Slack";
      return args.threadTs
        ? `Replied in a Slack thread in ${channel}`
        : `Posted a Slack message to ${channel}`;
    },
  },
  run: async (
    { factoryId: requestedFactoryId, to, text, threadTs, allowMentions },
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
    const slack = createSlackWorkflowClient({
      ownerEmail: caller.userEmail,
      orgId: caller.orgId,
    });
    const post = await postWorkflowSlackMessage(slack, {
      workspace,
      to,
      text,
      threadTs,
      allowMentions,
    });
    return { ok: true as const, ...post };
  },
});
