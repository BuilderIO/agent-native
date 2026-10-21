import type { SlackMessage, Workspace } from "../connectors/slack.js";
import { safeHttpUrl } from "../lib/safe-http-url";
import {
  PERSON_REACTIONS_KEY,
  PERSON_REACTORS_KEY,
  UNVERIFIED_REACTORS_KEY,
} from "../lib/source-reaction";
import type { IngestionEnvelope } from "./contracts";
import { createSlackReader } from "./slack-client";
import {
  collectSlackUserIds,
  resolveSlackUserLabels,
  serializeUserLabels,
  SLACK_USER_INFO_CONCURRENCY,
  SLACK_USER_INFO_MAX,
} from "./slack-user-labels";

const SLACK_HISTORY_LIMIT = 100;
const MAX_HISTORY_PAGES = 5;
const MAX_SUMMARY_LENGTH = 500;
export { SLACK_USER_INFO_CONCURRENCY };

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

function userLabelsForMessage(
  message: SlackMessage,
  userLabels?: Map<string, string>,
): { userLabelsJson: string } | Record<string, never> {
  if (!userLabels || userLabels.size === 0) return {};
  const subset = new Map<string, string>();
  for (const userId of collectSlackUserIds([message])) {
    const label = userLabels.get(userId);
    if (label) subset.set(userId, label);
  }
  if (subset.size === 0) return {};
  return { userLabelsJson: serializeUserLabels(subset) };
}

interface PersonReactions {
  /** Names of the reactions a person (or someone not known to be a bot) added. */
  names: string[];
  /** Slack ids of the people who added them. */
  people: string[];
  unverified: string[];
}

/** Whether a message starts its thread; a reply's reactions are the reply's, not the report's. */
function startsThread(message: SlackMessage): boolean {
  return !message.thread_ts || message.thread_ts === message.ts;
}

async function lookupBots(
  slack: ReturnType<typeof createSlackReader>,
  workspace: Workspace,
  userIds: string[],
): Promise<Map<string, boolean | undefined>> {
  const bots = new Map<string, boolean | undefined>();
  let next = 0;
  const worker = async () => {
    while (next < userIds.length) {
      const userId = userIds[next++]!;
      try {
        bots.set(userId, (await slack.getUserInfo(workspace, userId)).isBot);
      } catch {
        // A reactor that cannot be looked up stays unclassified and is recorded
        // as unverified, so it counts as a person instead of vanishing.
        bots.set(userId, undefined);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(SLACK_USER_INFO_CONCURRENCY, userIds.length) },
      worker,
    ),
  );
  return bots;
}

/**
 * Which reactions on each thread-starting message a person added. The
 * workspace's own bot never counts, nor does any user Slack says is a bot, so
 * only a human reacting claims a report. Someone Slack could not identify, or a
 * reactor list Slack cut short, is counted as a person and listed as
 * unverified: a claim missed would start Builder on a report a person has.
 */
async function readPersonReactions(
  slack: ReturnType<typeof createSlackReader>,
  workspace: Workspace,
  messages: SlackMessage[],
): Promise<Map<string, PersonReactions>> {
  const parents = messages.filter(startsThread);
  const reactors = [
    ...new Set(
      parents.flatMap((message) =>
        (message.reactions ?? []).flatMap((reaction) => reaction.users ?? []),
      ),
    ),
  ];
  const own =
    reactors.length > 0 ? await slack.getAgentNativeIdentity(workspace) : null;
  const others = reactors.filter((userId) => userId !== own?.userId);
  const lookedUp = await lookupBots(
    slack,
    workspace,
    others.slice(0, SLACK_USER_INFO_MAX),
  );

  const byMessage = new Map<string, PersonReactions>();
  for (const message of parents) {
    const names = new Set<string>();
    const people = new Set<string>();
    const unverified = new Set<string>();
    for (const reaction of message.reactions ?? []) {
      const users = reaction.users ?? [];
      for (const userId of users) {
        if (userId === own?.userId) continue;
        const isBot = lookedUp.get(userId);
        if (isBot === true) continue;
        names.add(reaction.name);
        if (isBot === false) people.add(userId);
        else unverified.add(userId);
      }
      const hidden = (reaction.count ?? users.length) - users.length;
      if (hidden > 0) {
        names.add(reaction.name);
        unverified.add(`${reaction.name}:+${hidden}`);
      }
    }
    byMessage.set(message.ts, {
      names: [...names].sort(),
      people: [...people].sort(),
      unverified: [...unverified].sort(),
    });
  }
  return byMessage;
}

function toEnvelope(
  channelId: string,
  message: SlackMessage,
  teamDomain?: string,
  userLabels?: Map<string, string>,
  reactions?: PersonReactions,
): IngestionEnvelope {
  const threadTs = message.thread_ts ?? message.ts;
  const suppliedPermalink = (message as SlackMessage & { permalink?: string })
    .permalink;
  const sourceUrl = safeHttpUrl(
    suppliedPermalink ??
      (teamDomain
        ? `https://${teamDomain}.slack.com/archives/${channelId}/p${message.ts.replace(".", "")}${threadTs !== message.ts ? `?thread_ts=${threadTs}` : ""}`
        : undefined),
  );

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
    metadata: {
      messageTs: message.ts,
      authorId: message.user ?? null,
      author: message.user ?? null,
      ...userLabelsForMessage(message, userLabels),
      ...(reactions
        ? {
            [PERSON_REACTIONS_KEY]: reactions.names,
            [PERSON_REACTORS_KEY]: reactions.people,
            ...(reactions.unverified.length > 0
              ? { [UNVERIFIED_REACTORS_KEY]: reactions.unverified }
              : {}),
          }
        : {}),
    },
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

  const userLabels = await resolveSlackUserLabels(
    collectSlackUserIds(uniqueNewMessages.map(({ message }) => message)),
    (userId) => slack.getUserInfo(workspace, userId),
  );

  const reactions = await readPersonReactions(
    slack,
    workspace,
    uniqueNewMessages.map(({ message }) => message),
  );

  return {
    envelopes: uniqueNewMessages.map(({ message }) =>
      toEnvelope(
        channelId,
        message,
        teamDomain,
        userLabels,
        reactions.get(message.ts),
      ),
    ),
    nextLastSlackTs: maxSeen.raw,
    nextHistoryCursor,
    hasMore,
  };
}
