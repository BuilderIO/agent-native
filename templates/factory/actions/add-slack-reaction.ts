import { defineAction } from "@agent-native/core/action";
import { buildProviderApiAuditSummary } from "@agent-native/core/provider-api/actions/provider-api-audit";
import { z } from "zod";

import {
  addWorkflowSlackReaction,
  isSlackTimestamp,
  resolveFactorySlackWorkspace,
} from "../server/connectors/slack-workflow.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { isSlackChannelId } from "../server/lib/slack-channel-id.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";
import { createSlackWorkflowClient } from "../server/triage/slack-client.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Put one emoji reaction on a Slack message for a workflow, as the app's bot. channel is the channel id (C...), ts the message's Slack timestamp, name the emoji without colons (lowercase letters, digits, _, + and -). Slack answers a repeat with already_reacted; that is a success with alreadyReacted true, never a failure. Returns externalRef, derived from the channel, message and emoji. The reaction is the bot's own: a Source's claim reaction and a reply Wait's reaction read only other people's, and read-slack-thread lists the bot's under ownReactions.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    channel: z.string().trim().min(1).max(64),
    ts: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(100),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    alreadyReacted: z.boolean(),
    externalRef: z.string(),
  }),
  http: false,
  mcpTool: false,
  audit: {
    recordInputs: false,
    target: (args: { channel: string; ts: string }) => ({
      type: "slack-message",
      ...(isSlackChannelId(args.channel) && isSlackTimestamp(args.ts)
        ? { id: `${args.channel}:${args.ts}` }
        : {}),
      visibility: "org",
    }),
    summary: (_args: unknown, _result: unknown, meta: { status: string }) => {
      const line = buildProviderApiAuditSummary({
        method: "POST",
        provider: "slack",
        path: "/reactions.add",
      });
      return meta.status === "success" ? line : `${line} (failed)`;
    },
  },
  run: async (
    { factoryId: requestedFactoryId, channel, ts, name },
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
    const { alreadyReacted, externalRef } = await addWorkflowSlackReaction(
      createSlackWorkflowClient({
        ownerEmail: caller.userEmail,
        orgId: caller.orgId,
      }),
      { workspace, channel, ts, name },
    );
    return { ok: true as const, alreadyReacted, externalRef };
  },
});
