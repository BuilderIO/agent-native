import type { H3Event } from "h3";
import { readBody, getHeader } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
} from "../types.js";
import type { EnvKeyConfig } from "../../server/create-server.js";
import { getIntegrationConfig } from "../config-store.js";

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
        },
        {
          key: "SLACK_SIGNING_SECRET",
          label: "Slack Signing Secret",
          required: true,
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
      (event as any).__rawBody = body;
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

      const body = (event as any).__rawBody ?? (await readRawBody(event));
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
      const raw = (event as any).__rawBody ?? (await readRawBody(event));
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

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
    ): Promise<void> {
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) {
        console.error("[slack] SLACK_BOT_TOKEN not configured");
        return;
      }

      const channelId = context.platformContext.channelId as string;
      const threadTs = context.platformContext.threadTs as string;

      // Split long messages
      const chunks = splitMessage(message.text, SLACK_MAX_LENGTH);

      for (const chunk of chunks) {
        const body: Record<string, unknown> = {
          channel: channelId,
          text: chunk,
          thread_ts: threadTs,
        };

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
            console.error("[slack] chat.postMessage error:", data.error);
          }
        } catch (err) {
          console.error("[slack] Failed to send message:", err);
        }
      }
    },

    formatAgentResponse(text: string): OutgoingMessage {
      return { text, platformContext: {} };
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
  if ((event as any).__rawBody) return (event as any).__rawBody;
  const body = await readBody(event);
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  (event as any).__rawBody = raw;
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
