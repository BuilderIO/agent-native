import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";
import { resolveAnalyticsProviderCredential } from "./provider-credentials";

export type Workspace = "primary" | "secondary";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_CACHE = 200;
const MAX_CHANNEL_PAGES = 10;
const MAX_USER_PAGES = 10;
const SLACK_PAGE_SIZE = 200;

async function getToken(workspace: Workspace): Promise<string> {
  const envKey =
    workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN";
  const ctx = requireRequestCredentialContext(envKey);
  const credential = await resolveAnalyticsProviderCredential({
    provider: "slack",
    keys: [envKey],
    ctx,
    workspaceConnection: workspace === "primary",
  });
  if (!credential) {
    throw new Error(`${envKey} not configured`);
  }
  return credential.value;
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
  const envKey =
    workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN";
  const cacheKey = scopedCredentialCacheKey(
    `slack:${workspace}:${method}:${JSON.stringify(params ?? {})}`,
    envKey,
  );
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

export interface SlackPaginationMetadata {
  cursor_type: "response_metadata" | "latest_ts" | "page" | "none";
  request_cursor?: string;
  next_cursor?: string;
  provider_next_cursor?: string;
  page?: number;
  pages?: number;
  next_page?: number;
}

export interface SlackCoverageMetadata {
  requested: number;
  fetched: number;
  returned: number;
  total?: number;
  pages_fetched: number;
  coverage_complete: boolean;
  truncated: boolean;
  truncation_reasons: string[];
}

export interface SlackAuthorCoverageMetadata {
  requested_users: number;
  resolved_users: number;
  unresolved_user_ids: string[];
  requested_bots: number;
  resolved_bots: number;
  unresolved_bot_ids: string[];
  directory_pages_fetched: number;
  directory_next_cursor?: string;
  coverage_complete: boolean;
  truncated: boolean;
  truncation_reasons: string[];
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

export async function listChannelsWithCoverage(
  workspace: Workspace,
  requestCursor?: string,
): Promise<{
  channels: SlackChannel[];
  total: number;
  truncated: boolean;
  pagination: SlackPaginationMetadata;
  coverage: SlackCoverageMetadata;
}> {
  const all: SlackChannel[] = [];
  let cursor = requestCursor;
  let pagesFetched = 0;

  // Paginate through the bounded channel directory.
  for (let i = 0; i < MAX_CHANNEL_PAGES; i++) {
    const params: Record<string, string> = {
      types: "public_channel",
      exclude_archived: "true",
      limit: String(SLACK_PAGE_SIZE),
    };
    if (cursor) params.cursor = cursor;

    const data = await slackApi<{
      channels: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>(workspace, "conversations.list", params, !cursor); // cache first page only

    all.push(...(data.channels || []));
    pagesFetched += 1;
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  const truncated = Boolean(cursor);
  return {
    channels: all,
    total: all.length,
    truncated,
    pagination: {
      cursor_type: "response_metadata",
      ...(requestCursor ? { request_cursor: requestCursor } : {}),
      ...(cursor ? { next_cursor: cursor } : {}),
    },
    coverage: {
      requested: MAX_CHANNEL_PAGES * SLACK_PAGE_SIZE,
      fetched: all.length,
      returned: all.length,
      pages_fetched: pagesFetched,
      coverage_complete: !truncated,
      truncated,
      truncation_reasons: truncated ? ["page_cap"] : [],
    },
  };
}

export async function listChannels(
  workspace: Workspace,
): Promise<SlackChannel[]> {
  return (await listChannelsWithCoverage(workspace)).channels;
}

export interface ChannelHistoryResult {
  messages: SlackMessage[];
  has_more: boolean;
  next_cursor?: string; // timestamp of last message
  truncated: boolean;
  pagination: SlackPaginationMetadata;
  coverage: SlackCoverageMetadata;
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
      response_metadata?: { next_cursor?: string };
    }>(workspace, "conversations.history", params, false);
    const messages = data.messages || [];
    const nextCursor =
      messages.length > 0 ? messages[messages.length - 1].ts : undefined;
    const providerNextCursor = data.response_metadata?.next_cursor || undefined;
    const hasMore = Boolean(data.has_more || providerNextCursor);
    return {
      messages,
      has_more: hasMore,
      next_cursor: nextCursor,
      truncated: hasMore,
      pagination: {
        cursor_type: "latest_ts",
        ...(cursor ? { request_cursor: cursor } : {}),
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
        ...(providerNextCursor
          ? { provider_next_cursor: providerNextCursor }
          : {}),
      },
      coverage: {
        requested: Math.min(limit, SLACK_PAGE_SIZE),
        fetched: messages.length,
        returned: messages.length,
        pages_fetched: 1,
        coverage_complete: !hasMore,
        truncated: hasMore,
        truncation_reasons: hasMore ? ["provider_has_more"] : [],
      },
    };
  } catch (err: any) {
    if (err.message?.includes("not_in_channel")) {
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
  _workspace: Workspace,
  _query: string,
  _count = 50,
): Promise<{
  messages: SlackMessage[];
  total: number;
  unsupported: true;
  truncated: boolean;
  pagination: SlackPaginationMetadata;
  coverage: SlackCoverageMetadata;
  guidance: string;
}> {
  return {
    messages: [],
    total: 0,
    unsupported: true,
    truncated: true,
    pagination: { cursor_type: "none" },
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
      "Slack search.messages is unavailable with the configured bot credential. Use conversations.history through the shared Slack corpus recipe for a known channel.",
  };
}

export async function getUserInfo(
  workspace: Workspace,
  userId: string,
): Promise<SlackUser> {
  const cacheKey = slackUserCacheKey(workspace, userId);
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
  const cacheKey = scopedCredentialCacheKey(
    `${workspace}:bot:${botId}`,
    workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN",
  );
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
  return (await resolveUsersWithCoverage(workspace, userIds, messages)).users;
}

export async function resolveUsersWithCoverage(
  workspace: Workspace,
  userIds: string[],
  messages?: SlackMessage[],
): Promise<{
  users: Record<string, SlackUser>;
  coverage: SlackAuthorCoverageMetadata;
}> {
  const unique = [...new Set(userIds)];
  const results: Record<string, SlackUser> = {};
  const unresolvedUsers = new Set(unique);
  let directoryPagesFetched = 0;
  let directoryNextCursor: string | undefined;
  let directoryError = false;

  for (const id of unique) {
    const cacheKey = slackUserCacheKey(workspace, id);
    const cached = userCache.get(cacheKey);
    if (!cached) continue;
    results[id] = cached;
    unresolvedUsers.delete(id);
  }

  try {
    while (unresolvedUsers.size > 0 && directoryPagesFetched < MAX_USER_PAGES) {
      const params: Record<string, string> = {
        limit: String(SLACK_PAGE_SIZE),
      };
      if (directoryNextCursor) params.cursor = directoryNextCursor;
      const data = await slackApi<{
        members: SlackUser[];
        response_metadata?: { next_cursor?: string };
      }>(workspace, "users.list", params, true);
      directoryPagesFetched += 1;

      for (const user of data.members || []) {
        userCache.set(slackUserCacheKey(workspace, user.id), user);
        if (!unresolvedUsers.has(user.id)) continue;
        results[user.id] = user;
        unresolvedUsers.delete(user.id);
      }

      directoryNextCursor = data.response_metadata?.next_cursor || undefined;
      if (!directoryNextCursor) break;
    }
  } catch {
    directoryError = true;
  }

  const unresolvedUserIds = [...unresolvedUsers];
  for (const id of unresolvedUserIds) {
    results[id] = fallbackSlackUser(id);
  }

  // Resolve bot users from messages that have bot_id but no user
  let resolvedBots = 0;
  const unresolvedBotIds: string[] = [];
  const botIds: string[] = [];
  if (messages) {
    botIds.push(
      ...new Set(
        messages
          .filter((m) => m.bot_id && !results[m.bot_id])
          .map((m) => m.bot_id!),
      ),
    );

    await Promise.all(
      botIds.map(async (botId) => {
        try {
          const bot = await getBotInfo(workspace, botId);
          resolvedBots += 1;
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
          unresolvedBotIds.push(botId);
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

  const directoryTruncated =
    unresolvedUsers.size > 0 && Boolean(directoryNextCursor);
  const coverageComplete =
    unresolvedUserIds.length === 0 && unresolvedBotIds.length === 0;
  const truncationReasons = [
    ...(directoryTruncated ? ["user_directory_page_cap"] : []),
    ...(directoryError ? ["user_directory_error"] : []),
    ...(unresolvedUserIds.length > 0 && !directoryTruncated && !directoryError
      ? ["users_not_found"]
      : []),
    ...(unresolvedBotIds.length > 0 ? ["bots_not_found"] : []),
  ];

  return {
    users: results,
    coverage: {
      requested_users: unique.length,
      resolved_users: unique.length - unresolvedUserIds.length,
      unresolved_user_ids: unresolvedUserIds,
      requested_bots: botIds.length,
      resolved_bots: resolvedBots,
      unresolved_bot_ids: unresolvedBotIds,
      directory_pages_fetched: directoryPagesFetched,
      ...(directoryNextCursor
        ? { directory_next_cursor: directoryNextCursor }
        : {}),
      coverage_complete: coverageComplete,
      truncated: !coverageComplete,
      truncation_reasons: truncationReasons,
    },
  };
}

function slackUserCacheKey(workspace: Workspace, userId: string): string {
  return scopedCredentialCacheKey(
    `${workspace}:${userId}`,
    workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN",
  );
}

function fallbackSlackUser(id: string): SlackUser {
  return {
    id,
    name: id,
    real_name: id,
    profile: { display_name: id, image_48: "", image_72: "" },
  };
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
