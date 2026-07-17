import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  requireCredential,
  runApiHandlerWithContext,
} from "../lib/credentials";
import {
  getChannelHistory,
  getTeamInfo,
  listChannelsWithCoverage,
  resolveUsersWithCoverage,
  searchMessages,
  type Workspace,
  type SlackMessage,
} from "../lib/slack";

function parseWorkspace(raw?: string): Workspace {
  return raw === "secondary" ? "secondary" : "primary";
}

async function requireSlackCredential(event: H3Event, workspace: Workspace) {
  const key =
    workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN";
  return requireCredential(event, key, "Slack");
}

export const handleSlackTeam = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    try {
      const { workspace: workspaceParam } = getQuery(event);
      const workspace = parseWorkspace(workspaceParam as string);
      const missing = await requireSlackCredential(event, workspace);
      if (missing) return missing;
      const team = await getTeamInfo(workspace);
      return { team };
    } catch (err: any) {
      console.error("Slack team error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

export const handleSlackChannels = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    try {
      const { workspace: workspaceParam, cursor } = getQuery(event);
      const workspace = parseWorkspace(workspaceParam as string);
      const missing = await requireSlackCredential(event, workspace);
      if (missing) return missing;
      const result = await listChannelsWithCoverage(
        workspace,
        cursor as string | undefined,
      );
      return {
        channels: result.channels,
        total: result.total,
        truncated: result.truncated,
        pagination: result.pagination,
        coverage: result.coverage,
      };
    } catch (err: any) {
      console.error("Slack channels error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

/** Reconstruct text from Slack blocks for better line-break formatting */
function enrichMessages(messages: SlackMessage[]): SlackMessage[] {
  return messages.map((m) => {
    const blocks = (m as any).blocks;
    if (!blocks || !Array.isArray(blocks) || blocks.length <= 1) return m;
    const blockTexts = blocks
      .map((b: any) => {
        if (b.type === "section" || b.type === "rich_text") {
          return b.text?.text || (typeof b.text === "string" ? b.text : null);
        }
        return null;
      })
      .filter(Boolean);
    if (blockTexts.length > 1) {
      return { ...m, text: blockTexts.join("\n") };
    }
    return m;
  });
}

export const handleSlackHistory = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    try {
      const {
        workspace: workspaceParam,
        channel,
        limit: limitParam,
        cursor,
      } = getQuery(event);
      const workspace = parseWorkspace(workspaceParam as string);
      const missing = await requireSlackCredential(event, workspace);
      if (missing) return missing;
      const limit = parseInt((limitParam as string) || "50", 10);

      if (!channel) {
        setResponseStatus(event, 400);
        return { error: "channel query parameter is required" };
      }

      const result = await getChannelHistory(
        workspace,
        channel as string,
        Math.min(limit, 200),
        cursor as string | undefined,
      );

      const userIds = result.messages
        .map((m) => m.user)
        .filter((id): id is string => !!id);
      const resolution = await resolveUsersWithCoverage(
        workspace,
        userIds,
        result.messages,
      );

      const enrichedMessages = enrichMessages(result.messages);

      return {
        messages: enrichedMessages,
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
          truncated: result.coverage.truncated || resolution.coverage.truncated,
          truncation_reasons: [
            ...result.coverage.truncation_reasons,
            ...resolution.coverage.truncation_reasons,
          ],
          authors: resolution.coverage,
        },
      };
    } catch (err: any) {
      console.error("Slack history error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

/**
 * Multi-channel paginated history endpoint.
 * Fetches `pageSize` messages from each channel (using cursor if provided),
 * merges by timestamp, and returns the top `pageSize` messages.
 * Returns per-channel cursors for next page.
 */
export const handleSlackMultiHistory = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    try {
      const {
        workspace: workspaceParam,
        channels: channelsParam,
        names: namesParam,
        pageSize: pageSizeParam,
        cursors: cursorsParam,
      } = getQuery(event);
      const workspace = parseWorkspace(workspaceParam as string);
      const missing = await requireSlackCredential(event, workspace);
      if (missing) return missing;
      // cursors is a JSON-encoded object: { channelId: timestamp }
      const pageSize = parseInt((pageSizeParam as string) || "20", 10);

      if (!channelsParam) {
        setResponseStatus(event, 400);
        return { error: "channels query parameter is required" };
      }

      const channelIds = (channelsParam as string).split(",").filter(Boolean);
      const channelNamesList = namesParam
        ? (namesParam as string).split(",")
        : channelIds;
      const cursors: Record<string, string> = cursorsParam
        ? JSON.parse(cursorsParam as string)
        : {};

      // Fetch pageSize messages from each channel in parallel
      const results = await Promise.all(
        channelIds.map((id) =>
          getChannelHistory(workspace, id, pageSize, cursors[id]),
        ),
      );

      // Tag messages with channel name and merge
      const allMessages: (SlackMessage & { channel_name: string })[] = [];
      const perChannelHasMore: Record<string, boolean> = {};
      const nextCursors: Record<string, string> = {};

      results.forEach((result, idx) => {
        const chId = channelIds[idx];
        const chName = channelNamesList[idx] || chId;
        perChannelHasMore[chId] = result.has_more;
        if (result.next_cursor) {
          nextCursors[chId] = result.next_cursor;
        }
        for (const m of result.messages) {
          allMessages.push({ ...m, channel_name: chName });
        }
      });

      // Sort merged by timestamp (newest first)
      allMessages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));

      // Take top pageSize
      const pageMessages = allMessages.slice(0, pageSize);

      // Enrich text from blocks
      const enrichedMessages = enrichMessages(pageMessages);

      // Resolve users
      const userIds = enrichedMessages
        .map((m) => m.user)
        .filter((id): id is string => !!id);
      const resolution = await resolveUsersWithCoverage(
        workspace,
        userIds,
        enrichedMessages,
      );

      // has_more is true if any channel has more messages
      const providerTruncated = results.some((result) => result.truncated);
      const mergedResultTruncated = allMessages.length > pageSize;
      const hasMore = providerTruncated || mergedResultTruncated;
      const truncationReasons = [
        ...(providerTruncated ? ["provider_has_more"] : []),
        ...(mergedResultTruncated ? ["merged_result_limit"] : []),
      ];

      return {
        messages: enrichedMessages,
        users: resolution.users,
        has_more: hasMore,
        next_cursors: nextCursors,
        total: allMessages.length,
        truncated: hasMore,
        pagination: {
          cursor_type: "per_channel_latest_ts",
          request_cursors: cursors,
          next_cursors: nextCursors,
          channels: Object.fromEntries(
            channelIds.map((channelId, index) => [
              channelId,
              results[index].pagination,
            ]),
          ),
        },
        coverage: {
          requested: channelIds.length * pageSize,
          fetched: allMessages.length,
          returned: enrichedMessages.length,
          pages_fetched: results.length,
          coverage_complete: !hasMore && resolution.coverage.coverage_complete,
          truncated: hasMore || resolution.coverage.truncated,
          truncation_reasons: [
            ...truncationReasons,
            ...resolution.coverage.truncation_reasons,
          ],
          channels: Object.fromEntries(
            channelIds.map((channelId, index) => [
              channelId,
              results[index].coverage,
            ]),
          ),
          authors: resolution.coverage,
        },
      };
    } catch (err: any) {
      console.error("Slack multi-history error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);

export const handleSlackSearch = defineEventHandler((event) =>
  runApiHandlerWithContext(event, async () => {
    try {
      const { workspace: workspaceParam, query } = getQuery(event);
      const workspace = parseWorkspace(workspaceParam as string);
      const missing = await requireSlackCredential(event, workspace);
      if (missing) return missing;

      if (!query) {
        setResponseStatus(event, 400);
        return { error: "query parameter is required" };
      }

      const result = await searchMessages(workspace, query as string);

      const userIds = result.messages
        .map((m) => m.user)
        .filter((id): id is string => !!id);
      const resolution = await resolveUsersWithCoverage(
        workspace,
        userIds,
        result.messages,
      );

      return {
        messages: result.messages,
        users: resolution.users,
        total: result.total,
        unsupported: result.unsupported,
        guidance: result.guidance,
        truncated: result.truncated,
        pagination: result.pagination,
        coverage: {
          ...result.coverage,
          coverage_complete:
            result.coverage.coverage_complete &&
            resolution.coverage.coverage_complete,
          truncated: result.coverage.truncated || resolution.coverage.truncated,
          truncation_reasons: [
            ...result.coverage.truncation_reasons,
            ...resolution.coverage.truncation_reasons,
          ],
          authors: resolution.coverage,
        },
      };
    } catch (err: any) {
      console.error("Slack search error:", err.message);
      setResponseStatus(event, 500);
      return { error: err.message };
    }
  }),
);
