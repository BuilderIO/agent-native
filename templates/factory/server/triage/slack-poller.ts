import type { SlackMessage, Workspace } from "../connectors/slack.js";
import type { IngestionEnvelope } from "./contracts";
import { createSlackReader } from "./slack-client";

const SLACK_HISTORY_LIMIT = 100;
const MAX_HISTORY_PAGES = 5;
const MAX_SUMMARY_LENGTH = 500;

export interface SlackPollInput {
  workspace: Workspace;
  channelId: string;
  priorLastSlackTs: string;
  historyCursor?: string | null;
  ownerEmail: string;
  orgId?: string | null;
}

export interface SlackPollResult {
  envelopes: IngestionEnvelope[];
  nextLastSlackTs: string;
  nextHistoryCursor: string | null;
  hasMore: boolean;
}

function numericTs(ts: string): number {
  const value = Number(ts);
  if (!Number.isFinite(value)) {
    throw new Error(`Slack message has an invalid timestamp: ${ts}`);
  }
  return value;
}

function compactText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > MAX_SUMMARY_LENGTH
    ? `${compact.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
    : compact;
}

function messageLabel(message: SlackMessage, resolvedLabel?: string): string {
  if (message.bot_id || message.username) {
    return `Slack bot ${message.username ?? message.bot_id ?? "unknown"}`;
  }
  return `Slack user ${resolvedLabel ?? message.user ?? "unknown"}`;
}

function slackUserLabel(
  user: { name: string | null; displayName: string | null } | null,
  userId: string,
): string {
  const displayName = user?.displayName?.trim();
  if (displayName) return displayName;
  const name = user?.name?.trim();
  if (name) return name.startsWith("@") ? name : `@${name}`;
  return userId;
}

async function resolveUserLabels(
  slack: ReturnType<typeof createSlackReader>,
  workspace: Workspace,
  messages: SlackMessage[],
): Promise<Map<string, string>> {
  const userIds = [
    ...new Set(
      messages
        .filter((message) => !message.bot_id && !message.username)
        .map((message) => message.user?.trim())
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
  const labels = new Map<string, string>();
  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const user = await slack.getUserInfo(workspace, userId);
        labels.set(userId, slackUserLabel(user, userId));
      } catch {
        labels.set(userId, userId);
      }
    }),
  );
  return labels;
}

function toEnvelope(
  channelId: string,
  message: SlackMessage,
  teamDomain?: string,
  userLabels?: Map<string, string>,
): IngestionEnvelope {
  const threadTs = message.thread_ts ?? message.ts;
  const suppliedPermalink = (message as SlackMessage & { permalink?: string })
    .permalink;
  const sourceUrl =
    suppliedPermalink ??
    (teamDomain
      ? `https://${teamDomain}.slack.com/archives/${channelId}/p${message.ts.replace(".", "")}${threadTs !== message.ts ? `?thread_ts=${threadTs}` : ""}`
      : undefined);

  return {
    source: "slack",
    externalId: `${channelId}:${threadTs}`,
    receivedAt: new Date().toISOString(),
    ...(sourceUrl ? { sourceUrl } : {}),
    title: messageLabel(
      message,
      message.user ? userLabels?.get(message.user) : undefined,
    ),
    summary: compactText(message.text),
    channelId,
    threadTs,
    metadata: { messageTs: message.ts },
    coverage:
      message.reply_count && message.reply_count > 0 ? "partial" : "complete",
  };
}

export async function pollSlackChannel({
  workspace,
  channelId,
  priorLastSlackTs,
  historyCursor,
  ownerEmail,
  orgId,
}: SlackPollInput): Promise<SlackPollResult> {
  const slack = createSlackReader({ ownerEmail, orgId });
  const priorTs = numericTs(priorLastSlackTs);
  const messages: SlackMessage[] = [];
  let cursor = historyCursor ?? undefined;
  let nextHistoryCursor: string | null = null;
  let hasMore = false;

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const history = cursor
      ? await slack.getChannelHistory(
          workspace,
          channelId,
          SLACK_HISTORY_LIMIT,
          cursor,
        )
      : await slack.getChannelHistory(
          workspace,
          channelId,
          SLACK_HISTORY_LIMIT,
        );
    messages.push(...history.messages);

    const reachedPriorMessage = history.messages.some(
      (message) => numericTs(message.ts) <= priorTs,
    );
    if (!history.has_more || reachedPriorMessage || !history.next_cursor) {
      nextHistoryCursor = null;
      hasMore = false;
      break;
    }

    nextHistoryCursor = history.next_cursor;
    hasMore = page === MAX_HISTORY_PAGES - 1;
    if (hasMore) break;
    cursor = history.next_cursor;
  }

  let teamDomain: string | undefined;
  try {
    const team = await slack.getTeamInfo(workspace);
    teamDomain = team.domain
      .replace(/^https?:\/\//, "")
      .replace(/\.slack\.com\/?$/, "")
      .replace(/\/$/, "");
    // coercion-ok: workspace metadata is optional; fetched channel history remains valid without it.
  } catch {
    // History remains useful when Slack does not expose workspace metadata.
  }

  const newMessages = messages
    .map((message) => ({ message, ts: numericTs(message.ts) }))
    .filter(({ ts }) => ts > priorTs)
    .sort((a, b) => a.ts - b.ts);
  const seenThreads = new Set<string>();
  const uniqueNewMessages = newMessages.filter(({ message }) => {
    const threadTs = message.thread_ts ?? message.ts;
    if (seenThreads.has(threadTs)) return false;
    seenThreads.add(threadTs);
    return true;
  });
  const maxSeen = messages.reduce(
    (max, message) => {
      const ts = numericTs(message.ts);
      return ts > max.value ? { value: ts, raw: message.ts } : max;
    },
    { value: priorTs, raw: priorLastSlackTs },
  );

  const userLabels = await resolveUserLabels(
    slack,
    workspace,
    uniqueNewMessages.map(({ message }) => message),
  );

  return {
    envelopes: uniqueNewMessages.map(({ message }) =>
      toEnvelope(channelId, message, teamDomain, userLabels),
    ),
    nextLastSlackTs: maxSeen.raw,
    nextHistoryCursor,
    hasMore,
  };
}
