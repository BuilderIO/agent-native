import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { executeProviderApiRequest } from "../server/lib/provider-api.js";

const SlackPermalinkSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".slack.com") &&
      url.pathname.startsWith("/archives/")
    );
  }, "Expected an https Slack archive permalink.")
  .describe("Slack message permalink from the issue or feedback report.");

type SlackMessage = {
  ts?: string;
  thread_ts?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  blocks?: unknown;
  attachments?: unknown;
  files?: unknown;
  reactions?: unknown;
};

function parseSlackPermalink(permalink: string) {
  const url = new URL(permalink);
  const match = url.pathname.match(/^\/archives\/([^/]+)\/p(\d{16})$/);
  if (!match) {
    throw new Error(
      "Slack permalink must include a channel id and 16-digit message timestamp.",
    );
  }

  const [, channelId, compactTimestamp] = match;
  const linkedMessageTs = `${compactTimestamp.slice(0, 10)}.${compactTimestamp.slice(10)}`;
  const threadTs = url.searchParams.get("thread_ts") || linkedMessageTs;

  return { channelId, linkedMessageTs, threadTs };
}

function getResponseJson(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== "object") {
    throw new Error("Slack thread read returned no response metadata.");
  }

  const value = response as { json?: unknown; status?: number; ok?: boolean };
  if (value.ok !== true) {
    throw new Error(
      `Slack thread read failed with HTTP ${value.status ?? "unknown"}.`,
    );
  }
  if (!value.json || typeof value.json !== "object") {
    throw new Error("Slack thread read returned no JSON body.");
  }

  const body = value.json as Record<string, unknown>;
  if (body.ok !== true) {
    const error = typeof body.error === "string" ? body.error : "unknown_error";
    throw new Error(`Slack thread read failed: ${error}.`);
  }
  return body;
}

function collectLinks(value: unknown, links: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s<>|]+/g)) {
      links.add(match[0].replace(/[),.;]+$/, ""));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLinks(item, links);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "url" && typeof child === "string") links.add(child);
    else collectLinks(child, links);
  }
}

function projectMessage(message: SlackMessage) {
  return {
    ts: message.ts ?? null,
    threadTs: message.thread_ts ?? null,
    user: message.user ?? null,
    username: message.username ?? null,
    botId: message.bot_id ?? null,
    text: message.text ?? "",
    ...(message.blocks ? { blocks: message.blocks } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(message.files ? { files: message.files } : {}),
    ...(message.reactions ? { reactions: message.reactions } : {}),
  };
}

export default defineAction({
  description:
    "Read the complete Slack thread behind an issue permalink before diagnosing or fixing it. Resolves a child permalink to its parent, returns messages plus attachments and related links, and reports pagination completeness. Read-only; never joins a channel or sends a message.",
  schema: z.object({
    permalink: SlackPermalinkSchema,
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100)
      .describe("Maximum Slack messages to return in this page."),
    cursor: z
      .string()
      .optional()
      .describe("Slack response_metadata.next_cursor from a previous page."),
    connectionId: z
      .string()
      .optional()
      .describe(
        "Optional connected Slack workspace id when several are granted.",
      ),
  }),
  http: false,
  readOnly: true,
  run: async ({ permalink, limit, cursor, connectionId }) => {
    const parsed = parseSlackPermalink(permalink);
    const result = await executeProviderApiRequest({
      provider: "slack",
      method: "GET",
      path: "/conversations.replies",
      query: {
        channel: parsed.channelId,
        ts: parsed.threadTs,
        limit,
        ...(cursor ? { cursor } : {}),
      },
      connectionId,
      maxBytes: 2 * 1024 * 1024,
    });

    const response = (result as { response?: unknown }).response;
    const body = getResponseJson(response);
    const messages = Array.isArray(body.messages)
      ? (body.messages as SlackMessage[])
      : [];
    const nextCursor =
      body.response_metadata && typeof body.response_metadata === "object"
        ? (body.response_metadata as { next_cursor?: unknown }).next_cursor
        : null;
    const relatedLinks = new Set<string>();
    collectLinks(messages, relatedLinks);

    return {
      permalink,
      channelId: parsed.channelId,
      linkedMessageTs: parsed.linkedMessageTs,
      threadTs: parsed.threadTs,
      messages: messages.map(projectMessage),
      messageCount: messages.length,
      completeness: nextCursor ? "partial" : "complete",
      nextCursor:
        typeof nextCursor === "string" && nextCursor ? nextCursor : null,
      relatedLinks: [...relatedLinks],
    };
  },
});
