import type { H3Event } from "h3";
import { getHeader } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
  OutboundTarget,
} from "../types.js";
import type { EnvKeyConfig } from "../../server/create-server.js";
import { getIntegrationConfig } from "../config-store.js";
import { readBody } from "../../server/h3-helpers.js";

/** Slack's max message length */
const SLACK_MAX_LENGTH = 4000;

/**
 * Create a Slack platform adapter.
 *
 * Required env vars:
 * - SLACK_BOT_TOKEN — Bot user OAuth token (xoxb-...)
 * - SLACK_SIGNING_SECRET — Used to verify webhook signatures
 */
export function slackAdapter(): PlatformAdapter {
  return {
    platform: "slack",
    label: "Slack",

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "SLACK_BOT_TOKEN",
          label: "Slack Bot Token",
          required: true,
          helpText:
            "In your Slack app's left nav: OAuth & Permissions → Bot User OAuth Token (starts with `xoxb-`).",
        },
        {
          key: "SLACK_SIGNING_SECRET",
          label: "Slack Signing Secret",
          required: true,
          helpText:
            "In your Slack app's left nav: Basic Information → App Credentials → Signing Secret.",
        },
      ];
    },

    async handleVerification(
      event: H3Event,
    ): Promise<{ handled: boolean; response?: unknown }> {
      // Slack sends url_verification when first setting up the webhook
      const body = await readRawBody(event);
      try {
        const parsed = JSON.parse(body);
        if (parsed.type === "url_verification") {
          return { handled: true, response: { challenge: parsed.challenge } };
        }
      } catch {}
      // Store raw body for later use
      event.context.__rawBody = body;
      return { handled: false };
    },

    async verifyWebhook(event: H3Event): Promise<boolean> {
      const signingSecret = process.env.SLACK_SIGNING_SECRET;
      if (!signingSecret) return false;

      const signature = getHeader(event, "x-slack-signature");
      const timestamp = getHeader(event, "x-slack-request-timestamp");
      if (!signature || !timestamp) return false;

      // Reject requests older than 5 minutes (replay protection)
      const ts = parseInt(timestamp, 10);
      if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

      const body =
        (event.context.__rawBody as string | undefined) ??
        (await readRawBody(event));
      const crypto = await import("node:crypto");
      const basestring = `v0:${timestamp}:${body}`;
      const expectedSignature =
        "v0=" +
        crypto
          .createHmac("sha256", signingSecret)
          .update(basestring)
          .digest("hex");

      // Timing-safe comparison
      try {
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature),
        );
      } catch {
        return false;
      }
    },

    async parseIncomingMessage(
      event: H3Event,
    ): Promise<IncomingMessage | null> {
      const raw =
        (event.context.__rawBody as string | undefined) ??
        (await readRawBody(event));
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        return null;
      }

      // Handle Events API wrapper
      if (payload.type === "event_callback") {
        const e = payload.event;
        if (!e) return null;

        // Ignore bot messages
        if (e.bot_id || e.subtype === "bot_message") return null;
        // Ignore message edits and deletes
        if (e.subtype === "message_changed" || e.subtype === "message_deleted")
          return null;

        // Handle both direct messages and app_mentions
        const text = e.text?.trim();
        if (!text) return null;

        // Remove bot mention from text (e.g., "<@U123> do something" → "do something")
        const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
        if (!cleanText) return null;

        // Thread ID: use thread_ts if in a thread, otherwise message ts
        const threadTs = e.thread_ts || e.ts;
        const externalThreadId = `${e.channel}:${threadTs}`;

        return {
          platform: "slack",
          externalThreadId,
          text: cleanText,
          senderName: e.user,
          senderId: e.user,
          platformContext: {
            channelId: e.channel,
            threadTs: threadTs,
            messageTs: e.ts,
            teamId: payload.team_id,
            eventId: payload.event_id,
          },
          timestamp: Math.floor(parseFloat(e.ts) * 1000),
        };
      }

      return null;
    },

    async postProcessingPlaceholder(
      incoming: IncomingMessage,
    ): Promise<{ placeholderRef: string } | null> {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) return null;

      const channelId = incoming.platformContext.channelId as string;
      const threadTs = incoming.platformContext.threadTs as string;
      if (!channelId || !threadTs) return null;

      const blocks = buildThinkingBlocks();
      try {
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            thread_ts: threadTs,
            text: "Working on it…",
            blocks,
            // Suppress URL unfurl previews — the agent's reply often includes
            // a deep-link to the dispatch UI and we want a clean section
            // block, not Slack's auto-generated card.
            unfurl_links: false,
            unfurl_media: false,
            mrkdwn: true,
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          ts?: string;
          error?: string;
        };
        if (!data.ok || !data.ts) {
          console.error("[slack] postProcessingPlaceholder error:", data.error);
          return null;
        }

        // Best-effort: also flip the native AI-assistant "is thinking…"
        // status bar in the channel input area. Only works for apps
        // configured with `assistant:write`, otherwise silently no-ops.
        // Mirrors the Builder.io ai-services slackbot pattern.
        setSlackAssistantStatus(token, channelId, threadTs, "is thinking…");

        return { placeholderRef: data.ts };
      } catch (err) {
        console.error("[slack] postProcessingPlaceholder failed:", err);
        return null;
      }
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
      opts?: { placeholderRef?: string },
    ): Promise<void> {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) {
        console.error("[slack] SLACK_BOT_TOKEN not configured");
        return;
      }

      const channelId = context.platformContext.channelId as string;
      const threadTs = context.platformContext.threadTs as string;
      const blocks = (message.platformContext as any)?.blocks as
        | unknown[]
        | undefined;
      const placeholderRef = opts?.placeholderRef;

      // Block-rich path: split text into chunks but render the FIRST chunk as
      // blocks (so we keep the in-place edit + button) and any overflow as
      // plain follow-up posts. The vast majority of replies fit in one block.
      const chunks = splitMessage(message.text, SLACK_MAX_LENGTH);
      const firstChunk = chunks[0] ?? "";
      const restChunks = chunks.slice(1);

      const finalBlocks =
        blocks ??
        buildResponseBlocks(firstChunk, {
          threadDeepLinkUrl: (message.platformContext as any)
            ?.threadDeepLinkUrl,
        });

      const baseBody: Record<string, unknown> = {
        channel: channelId,
        text: firstChunk,
        blocks: finalBlocks,
        unfurl_links: false,
        unfurl_media: false,
        mrkdwn: true,
      };

      try {
        if (placeholderRef) {
          // Replace the "thinking…" placeholder in place.
          const res = await fetch("https://slack.com/api/chat.update", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...baseBody, ts: placeholderRef }),
          });
          const data = (await res.json()) as {
            ok: boolean;
            error?: string;
          };
          if (!data.ok) {
            console.error("[slack] chat.update error:", data.error);
            // Fall back to a fresh post so the user still sees a reply
            await postFresh(token, channelId, threadTs, baseBody);
          }
        } else {
          await postFresh(token, channelId, threadTs, baseBody);
        }

        // Clear the AI-assistant "is thinking…" status now that we've
        // delivered the final answer. Empty status clears it.
        if (threadTs) {
          setSlackAssistantStatus(token, channelId, threadTs, "");
        }

        // Overflow chunks (rare) — post as plain follow-ups in the same thread
        for (const chunk of restChunks) {
          await postFresh(token, channelId, threadTs, {
            channel: channelId,
            text: chunk,
            unfurl_links: false,
            unfurl_media: false,
            mrkdwn: true,
          });
        }
      } catch (err) {
        console.error("[slack] Failed to send message:", err);
      }
    },

    async sendMessageToTarget(
      message: OutgoingMessage,
      target: OutboundTarget,
    ): Promise<void> {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) {
        console.error("[slack] SLACK_BOT_TOKEN not configured");
        return;
      }

      const chunks = splitMessage(message.text, SLACK_MAX_LENGTH);
      for (const chunk of chunks) {
        const body: Record<string, unknown> = {
          channel: target.destination,
          text: chunk,
        };
        if (target.threadRef) body.thread_ts = target.threadRef;

        try {
          const res = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          const data = (await res.json()) as { ok: boolean; error?: string };
          if (!data.ok) {
            throw new Error(data.error || "chat.postMessage failed");
          }
        } catch (err) {
          console.error("[slack] Failed to send proactive message:", err);
          throw err;
        }
      }
    },

    formatAgentResponse(
      text: string,
      opts?: { threadDeepLinkUrl?: string },
    ): OutgoingMessage {
      return {
        text: markdownToSlackMrkdwn(text),
        platformContext: opts?.threadDeepLinkUrl
          ? { threadDeepLinkUrl: opts.threadDeepLinkUrl }
          : {},
      };
    },

    async getStatus(baseUrl?: string): Promise<IntegrationStatus> {
      const hasToken = !!process.env.SLACK_BOT_TOKEN;
      const hasSecret = !!process.env.SLACK_SIGNING_SECRET;
      const configured = hasToken && hasSecret;

      return {
        platform: "slack",
        label: "Slack",
        enabled: false, // overridden by plugin
        configured,
        details: {
          hasToken,
          hasSecret,
        },
        error: !configured
          ? "Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET in your environment"
          : undefined,
      };
    },
  };
}

