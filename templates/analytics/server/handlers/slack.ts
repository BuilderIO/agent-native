import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { requireCredential } from "../lib/credentials";
import {
  listChannels,
  getChannelHistory,
  searchMessages,
  resolveUsers,
  getTeamInfo,
  type Workspace,
  type SlackMessage,
} from "../lib/slack";

function parseWorkspace(raw?: string): Workspace {
  return raw === "secondary" ? "secondary" : "primary";
}

export const handleSlackTeam = defineEventHandler(async (event) => {
  const missing = await requireCredential(event, "SLACK_TOKEN", "Slack");
  if (missing) return missing;
  try {
    const { workspace: workspaceParam } = getQuery(event);
    const workspace = parseWorkspace(workspaceParam as string);
    const team = await getTeamInfo(workspace);
    return { team };
  } catch (err: any) {
    console.error("Slack team error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const handleSlackChannels = defineEventHandler(async (event) => {
  const missing = await requireCredential(event, "SLACK_TOKEN", "Slack");
  if (missing) return missing;
  try {
    const { workspace: workspaceParam } = getQuery(event);
    const workspace = parseWorkspace(workspaceParam as string);
    const channels = await listChannels(workspace);
    return { channels, total: channels.length };
  } catch (err: any) {
    console.error("Slack channels error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

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

export const handleSlackHistory = defineEventHandler(async (event) => {
  const missing = await requireCredential(event, "SLACK_TOKEN", "Slack");
  if (missing) return missing;
  try {
    const {
      workspace: workspaceParam,
      channel,
      limit: limitParam,
      cursor,
    } = getQuery(event);
    const workspace = parseWorkspace(workspaceParam as string);
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
    const users = await resolveUsers(workspace, userIds, result.messages);

    const enrichedMessages = enrichMessages(result.messages);

    return {
      messages: enrichedMessages,
      users,
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    };
  } catch (err: any) {
    console.error("Slack history error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

/**
 * Multi-channel paginated history endpoint.
 * Fetches `pageSize` messages from each channel (using cursor if provided),
 * merges by timestamp, and returns the top `pageSize` messages.
 * Returns per-channel cursors for next page.
 */
export const handleSlackMultiHistory = defineEventHandler(async (event) => {
  const missing = await requireCredential(event, "SLACK_TOKEN", "Slack");
  if (missing) return missing;
  try {
    const {
      workspace: workspaceParam,
      channels: channelsParam,
      names: namesParam,
      pageSize: pageSizeParam,
      cursors: cursorsParam,
    } = getQuery(event);
    const workspace = parseWorkspace(workspaceParam as string);
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
    const users = await resolveUsers(workspace, userIds, enrichedMessages);

    // has_more is true if any channel has more messages
    const hasMore =
      Object.values(perChannelHasMore).some(Boolean) ||
      allMessages.length > pageSize;

    return {
      messages: enrichedMessages,
      users,
      has_more: hasMore,
      next_cursors: nextCursors,
      total: allMessages.length,
    };
  } catch (err: any) {
    console.error("Slack multi-history error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const handleSlackSearch = defineEventHandler(async (event) => {
  const missing = await requireCredential(event, "SLACK_TOKEN", "Slack");
  if (missing) return missing;
  try {
    const { workspace: workspaceParam, query } = getQuery(event);
    const workspace = parseWorkspace(workspaceParam as string);

    if (!query) {
      setResponseStatus(event, 400);
      return { error: "query parameter is required" };
    }

    const result = await searchMessages(workspace, query as string);

    const userIds = result.messages
      .map((m) => m.user)
      .filter((id): id is string => !!id);
    const users = await resolveUsers(workspace, userIds, result.messages);

    return { messages: result.messages, users, total: result.total };
  } catch (err: any) {
    console.error("Slack search error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
