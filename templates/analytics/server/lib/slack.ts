// Slack API client for fetching channel messages and searching across workspaces

import { resolveCredential } from "./credentials";

export type Workspace = "primary" | "secondary";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_CACHE = 200;

async function getToken(workspace: Workspace): Promise<string> {
  const envKey =
    workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN";
  const token = await resolveCredential(envKey);
  if (!token) {
    throw new Error(`${envKey} env var is required`);
  }
  return token;
}

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.data as T;
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function slackApi<T>(
  workspace: Workspace,
  method: string,
  params?: Record<string, string>,
  useCache = true,
): Promise<T> {
  const cacheKey = `slack:${workspace}:${method}:${JSON.stringify(params ?? {})}`;
  if (useCache) {
    const cached = cacheGet<T>(cacheKey);
    if (cached) return cached;
  }

  const token = await getToken(workspace);
  const url = new URL(`https://slack.com/api/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Slack API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  if (useCache) cacheSet(cacheKey, data);
  return data as T;
}

// -- Types --

export interface SlackChannel {
  id: string;
  name: string;
  topic: { value: string };
  purpose: { value: string };
  num_members: number;
  is_archived: boolean;
}

export interface SlackMessage {
  type: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: { name: string; count: number }[];
  files?: { name: string; mimetype: string; url_private: string }[];
  icons?: { image_48?: string; image_72?: string };
}

export interface SlackBotInfo {
  id: string;
  name: string;
  icons?: { image_48?: string; image_72?: string };
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: {
    display_name: string;
    image_48: string;
    image_72: string;
  };
}

export interface SlackTeamInfo {
  id: string;
  name: string;
  domain: string;
  icon?: { image_68?: string };
}

// User cache (keyed by workspace + userId)
const userCache = new Map<string, SlackUser>();

// -- API functions --

export async function getTeamInfo(
  workspace: Workspace,
): Promise<SlackTeamInfo> {
  const data = await slackApi<{ team: SlackTeamInfo }>(
    workspace,
    "auth.test",
    undefined,
    true,
  );
  // auth.test returns flat fields, not nested team object
  const teamData = data as any;
  // Need team.info for full team name
  try {
    const info = await slackApi<{ team: SlackTeamInfo }>(
      workspace,
      "team.info",
      undefined,
      true,
    );
    return info.team;
  } catch {
    return {
      id: teamData.team_id || "",
      name: teamData.team || workspace,
      domain: teamData.url || "",
    };
  }
}

export async function listChannels(
  workspace: Workspace,
): Promise<SlackChannel[]> {
  const all: SlackChannel[] = [];
  let cursor: string | undefined;

  // Paginate through all channels
  for (let i = 0; i < 10; i++) {
    const params: Record<string, string> = {
      types: "public_channel",
      exclude_archived: "true",
      limit: "200",
    };
    if (cursor) params.cursor = cursor;

    const data = await slackApi<{
      channels: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>(workspace, "conversations.list", params, !cursor); // cache first page only

    all.push(...(data.channels || []));
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return all;
}

export interface ChannelHistoryResult {
  messages: SlackMessage[];
  has_more: boolean;
  next_cursor?: string; // timestamp of last message
}

export async function getChannelHistory(
  workspace: Workspace,
  channelId: string,
  limit = 50,
  cursor?: string, // pass as "latest" to Slack
): Promise<ChannelHistoryResult> {
  try {
    const params: Record<string, string> = {
      channel: channelId,
      limit: String(Math.min(limit, 200)),
    };
    if (cursor) params.latest = cursor;

    const data = await slackApi<{
      messages: SlackMessage[];
      has_more?: boolean;
    }>(workspace, "conversations.history", params, false);
    const messages = data.messages || [];
    return {
      messages,
      has_more: !!data.has_more,
      next_cursor:
        messages.length > 0 ? messages[messages.length - 1].ts : undefined,
    };
  } catch (err: any) {
    if (err.message?.includes("not_in_channel")) {
      // Try to auto-join the channel (requires channels:join scope)
      try {
        const token = await getToken(workspace);
        const joinRes = await fetch(
          "https://slack.com/api/conversations.join",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ channel: channelId }),
          },
        );
        const joinData = await joinRes.json();
        if (joinData.ok) {
          // Joined successfully, retry history
          const data = await slackApi<{
            messages: SlackMessage[];
            has_more?: boolean;
          }>(
            workspace,
            "conversations.history",
            {
              channel: channelId,
              limit: String(Math.min(limit, 200)),
            },
            false,
          );
          const msgs = data.messages || [];
          return {
            messages: msgs,
            has_more: !!data.has_more,
            next_cursor: msgs.length > 0 ? msgs[msgs.length - 1].ts : undefined,
          };
        }
      } catch {
        // join failed, fall through to friendly error
      }
      throw new Error(
        "Bot is not in this channel. Please invite the bot to the channel in Slack: " +
          "open the channel, click the channel name, go to Integrations > Add apps, " +
          "and add the Analytics bot.",
      );
    }
    throw err;
  }
}

export async function searchMessages(
  workspace: Workspace,
  query: string,
  count = 50,
): Promise<{ messages: SlackMessage[]; total: number }> {
  // search.messages requires a user token, but we'll try with bot token
  // If it fails, we'll fall back to channel history filtering
  const data = await slackApi<{
    messages: { matches: SlackMessage[]; total: number };
  }>(
    workspace,
    "search.messages",
    {
      query,
      count: String(Math.min(count, 100)),
      sort: "timestamp",
      sort_dir: "desc",
    },
    false,
  );
  return {
    messages: data.messages?.matches || [],
    total: data.messages?.total || 0,
  };
}

export async function getUserInfo(
  workspace: Workspace,
  userId: string,
): Promise<SlackUser> {
  const cacheKey = `${workspace}:${userId}`;
  const cached = userCache.get(cacheKey);
  if (cached) return cached;

  const data = await slackApi<{ user: SlackUser }>(
    workspace,
    "users.info",
    { user: userId },
    true,
  );

  userCache.set(cacheKey, data.user);
  return data.user;
}

const botCache = new Map<string, SlackBotInfo>();

export async function getBotInfo(
  workspace: Workspace,
  botId: string,
): Promise<SlackBotInfo> {
  const cacheKey = `${workspace}:bot:${botId}`;
  const cached = botCache.get(cacheKey);
  if (cached) return cached;

  const data = await slackApi<{ bot: SlackBotInfo }>(
    workspace,
    "bots.info",
    { bot: botId },
    true,
  );

  botCache.set(cacheKey, data.bot);
  return data.bot;
}

export async function resolveUsers(
  workspace: Workspace,
  userIds: string[],
  messages?: SlackMessage[],
): Promise<Record<string, SlackUser>> {
  const unique = [...new Set(userIds)];
  const results: Record<string, SlackUser> = {};

  await Promise.all(
    unique.map(async (id) => {
      try {
        results[id] = await getUserInfo(workspace, id);
      } catch {
        results[id] = {
          id,
          name: id,
          real_name: id,
          profile: { display_name: id, image_48: "", image_72: "" },
        };
      }
    }),
  );

  // Resolve bot users from messages that have bot_id but no user
  if (messages) {
    const botIds = [
      ...new Set(
        messages
          .filter((m) => m.bot_id && !results[m.bot_id])
          .map((m) => m.bot_id!),
      ),
    ];

    await Promise.all(
      botIds.map(async (botId) => {
        try {
          const bot = await getBotInfo(workspace, botId);
          results[botId] = {
            id: botId,
            name: bot.name,
            real_name: bot.name,
            profile: {
              display_name: bot.name,
              image_48: bot.icons?.image_48 || "",
              image_72: bot.icons?.image_72 || "",
            },
          };
        } catch {
          // Use the username from the message if available
          const msg = messages.find((m) => m.bot_id === botId);
          results[botId] = {
            id: botId,
            name: msg?.username || botId,
            real_name: msg?.username || botId,
            profile: {
              display_name: msg?.username || botId,
              image_48: msg?.icons?.image_48 || "",
              image_72: msg?.icons?.image_72 || "",
            },
          };
        }
      }),
    );
  }

  return results;
}

/**
 * Send a direct message to a user by email.
 * First looks up the user by email, then opens/retrieves a DM channel, then sends the message.
 *
 * @param workspace - Which Slack workspace to use
 * @param email - User's email address
 * @param message - Message text to send (supports Slack mrkdwn formatting)
 * @returns true if successful, false if user not found or message failed
 */
export async function sendDirectMessage(
  workspace: Workspace,
  email: string,
  message: string,
): Promise<boolean> {
  try {
    // Step 1: Look up user by email
    const userLookup = await slackApi<{ user?: { id: string } }>(
      workspace,
      "users.lookupByEmail",
      { email },
      false, // Don't cache user lookups
    );

    if (!userLookup.user?.id) {
      console.warn(`Slack user not found for email: ${email}`);
      return false;
    }

    const userId = userLookup.user.id;

    // Step 2: Open/get DM channel
    const token = await getToken(workspace);
    const openRes = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ users: userId }),
    });

    const openData = await openRes.json();
    if (!openData.ok || !openData.channel?.id) {
      console.error("Failed to open Slack DM channel:", openData.error);
      return false;
    }

    const channelId = openData.channel.id;

    // Step 3: Send message
    const msgRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        text: message,
        mrkdwn: true,
      }),
    });

    const msgData = await msgRes.json();
    if (!msgData.ok) {
      console.error("Failed to send Slack message:", msgData.error);
      return false;
    }

    return true;
  } catch (err: any) {
    console.error("Slack DM error:", err.message);
    return false;
  }
}