/** Read the raw body as a string (H3 may have already parsed it) */
async function readRawBody(event: H3Event): Promise<string> {
  if (event.context.__rawBody) return event.context.__rawBody as string;
  const body = await readBody(event);
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  event.context.__rawBody = raw;
  return raw;
}

/** Split a message into chunks that fit within the platform's limit */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) {
      // Try to split at a space
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx <= 0) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

/**
 * Convert standard markdown to Slack's mrkdwn dialect.
 * - `[text](url)` → `<url|text>`
 * - `**bold**` → `*bold*` (Slack uses single asterisks for bold)
 */
function markdownToSlackMrkdwn(text: string): string {
  return (
    text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
      // 's' flag (dotAll) so `.` matches newlines — bold text can span lines.
      .replace(/\*\*(.+?)\*\*/gs, "*$1*")
  );
}

/**
 * Block Kit payload for the "Working on it…" placeholder posted as soon as
 * the webhook arrives. Slack will swap this for the final answer via
 * `chat.update` once the agent loop completes — same message ts, no extra
 * post in the thread. The mrkdwn-only context block keeps it visually
 * lightweight (no heading, no border) so the eventual final reply can swap
 * in cleanly without the eye flicker of a layout shift.
 */
function buildThinkingBlocks(): unknown[] {
  // Pick a witty rotating message so two back-to-back mentions don't both
  // say the exact same thing. Same vibe as Builder.io's ai-services slackbot.
  const messages = [
    "Working on it…",
    "On it — give me a sec…",
    "Pulling that up now…",
    "Routing your request…",
    "Checking with the right agent…",
    "Almost there…",
  ];
  const text = messages[Math.floor(Math.random() * messages.length)];
  return [
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `:hourglass_flowing_sand: _${text}_` }],
    },
  ];
}

