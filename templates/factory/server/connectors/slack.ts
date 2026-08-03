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

export interface ChannelHistoryResult {
  messages: SlackMessage[];
  has_more: boolean;
  next_cursor?: string;
}

const cache = new Map<string, { value: unknown; expiresAt: number }>();
const cacheTtlMs = 120_000;

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
  if (data.ok === false)
    throw new Error(`Slack API error: ${data.error ?? "unknown_error"}`);
  cache.set(cacheKey, { value: data, expiresAt: Date.now() + cacheTtlMs });
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
    const messages = data.messages ?? [];
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
    const joinedData = (await joined.json()) as { ok?: boolean };
    if (!joinedData.ok) throw error;
    const data = await slackApi<{
      messages?: SlackMessage[];
      has_more?: boolean;
    }>(workspace, "conversations.history", params, tokenResolver);
    const messages = data.messages ?? [];
    return {
      messages,
      has_more: Boolean(data.has_more),
      next_cursor: messages[messages.length - 1]?.ts,
    };
  }
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
