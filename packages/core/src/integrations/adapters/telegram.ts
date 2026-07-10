import type { H3Event } from "h3";
import { getHeader } from "h3";

import type { EnvKeyConfig } from "../../server/create-server.js";
import { resolveSecret } from "../../server/credential-provider.js";
import { readBody } from "../../server/h3-helpers.js";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
  OutboundTarget,
} from "../types.js";

/** Telegram's max message length */
const TELEGRAM_MAX_LENGTH = 4096;

/**
 * One-shot warning flag — log once per process when accepting unverified
 * webhooks (M6 in the webhook security audit).
 */
let _telegramUnverifiedWarned = false;

/**
 * Returns true when the deployment is running in production mode and the
 * operator has NOT explicitly opted into accepting unverified webhooks for
 * local testing. In production we MUST refuse webhooks whose secret is
 * unset — otherwise an attacker can drive the agent loop with arbitrary
 * messages (C2 in the webhook security audit).
 */
function shouldRefuseWhenSecretMissing(): boolean {
  if (process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS === "1") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * Create a Telegram platform adapter.
 *
 * Required env vars:
 * - TELEGRAM_BOT_TOKEN — Bot token from @BotFather
 * - TELEGRAM_WEBHOOK_SECRET — Secret token for webhook verification
 */
export function telegramAdapter(): PlatformAdapter {
  return {
    platform: "telegram",
    label: "Telegram",
    capabilities: {
      replyText: true,
      proactiveMessages: true,
      nativeThreads: true,
      contextualReplies: true,
      deferredWebhookResponse: false,
      interactionOnly: false,
    },

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "TELEGRAM_BOT_TOKEN",
          label: "Telegram Bot Token",
          required: true,
          helpText:
            "From @BotFather after `/newbot` — the long token Telegram gives you (looks like `123456:ABC-DEF...`).",
        },
        {
          key: "TELEGRAM_WEBHOOK_SECRET",
          label: "Telegram Webhook Secret",
          required: true,
          helpText:
            "A random secret token. Telegram echoes it on every webhook so the adapter can verify the request came from Telegram.",
        },
      ];
    },

    async handleVerification(
      event: H3Event,
    ): Promise<{ handled: boolean; response?: unknown }> {
      // Pre-read the raw body once and cache on the event context. h3 v2's
      // request body stream can only be consumed once; without this, the
      // later `parseIncomingMessage` call throws "Body has already been read"
      // because something upstream (signature check, dedupe, etc.) drains it.
      // Mirrors the Slack adapter's pattern.
      try {
        if (!event.context.__rawBody) {
          const body = await readBody(event);
          event.context.__rawBody = body;
        }
      } catch {
        // If we can't pre-read, parseIncomingMessage will surface the error
      }
      // Telegram has no challenge; we never short-circuit.
      return { handled: false };
    },

    async verifyWebhook(event: H3Event): Promise<boolean> {
      const secret = await resolveSecret("TELEGRAM_WEBHOOK_SECRET");
      if (!secret) {
        if (shouldRefuseWhenSecretMissing()) {
          if (!_telegramUnverifiedWarned) {
            _telegramUnverifiedWarned = true;
            console.error(
              "[telegram] TELEGRAM_WEBHOOK_SECRET not set — refusing webhook in production. " +
                "Set TELEGRAM_WEBHOOK_SECRET, or set AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1 for local testing only.",
            );
          }
          return false;
        }
        if (!_telegramUnverifiedWarned) {
          _telegramUnverifiedWarned = true;
          console.warn(
            "[telegram] TELEGRAM_WEBHOOK_SECRET not set — accepting webhook without verification (dev mode)",
          );
        }
        // Dev mode: still require the bot token to be configured at all.
        return !!(await resolveSecret("TELEGRAM_BOT_TOKEN"));
      }

      const headerSecret = getHeader(event, "x-telegram-bot-api-secret-token");
      if (!headerSecret) return false;

      // Timing-safe comparison
      try {
        const crypto = await import("node:crypto");
        return crypto.timingSafeEqual(
          Buffer.from(secret),
          Buffer.from(headerSecret),
        );
      } catch {
        return false;
      }
    },

    async parseIncomingMessage(
      event: H3Event,
    ): Promise<IncomingMessage | null> {
      // Use the pre-cached raw body if available (set by handleVerification).
      // Falls back to readBody for paths that bypass handleVerification.
      const body = (event.context.__rawBody as any) ?? (await readBody(event));
      if (!body) return null;

      // Handle regular messages
      const message = body.message || body.edited_message;
      if (!message) return null;

      // Only process text messages
      const text = message.text?.trim();
      if (!text) return null;

      // Ignore bot commands that we don't handle (e.g., /start is fine)
      // Remove /start command prefix if present
      const cleanText =
        text === "/start"
          ? "Hello! I'm ready to chat."
          : text.replace(/^\/\w+\s*/, "").trim() || text;

      const chat = message.chat;
      const from = message.from;
      const messageThreadId = message.message_thread_id;
      const externalThreadId =
        messageThreadId === undefined
          ? `chat:${String(chat.id)}`
          : `chat:${String(chat.id)}:thread:${String(messageThreadId)}`;

      return {
        platform: "telegram",
        externalThreadId,
        text: cleanText,
        senderName:
          from?.first_name + (from?.last_name ? ` ${from.last_name}` : ""),
        senderId: String(from?.id),
        threadRef:
          messageThreadId === undefined ? undefined : String(messageThreadId),
        replyRef: String(message.message_id),
        platformContext: {
          chatId: chat.id,
          chatType: chat.type,
          messageId: message.message_id,
          messageThreadId,
          rawText: text,
          fromId: from?.id,
          fromUsername: from?.username,
        },
        timestamp: message.date * 1000,
      };
    },

    getLegacyExternalThreadIds(incoming: IncomingMessage): string[] {
      const chatId = incoming.platformContext.chatId;
      return typeof chatId === "string" || typeof chatId === "number"
        ? [String(chatId)]
        : [];
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
    ): Promise<void> {
      const token = await resolveSecret("TELEGRAM_BOT_TOKEN");
      if (!token) {
        console.error("[telegram] TELEGRAM_BOT_TOKEN not configured");
        return;
      }

      const chatId = context.platformContext.chatId;
      const chunks = splitMessage(message.text, TELEGRAM_MAX_LENGTH);

      for (const [index, chunk] of chunks.entries()) {
        try {
          const body: Record<string, unknown> = {
            chat_id: chatId,
            text: chunk,
            parse_mode: "Markdown",
          };
          if (context.threadRef) {
            body.message_thread_id = Number(context.threadRef);
          }
          if (index === 0 && context.replyRef) {
            body.reply_parameters = {
              message_id: Number(context.replyRef),
              allow_sending_without_reply: true,
            };
          }
          const res = await fetch(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          );
          const data = (await res.json()) as {
            ok: boolean;
            description?: string;
          };
          if (!data.ok) {
            // Retry without Markdown if parsing fails
            if (data.description?.includes("parse")) {
              await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...body,
                  parse_mode: undefined,
                }),
              });
            } else {
              console.error("[telegram] sendMessage error:", data.description);
            }
          }
        } catch (err) {
          console.error("[telegram] Failed to send message:", err);
        }
      }
    },

    async sendMessageToTarget(
      message: OutgoingMessage,
      target: OutboundTarget,
    ): Promise<void> {
      const token = await resolveSecret("TELEGRAM_BOT_TOKEN");
      if (!token) {
        console.error("[telegram] TELEGRAM_BOT_TOKEN not configured");
        return;
      }

      const chunks = splitMessage(message.text, TELEGRAM_MAX_LENGTH);
      for (const chunk of chunks) {
        const body: Record<string, unknown> = {
          chat_id: target.destination,
          text: chunk,
        };
        if (target.threadRef) {
          body.message_thread_id = target.threadRef;
        }

        try {
          const res = await fetch(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          );
          const data = (await res.json()) as {
            ok: boolean;
            description?: string;
          };
          if (!data.ok) {
            throw new Error(data.description || "sendMessage failed");
          }
        } catch (err) {
          console.error("[telegram] Failed to send proactive message:", err);
          throw err;
        }
      }
    },

    formatAgentResponse(text: string): OutgoingMessage {
      // Telegram's legacy Markdown uses single asterisks for bold, not double.
      // `[text](url)` is already supported natively.
      // 's' flag (dotAll) so `.` matches newlines — bold text can span lines.
      const normalized = text.replace(/\*\*(.+?)\*\*/gs, "*$1*");
      return { text: normalized, platformContext: { parse_mode: "Markdown" } };
    },

    async getStatus(_baseUrl?: string): Promise<IntegrationStatus> {
      const token = await resolveSecret("TELEGRAM_BOT_TOKEN");
      const hasToken = !!token;
      const hasWebhookSecret = !!(await resolveSecret(
        "TELEGRAM_WEBHOOK_SECRET",
      ));
      const configured = hasToken && hasWebhookSecret;

      let botName: string | undefined;
      if (hasToken) {
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
          const data = (await res.json()) as {
            ok: boolean;
            result?: { username?: string };
          };
          if (data.ok) {
            botName = data.result?.username;
          }
        } catch {}
      }

      return {
        platform: "telegram",
        label: "Telegram",
        enabled: false, // overridden by plugin
        configured,
        details: {
          hasToken,
          hasWebhookSecret,
          botUsername: botName,
        },
        error: !configured
          ? "Save TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in settings"
          : undefined,
      };
    },
  };
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
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(" ", maxLength);
    if (splitIdx <= 0) splitIdx = maxLength;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}
