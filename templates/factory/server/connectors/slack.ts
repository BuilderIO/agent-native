export type Workspace = "primary" | "secondary";

export type SlackTokenResolver = (workspace: Workspace) => Promise<string>;

export interface SlackMessage {
  type: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  permalink?: string;
}

export interface SlackTeamInfo {
  id: string;
  name: string;
  domain: string;
}

export interface SlackUserInfo {
  id: string;
  name: string | null;
  displayName: string | null;
}

export interface ChannelHistoryResult {
  messages: SlackMessage[];
  has_more: boolean;
  next_cursor?: string;
}

export interface ThreadRepliesResult {
  messages: SlackMessage[];
  has_more: boolean;
  next_cursor?: string;
}

export interface SlackReactionResult {
  added: boolean;
  already_present: boolean;
}

export interface SlackPostMessageResult {
  ok?: boolean;
  error?: string;
  channel: string;
  ts: string;
  message?: SlackMessage;
}

const cache = new Map<string, { value: unknown; expiresAt: number }>();
const cacheTtlMs = 120_000;

function invalidateWorkspaceCache(workspace: Workspace): void {
  const prefix = `${workspace}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

async function getToken(
  workspace: Workspace,
  tokenResolver?: SlackTokenResolver,
): Promise<string> {
  if (tokenResolver) return tokenResolver(workspace);
  throw new Error(
    `A workspace Slack credential resolver is required for the ${workspace} connection.`,
  );
}

async function slackApi<T>(
  workspace: Workspace,
  method: string,
  params: Record<string, string> | undefined,
  tokenResolver?: SlackTokenResolver,
): Promise<T> {
  const cacheKey = `${workspace}:${method}:${JSON.stringify(params ?? {})}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const token = await getToken(workspace, tokenResolver);
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params ?? {}))
    url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error(
      `Slack API error ${response.status}: ${await response.text()}`,
    );
  const data = (await response.json()) as T & { ok?: boolean; error?: string };
  if (data.ok !== true)
    throw new Error(`Slack API error: ${data.error ?? "unknown_error"}`);
  cache.set(cacheKey, { value: data, expiresAt: Date.now() + cacheTtlMs });
  return data;
}

async function slackWrite<T extends { ok?: boolean; error?: string }>(
  workspace: Workspace,
  method: string,
  body: Record<string, string>,
  tokenResolver?: SlackTokenResolver,
): Promise<T> {
  const token = await getToken(workspace, tokenResolver);
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      `Slack API error ${response.status}: ${await response.text()}`,
    );
  const data = (await response.json()) as T;
  if (data.ok !== true)
    throw new Error(`Slack API error: ${data.error ?? "unknown_error"}`);
  // A successful reaction or message write makes cached reads stale. This is
  // especially important when a retry follows a partially recorded handoff.
  invalidateWorkspaceCache(workspace);
  return data;
}

export async function getChannelHistory(
  workspace: Workspace,
  channelId: string,
  limit = 100,
  cursor?: string,
  tokenResolver?: SlackTokenResolver,
): Promise<ChannelHistoryResult> {
  const params: Record<string, string> = {
    channel: channelId,
    limit: String(Math.min(limit, 200)),
  };
  if (cursor) params.latest = cursor;
  try {
    const data = await slackApi<{
      messages?: SlackMessage[];
      has_more?: boolean;
    }>(workspace, "conversations.history", params, tokenResolver);
    if (!Array.isArray(data.messages)) {
      throw new Error("Slack history response is missing messages.");
    }
    const messages = data.messages;
    return {
      messages,
      has_more: Boolean(data.has_more),
      next_cursor: messages[messages.length - 1]?.ts,
    };
  } catch (error) {
    if (!String(error).includes("not_in_channel")) throw error;
    const token = await getToken(workspace, tokenResolver);
    const joined = await fetch("https://slack.com/api/conversations.join", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: channelId }),
    });
    const joinedData = (await joined.json()) as {
      ok?: boolean;
      error?: string;
    };
    if (joinedData.ok !== true) throw error;
    const data = await slackApi<{
      messages?: SlackMessage[];
      has_more?: boolean;
    }>(workspace, "conversations.history", params, tokenResolver);
    if (!Array.isArray(data.messages)) {
      throw new Error("Slack history response is missing messages.");
    }
    const messages = data.messages;
    return {
      messages,
      has_more: Boolean(data.has_more),
      next_cursor: messages[messages.length - 1]?.ts,
    };
  }
}

export async function getThread(
  workspace: Workspace,
  channelId: string,
  threadTs: string,
  limit = 100,
  cursor?: string,
  tokenResolver?: SlackTokenResolver,
): Promise<ThreadRepliesResult> {
  const params: Record<string, string> = {
    channel: channelId,
    ts: threadTs,
    limit: String(Math.min(Math.max(limit, 1), 100)),
  };
  if (cursor) params.cursor = cursor;
  const data = await slackApi<{
    messages?: SlackMessage[];
    has_more?: boolean;
    response_metadata?: { next_cursor?: string };
  }>(workspace, "conversations.replies", params, tokenResolver);
  if (!Array.isArray(data.messages)) {
    throw new Error("Slack thread response is missing messages.");
  }
  return {
    messages: data.messages,
    has_more: Boolean(data.has_more),
    next_cursor: data.response_metadata?.next_cursor || undefined,
  };
}

export async function addEyesReaction(
  workspace: Workspace,
  channelId: string,
  timestamp: string,
  tokenResolver?: SlackTokenResolver,
): Promise<SlackReactionResult> {
  try {
    await slackWrite(
      workspace,
      "reactions.add",
      { channel: channelId, timestamp, name: "eyes" },
      tokenResolver,
    );
    return { added: true, already_present: false };
  } catch (error) {
    if (!String(error).includes("already_reacted")) throw error;
    return { added: false, already_present: true };
  }
}

export async function postThreadReply(
  workspace: Workspace,
  channelId: string,
  threadTs: string,
  text: string,
  tokenResolver?: SlackTokenResolver,
): Promise<SlackPostMessageResult> {
  const data = await slackWrite<SlackPostMessageResult>(
    workspace,
    "chat.postMessage",
    { channel: channelId, thread_ts: threadTs, text },
    tokenResolver,
  );
  return data;
}

export async function getTeamInfo(
  workspace: Workspace,
  tokenResolver?: SlackTokenResolver,
): Promise<SlackTeamInfo> {
  const data = await slackApi<{ team?: SlackTeamInfo; team_id?: string }>(
    workspace,
    "team.info",
    undefined,
    tokenResolver,
  );
  return data.team ?? { id: data.team_id ?? "", name: workspace, domain: "" };
}

export async function getUserInfo(
  workspace: Workspace,
  userId: string,
  tokenResolver?: SlackTokenResolver,
): Promise<SlackUserInfo> {
  const id = userId.trim();
  if (!id) throw new Error("A Slack user id is required.");
  const data = await slackApi<{
    user?: {
      id?: string;
      name?: string;
      profile?: { display_name?: string };
    };
  }>(workspace, "users.info", { user: id }, tokenResolver);
  const user = data.user;
  if (!user || typeof user.id !== "string" || !user.id.trim()) {
    throw new Error("Slack user response is missing a user id.");
  }
  const displayName =
    typeof user.profile?.display_name === "string"
      ? user.profile.display_name.trim()
      : "";
  const name = typeof user.name === "string" ? user.name.trim() : "";
  return {
    id: user.id.trim(),
    name: name || null,
    displayName: displayName || null,
  };
}