/**
 * Optionally set Slack's native AI-assistant status indicator (the small
 * "is thinking…" line under the message composer) for an app configured
 * with the `assistant:write` scope. Pure best-effort — fails silently for
 * apps that aren't set up as AI assistants.
 */
function setSlackAssistantStatus(
  token: string,
  channelId: string,
  threadTs: string,
  status: string,
): void {
  fetch("https://slack.com/api/assistant.threads.setStatus", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel_id: channelId,
      thread_ts: threadTs,
      status,
    }),
  }).catch(() => {});
}

/**
 * Block Kit payload for the final answer. We avoid auto-unfurl previews by
 * separating the deep-link out into a button instead of inlining it as a
 * `<url|text>` markdown link in the section body — that's what was producing
 * the giant "Agent-Native Dispatch" card in every thread reply.
 */
function buildResponseBlocks(
  text: string,
  opts: { threadDeepLinkUrl?: string },
): unknown[] {
  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: text || "_(no response)_" },
    },
  ];
  if (opts.threadDeepLinkUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open thread", emoji: true },
          url: opts.threadDeepLinkUrl,
          action_id: "open_dispatch_thread",
        },
      ],
    });
  }
  return blocks;
}

/**
 * Post a fresh message to a thread. Used as the placeholder-fallback path
 * (e.g. when chat.update fails) and for follow-up overflow chunks.
 */
async function postFresh(
  token: string,
  channelId: string,
  threadTs: string | undefined,
  body: Record<string, unknown>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...body,
    channel: channelId,
  };
  if (threadTs && !payload.thread_ts) payload.thread_ts = threadTs;
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    console.error("[slack] chat.postMessage error:", data.error);
  }
}
