import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getChannelHistory,
  getTeamInfo,
  listChannelsWithCoverage,
  resolveUsersWithCoverage,
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
          return (
            block.text?.text ||
            (typeof block.text === "string" ? block.text : null)
          );
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
    "Query the analytics app's configured Slack workspace: team info, channels, channel history, or multi-channel history. Slack messages returned by this action are real source evidence; you may count mentions, code themes, classify sentiment, and summarize qualitative patterns from them while stating the sample size. The legacy search mode is preserved for compatibility but returns migration guidance because the configured bot credential cannot call Slack global search; use the Slack provider corpus recipe for channel-scoped exhaustive search.",
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
    cursor: z
      .string()
      .optional()
      .describe("Slack history/latest timestamp or channel-list cursor"),
    cursors: z
      .record(z.string(), z.string())
      .optional()
      .describe("Per-channel cursors for mode=multi-history"),
  }),
  readOnly: true,
  run: async (args) => {
    const workspace = parseWorkspace(args.workspace);
    const key =
      workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN";
    const credentials = await requireActionCredentials([key], "Slack");
    if (credentials.ok === false) return credentials.response;

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
        const resolution = await resolveUsersWithCoverage(
          workspace,
          userIds,
          messages,
        );
        return {
          messages,
          users: resolution.users,
          has_more: result.has_more,
          next_cursor: result.next_cursor,
          truncated: result.truncated,
          pagination: result.pagination,
          coverage: {
            ...result.coverage,
            coverage_complete:
              result.coverage.coverage_complete &&
              resolution.coverage.coverage_complete,
            truncated:
              result.coverage.truncated || resolution.coverage.truncated,
            truncation_reasons: [
              ...result.coverage.truncation_reasons,
              ...resolution.coverage.truncation_reasons,
            ],
            authors: resolution.coverage,
          },
        };
      }

      if (args.mode === "multi-history") {
        if (!args.channels) return { error: "channels is required" };
        const channelIds = args.channels.split(",").filter(Boolean);
        const channelNames = args.names ? args.names.split(",") : channelIds;
        const pageSize = Math.min(args.limit, 200);
        const channelResults = await Promise.allSettled(
          channelIds.map((channelId) =>
            getChannelHistory(
              workspace,
              channelId,
              pageSize,
              args.cursors?.[channelId],
            ),
          ),
        );
        const successfulResults = channelResults.flatMap((entry, index) =>
          entry.status === "fulfilled"
            ? [{ channelId: channelIds[index], result: entry.value }]
            : [],
        );
        const failedChannelIds = channelResults.flatMap((entry, index) =>
          entry.status === "rejected" ? [channelIds[index]] : [],
        );

        const allMessages: (SlackMessage & {
          channel_id: string;
          channel_name: string;
        })[] = [];
        const perChannelHasMore: Record<string, boolean> = {};
        const nextCursors: Record<string, string> = {};

        successfulResults.forEach(({ channelId, result }) => {
          perChannelHasMore[channelId] = result.has_more;
          for (const message of result.messages) {
            allMessages.push({
              ...message,
              channel_id: channelId,
              channel_name:
                channelNames[channelIds.indexOf(channelId)] || channelId,
            });
          }
        });
        failedChannelIds.forEach((channelId) => {
          perChannelHasMore[channelId] = true;
        });

        allMessages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
        const pageMessages = allMessages.slice(0, pageSize);
        const emittedByChannel = new Map<string, SlackMessage[]>();
        for (const message of pageMessages) {
          const emitted = emittedByChannel.get(message.channel_id) ?? [];
          emitted.push(message);
          emittedByChannel.set(message.channel_id, emitted);
        }
        for (const channelId of channelIds) {
          const emitted = emittedByChannel.get(channelId);
          const nextCursor = emitted?.[emitted.length - 1]?.ts;
          if (nextCursor) nextCursors[channelId] = nextCursor;
          else if (args.cursors?.[channelId]) {
            nextCursors[channelId] = args.cursors[channelId];
          }
        }

        const messages = pageMessages.map((message) => {
          const enriched = enrichMessages([message])[0] ?? message;
          const { channel_id: _channelId, ...rest } =
            enriched as typeof message;
          return rest;
        });
        const userIds = messages
          .map((message) => message.user)
          .filter((id): id is string => !!id);
        const resolution = await resolveUsersWithCoverage(
          workspace,
          userIds,
          messages,
        );
        const providerTruncated = successfulResults.some(
          ({ result }) => result.truncated,
        );
        const mergedResultTruncated = allMessages.length > pageSize;
        const truncated =
          providerTruncated ||
          mergedResultTruncated ||
          failedChannelIds.length > 0;
        const truncationReasons = [
          ...(providerTruncated ? ["provider_has_more"] : []),
          ...(mergedResultTruncated ? ["merged_result_limit"] : []),
          ...failedChannelIds.map(
            (channelId) => `channel_fetch_failed:${channelId}`,
          ),
        ];
        const channelPagination = Object.fromEntries(
          channelResults.map((entry, index) => [
            channelIds[index],
            entry.status === "fulfilled"
              ? entry.value.pagination
              : {
                  cursor_type: "latest_ts" as const,
                  ...(args.cursors?.[channelIds[index]]
                    ? { request_cursor: args.cursors[channelIds[index]] }
                    : {}),
                },
          ]),
        );
        const channelCoverage = Object.fromEntries(
          channelResults.map((entry, index) => [
            channelIds[index],
            entry.status === "fulfilled"
              ? entry.value.coverage
              : {
                  requested: pageSize,
                  fetched: 0,
                  returned: 0,
                  pages_fetched: 0,
                  coverage_complete: false,
                  truncated: true,
                  truncation_reasons: [
                    `channel_fetch_failed:${channelIds[index]}`,
                  ],
                },
          ]),
        );
        return {
          messages,
          users: resolution.users,
          has_more:
            Object.values(perChannelHasMore).some(Boolean) ||
            allMessages.length > pageSize ||
            failedChannelIds.length > 0,
          next_cursors: nextCursors,
          total: allMessages.length,
          truncated,
          pagination: {
            cursor_type: "per_channel_latest_ts",
            request_cursors: args.cursors ?? {},
            next_cursors: nextCursors,
            channels: channelPagination,
          },
          coverage: {
            requested: channelIds.length * pageSize,
            fetched: allMessages.length,
            returned: messages.length,
            pages_fetched: successfulResults.length,
            coverage_complete:
              !truncated && resolution.coverage.coverage_complete,
            truncated: truncated || resolution.coverage.truncated,
            truncation_reasons: [
              ...truncationReasons,
              ...resolution.coverage.truncation_reasons,
            ],
            channels: channelCoverage,
            authors: resolution.coverage,
          },
        };
      }

      if (args.mode === "search") {
        if (!args.query) return { error: "query is required" };
        return {
          messages: [],
          users: {},
          total: 0,
          unsupported: true,
          truncated: true,
          coverage: {
            requested: 0,
            fetched: 0,
            returned: 0,
            pages_fetched: 0,
            coverage_complete: false,
            truncated: true,
            truncation_reasons: ["bot_token_global_search_unsupported"],
          },
          guidance:
            "Slack global search is not available with the configured bot credential. Resolve a channel id, then use provider-api-catalog(provider='slack') and provider-corpus-job with the Slack conversations.history corpus recipe so cursor pages are fetched inside one resumable operation.",
        };
      }

      const result = await listChannelsWithCoverage(workspace, args.cursor);
      return {
        channels: result.channels,
        total: result.total,
        truncated: result.truncated,
        pagination: result.pagination,
        coverage: result.coverage,
      };
    } catch (err) {
      return providerError(err);
    }
  },
});
