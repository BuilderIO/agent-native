import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { triageConfig, triageItems } from "../server/db/schema.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { recordFactoryAudit } from "../server/triage/audit.js";
import { createSlackReader } from "../server/triage/slack-client.js";

export default defineAction({
  description:
    "Read the bounded full Slack thread for one Factory feedback item. Use this before deciding whether a report is a clear bug; unreadable or truncated context is not a green light.",
  schema: z.object({ itemId: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ itemId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const item = (
      await getDb()
        .select()
        .from(triageItems)
        .where(and(eq(triageItems.id, itemId), eq(triageItems.orgId, orgId)))
        .limit(1)
    )[0];
    if (!item) throw new Error("Factory item not found.");
    if (item.source !== "slack" || !item.channelId || !item.threadTs) {
      throw new Error("Factory item is not a readable Slack feedback item.");
    }

    const config = (
      await getDb()
        .select({ slackWorkspace: triageConfig.slackWorkspace })
        .from(triageConfig)
        .where(and(eq(triageConfig.id, orgId), eq(triageConfig.orgId, orgId)))
        .limit(1)
    )[0];
    const workspace =
      config?.slackWorkspace === "secondary" ? "secondary" : "primary";
    const slack = createSlackReader({ ownerEmail: userEmail, orgId });
    const { messages, hasMore } = await slack.getCompleteThread(
      workspace,
      item.channelId,
      item.threadTs,
    );

    await recordFactoryAudit(
      context,
      { userEmail, orgId },
      {
        action: "get-slack-feedback-context",
        kind: "read",
        itemId,
        source: "slack",
        sourceUrl: item.sourceUrl,
        summary: `Read the Slack thread (${messages.length} message${messages.length === 1 ? "" : "s"}).`,
        details: {
          channelId: item.channelId,
          threadTs: item.threadTs,
          coverage: hasMore ? "partial" : "complete",
          messageCount: messages.length,
        },
      },
    );

    return {
      ok: true,
      itemId,
      sourceUrl: item.sourceUrl,
      channelId: item.channelId,
      threadTs: item.threadTs,
      coverage: hasMore ? "partial" : "complete",
      messages: messages.map((message) => ({
        user: message.user ?? message.username ?? message.bot_id ?? null,
        username: message.username ?? null,
        botId: message.bot_id ?? null,
        text: message.text,
        ts: message.ts,
        threadTs: message.thread_ts ?? item.threadTs,
        replyCount: message.reply_count ?? 0,
        reactions: message.reactions ?? [],
      })),
    };
  },
});
