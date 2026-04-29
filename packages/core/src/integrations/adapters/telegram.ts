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
import { readBody } from "../../server/h3-helpers.js";

/** Telegram's max message length */
const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Create a Telegram platform adapter.
 *
 * Required env vars:
 * - TELEGRAM_BOT_TOKEN — Bot token from @BotFather
 *
 * Optional env vars:
 * - TELEGRAM_WEBHOOK_SECRET — Secret token for webhook verification
 */
export function telegramAdapter(): PlatformAdapter {
  return {
    platform: "telegram",
    label: "Telegram",

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
          required: false,
          helpText:
            "Optional. Any random string — Telegram will echo it on every webhook so dispatch can verify the request came from Telegram.",
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
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (!secret) {
        // No secret configured — accept all (Telegram recommends using a secret but doesn't require it)
        return !!process.env.TELEGRAM_BOT_TOKEN;
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

      return {
        platform: "telegram",
        externalThreadId: String(chat.id),
        text: cleanText,
        senderName:
          from?.first_name + (from?.last_name ? ` ${from.last_name}` : ""),
        senderId: String(from?.id),
        platformContext: {
          chatId: chat.id,
          chatType: chat.type,
          messageId: message.message_id,
          fromId: from?.id,
          fromUsername: from?.username,
        },
        timestamp: message.date * 1000,
      };
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
    ): Promise<void> {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) {
        console.error("[telegram] TELEGRAM_BOT_TOKEN not configured");
        return;
      }

      const chatId = context.platformContext.chatId;
      const chunks = splitMessage(message.text, TELEGRAM_MAX_LENGTH);

      for (const chunk of chunks) {
        try {
          const res = await fetch(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: chunk,
                parse_mode: "Markdown",
              }),
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
                  chat_id: chatId,
                  text: chunk,
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
      const token = process.env.TELEGRAM_BOT_TOKEN;
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
      const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;

      let botName: string | undefined;
      if (hasToken) {
        try {
          const res = await fetch(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
          );
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
        configured: hasToken,
        details: {
          hasToken,
          botUsername: botName,
        },
        error: !hasToken
          ? "Set TELEGRAM_BOT_TOKEN in your environment"
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
