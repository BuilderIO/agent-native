import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
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

export const handleSlackTeam: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "SLACK_TOKEN", "Slack")) return;
  try {
    const workspace = parseWorkspace(req.query.workspace as string);
    const team = await getTeamInfo(workspace);
    res.json({ team });
  } catch (err: any) {
    console.error("Slack team error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleSlackChannels: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "SLACK_TOKEN", "Slack")) return;
  try {
    const workspace = parseWorkspace(req.query.workspace as string);
    const channels = await listChannels(workspace);
    res.json({ channels, total: channels.length });
  } catch (err: any) {
    console.error("Slack channels error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

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

export const handleSlackHistory: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "SLACK_TOKEN", "Slack")) return;
  try {
    const workspace = parseWorkspace(req.query.workspace as string);
    const channel = req.query.channel as string;
    const limit = parseInt((req.query.limit as string) || "50", 10);
    const cursor = (req.query.cursor as string) || undefined;

    if (!channel) {
      res.status(400).json({ error: "channel query parameter is required" });
      return;
    }

    const result = await getChannelHistory(
      workspace,
      channel,
      Math.min(limit, 200),
      cursor,
    );

    const userIds = result.messages
      .map((m) => m.user)
      .filter((id): id is string => !!id);
    const users = await resolveUsers(workspace, userIds, result.messages);

    const enrichedMessages = enrichMessages(result.messages);

    res.json({
      messages: enrichedMessages,
      users,
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    });
  } catch (err: any) {
    console.error("Slack history error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Multi-channel paginated history endpoint.
 * Fetches `pageSize` messages from each channel (using cursor if provided),
 * merges by timestamp, and returns the top `pageSize` messages.
 * Returns per-channel cursors for next page.
 */
export const handleSlackMultiHistory: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "SLACK_TOKEN", "Slack")) return;
  try {
    const workspace = parseWorkspace(req.query.workspace as string);
    const channelsParam = req.query.channels as string; // comma-separated IDs
    const namesParam = req.query.names as string; // comma-separated names
    const pageSize = parseInt((req.query.pageSize as string) || "20", 10);
    // cursors is a JSON-encoded object: { channelId: timestamp }
    const cursorsParam = (req.query.cursors as string) || undefined;

    if (!channelsParam) {
      res.status(400).json({ error: "channels query parameter is required" });
      return;
    }

    const channelIds = channelsParam.split(",").filter(Boolean);
    const channelNamesList = namesParam ? namesParam.split(",") : channelIds;
    const cursors: Record<string, string> = cursorsParam
      ? JSON.parse(cursorsParam)
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

    res.json({
      messages: enrichedMessages,
      users,
      has_more: hasMore,
      next_cursors: nextCursors,
      total: allMessages.length,
    });
  } catch (err: any) {
    console.error("Slack multi-history error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const handleSlackSearch: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "SLACK_TOKEN", "Slack")) return;
  try {
    const workspace = parseWorkspace(req.query.workspace as string);
    const query = req.query.query as string;

    if (!query) {
      res.status(400).json({ error: "query parameter is required" });
      return;
    }

    const result = await searchMessages(workspace, query);

    const userIds = result.messages
      .map((m) => m.user)
      .filter((id): id is string => !!id);
    const users = await resolveUsers(workspace, userIds, result.messages);

    res.json({ messages: result.messages, users, total: result.total });
  } catch (err: any) {
    console.error("Slack search error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
