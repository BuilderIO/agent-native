import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getChannelHistory,
  getTeamInfo,
  listChannels,
  resolveUsers,
  searchMessages,
  type SlackMessage,
  type Workspace,
} from "../server/lib/slack";
import {
  providerError,
  requireActionCredentials,
} from "./_provider-action-utils";

function parseWorkspace(raw?: string): Workspace {
  return raw === "secondary" ? "secondary" : "primary";
}

function enrichMessages(messages: SlackMessage[]): SlackMessage[] {
  return messages.map((message) => {
    const blocks = (message as any).blocks;
    if (!Array.isArray(blocks) || blocks.length <= 1) return message;
    const blockTexts = blocks
      .map((block: any) => {
        if (block.type === "section" || block.type === "rich_text") {
          return block.text?.text || (typeof block.text === "string"
            ? block.text
            : null);
        }
        return null;
      })
      .filter(Boolean);
    if (blockTexts.length <= 1) return message;
    return { ...message, text: blockTexts.join("\n") };
  });
}

export default defineAction({
  description:
    "Query the analytics app's configured Slack workspace: team info, channels, channel history, multi-channel history, or message search.",
  schema: z.object({
    mode: z
      .enum(["team", "channels", "history", "multi-history", "search"])
      .default("channels")
      .describe("What to query from Slack"),
    workspace: z
      .enum(["primary", "secondary"])
      .default("primary")
      .describe("Configured Slack workspace"),
    channel: z.string().optional().describe("Channel ID for mode=history"),
    channels: z
      .string()
      .optional()
      .describe("Comma-separated channel IDs for mode=multi-history"),
    names: z
      .string()
      .optional()
      .describe("Comma-separated display names matching channels"),
    query: z.string().optional().describe("Search query for mode=search"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe("Message limit for history"),
    cursor: z.string().optional().describe("Slack history cursor/latest ts"),
    cursors: z
      .record(z.string(), z.string())
      .optional()
      .describe("Per-channel cursors for mode=multi-history"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const workspace = parseWorkspace(args.workspace);
    const key =
      workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN";
    const credentials = await requireActionCredentials([key], "Slack");
    if (!credentials.ok) return credentials.response;

    try {
      if (args.mode === "team") {
        return { team: await getTeamInfo(workspace) };
      }

      if (args.mode === "history") {
        if (!args.channel) return { error: "channel is required" };
        const result = await getChannelHistory(
          workspace,
          args.channel,
          args.limit,
          args.cursor,
        );
        const messages = enrichMessages(result.messages);
        const userIds = messages
          .map((message) => message.user)
          .filter((id): id is string => !!id);
        const users = await resolveUsers(workspace, userIds, messages);
        return {
          messages,
          users,
          has_more: result.has_more,
          next_cursor: result.next_cursor,
        };
      }

      if (args.mode === "multi-history") {
        if (!args.channels) return { error: "channels is required" };
        const channelIds = args.channels.split(",").filter(Boolean);
        const channelNames = args.names ? args.names.split(",") : channelIds;
        const pageSize = Math.min(args.limit, 200);
        const results = await Promise.all(
          channelIds.map((id) =>
            getChannelHistory(workspace, id, pageSize, args.cursors?.[id]),
          ),
        );

        const allMessages: (SlackMessage & { channel_name: string })[] = [];
        const perChannelHasMore: Record<string, boolean> = {};
        const nextCursors: Record<string, string> = {};

        results.forEach((result, idx) => {
          const channelId = channelIds[idx];
          perChannelHasMore[channelId] = result.has_more;
          if (result.next_cursor) nextCursors[channelId] = result.next_cursor;
          for (const message of result.messages) {
            allMessages.push({
              ...message,
              channel_name: channelNames[idx] || channelId,
            });
          }
        });

        allMessages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
        const messages = enrichMessages(allMessages.slice(0, pageSize));
        const userIds = messages
          .map((message) => message.user)
          .filter((id): id is string => !!id);
        const users = await resolveUsers(workspace, userIds, messages);
        return {
          messages,
          users,
          has_more:
            Object.values(perChannelHasMore).some(Boolean) ||
            allMessages.length > pageSize,
          next_cursors: nextCursors,
          total: allMessages.length,
        };
      }

      if (args.mode === "search") {
        if (!args.query) return { error: "query is required" };
        const result = await searchMessages(workspace, args.query);
        const userIds = result.messages
          .map((message) => message.user)
          .filter((id): id is string => !!id);
        const users = await resolveUsers(workspace, userIds, result.messages);
        return { messages: result.messages, users, total: result.total };
      }

      const channels = await listChannels(workspace);
      return { channels, total: channels.length };
    } catch (err) {
      return providerError(err);
    }
  },
});
