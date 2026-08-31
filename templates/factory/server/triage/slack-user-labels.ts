import type { SlackMessage } from "../connectors/slack.js";
import { parseTriageMetadata } from "./metadata.js";

export const SLACK_USER_INFO_CONCURRENCY = 4;
export const SLACK_USER_INFO_MAX = 40;

export const SLACK_USER_MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/gi;

export function collectSlackUserIds(
  messages: Array<Pick<SlackMessage, "user" | "bot_id" | "username" | "text">>,
): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    const author = message.user?.trim();
    if (author && !message.bot_id && !message.username) ids.add(author);
    for (const mention of collectMentionIds(message.text ?? "")) {
      ids.add(mention);
    }
  }
  return [...ids];
}

export function collectMentionIds(text: string): string[] {
  const ids: string[] = [];
  const pattern = new RegExp(SLACK_USER_MENTION_RE.source, "gi");
  for (const match of text.matchAll(pattern)) {
    const id = match[1]?.trim();
    if (id) ids.push(id);
  }
  return ids;
}

export function slackUserLabel(
  user: { name: string | null; displayName: string | null } | null,
  userId: string,
): string {
  const displayName = user?.displayName?.trim();
  if (displayName) return displayName;
  const name = user?.name?.trim();
  if (name) return name.startsWith("@") ? name : `@${name}`;
  return userId;
}

export async function resolveSlackUserLabels(
  userIds: string[],
  lookup: (userId: string) => Promise<{
    name: string | null;
    displayName: string | null;
  }>,
  concurrency = SLACK_USER_INFO_CONCURRENCY,
): Promise<Map<string, string>> {
  const uniqueIds = [
    ...new Set(userIds.map((id) => id.trim()).filter(Boolean)),
  ].slice(0, SLACK_USER_INFO_MAX);
  const labels = new Map<string, string>();
  await mapWithConcurrency(uniqueIds, concurrency, async (userId) => {
    try {
      const user = await lookup(userId);
      labels.set(userId, slackUserLabel(user, userId));
    } catch {
      labels.set(userId, userId);
    }
  });
  return labels;
}

export function serializeUserLabels(labels: Map<string, string>): string {
  return JSON.stringify(Object.fromEntries(labels));
}

export function parseUserLabelsJson(value: unknown): Record<string, string> {
  if (value == null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return readLabelRecord(value as Record<string, unknown>);
  }
  if (typeof value !== "string") {
    throw new Error("Slack user labels are unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Slack user labels are unreadable.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Slack user labels are unreadable.");
  }
  return readLabelRecord(parsed as Record<string, unknown>);
}

export function readStoredUserLabels(
  metadataJson: string,
): Record<string, string> {
  const metadata = parseTriageMetadata(metadataJson);
  return parseUserLabelsJson(metadata.userLabelsJson ?? metadata.userLabels);
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      await mapper(values[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
}

function readLabelRecord(
  value: Record<string, unknown>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(value)) {
    if (typeof label !== "string" || !label.trim()) {
      throw new Error("Slack user labels are unreadable.");
    }
    labels[key] = label;
  }
  return labels;
}
