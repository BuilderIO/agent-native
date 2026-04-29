import type { H3Event } from "h3";
import { getQuery, getHeader } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
} from "../types.js";
import type { EnvKeyConfig } from "../../server/create-server.js";
import { readBody } from "../../server/h3-helpers.js";

/** WhatsApp's max message length */
const WHATSAPP_MAX_LENGTH = 4096;

/**
 * Create a WhatsApp Cloud API platform adapter.
 *
 * Required env vars:
 * - WHATSAPP_ACCESS_TOKEN — Permanent access token from Meta
 * - WHATSAPP_VERIFY_TOKEN — Custom token for webhook verification
 * - WHATSAPP_PHONE_NUMBER_ID — Phone number ID from Meta dashboard
 *
 * Optional env vars:
 * - WHATSAPP_APP_SECRET — App secret for signature verification
 */
export function whatsappAdapter(): PlatformAdapter {
  return {
    platform: "whatsapp",
    label: "WhatsApp",

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "WHATSAPP_ACCESS_TOKEN",
          label: "WhatsApp Access Token",
          required: true,
          helpText:
            "From your Meta app → WhatsApp → API Setup → Permanent access token. Generate one under System Users for production use.",
        },
        {
          key: "WHATSAPP_VERIFY_TOKEN",
          label: "WhatsApp Verify Token",
          required: true,
          helpText:
            "Any random string you choose. You'll paste the same value into Meta's webhook configuration so Meta can confirm dispatch owns the URL.",
        },
        {
          key: "WHATSAPP_PHONE_NUMBER_ID",
          label: "WhatsApp Phone Number ID",
          required: true,
          helpText:
            "From your Meta app → WhatsApp → API Setup. The numeric Phone number ID (not the actual phone number).",
        },
        {
          key: "WHATSAPP_APP_SECRET",
          label: "WhatsApp App Secret",
          required: false,
          helpText:
            "Optional. From Meta App Dashboard → Basic Settings → App Secret. Enables HMAC signature verification on inbound webhooks.",
        },
      ];
    },

    async handleVerification(
      event: H3Event,
    ): Promise<{ handled: boolean; response?: unknown }> {
      // WhatsApp uses GET request for webhook verification
      const method = event.node?.req?.method || "POST";
      if (method !== "GET") return { handled: false };

      const query = getQuery(event);
      const mode = query["hub.mode"];
      const token = query["hub.verify_token"];
      const challenge = query["hub.challenge"];

      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        return { handled: true, response: challenge };
      }

      return { handled: false };
    },

    async verifyWebhook(event: H3Event): Promise<boolean> {
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      if (!appSecret) {
        // No app secret — accept if access token is configured
        return !!process.env.WHATSAPP_ACCESS_TOKEN;
      }

      const signature = getHeader(event, "x-hub-signature-256");
      if (!signature) return false;

      const body = await readRawBody(event);
      const crypto = await import("node:crypto");
      const expectedSignature =
        "sha256=" +
        crypto.createHmac("sha256", appSecret).update(body).digest("hex");

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
      const body = await readBody(event);
      if (!body) return null;

      // WhatsApp Cloud API webhook payload structure
      const entry = body.entry?.[0];
      if (!entry) return null;

      const changes = entry.changes?.[0];
      if (!changes || changes.field !== "messages") return null;

      const value = changes.value;
      const message = value?.messages?.[0];
      if (!message) return null;

      // Only handle text messages
      if (message.type !== "text") return null;
      const text = message.text?.body?.trim();
      if (!text) return null;

      const contact = value.contacts?.[0];
      const from = message.from; // Phone number

      return {
        platform: "whatsapp",
        externalThreadId: from,
        text,
        senderName: contact?.profile?.name,
        senderId: from,
        platformContext: {
          phoneNumberId: value.metadata?.phone_number_id,
          displayPhoneNumber: value.metadata?.display_phone_number,
          messageId: message.id,
          from,
          timestamp: message.timestamp,
        },
        timestamp: parseInt(message.timestamp, 10) * 1000,
      };
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
    ): Promise<void> {
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!accessToken || !phoneNumberId) {
        console.error(
          "[whatsapp] WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured",
        );
        return;
      }

      const to = context.senderId;
      const chunks = splitMessage(message.text, WHATSAPP_MAX_LENGTH);

      for (const chunk of chunks) {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to,
                type: "text",
                text: { body: chunk },
              }),
            },
          );
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            console.error("[whatsapp] sendMessage error:", data);
          }
        } catch (err) {
          console.error("[whatsapp] Failed to send message:", err);
        }
      }
    },

    formatAgentResponse(text: string): OutgoingMessage {
      return { text, platformContext: {} };
    },

    async getStatus(_baseUrl?: string): Promise<IntegrationStatus> {
      const hasAccessToken = !!process.env.WHATSAPP_ACCESS_TOKEN;
      const hasVerifyToken = !!process.env.WHATSAPP_VERIFY_TOKEN;
      const hasPhoneNumberId = !!process.env.WHATSAPP_PHONE_NUMBER_ID;
      const configured = hasAccessToken && hasVerifyToken && hasPhoneNumberId;

      return {
        platform: "whatsapp",
        label: "WhatsApp",
        enabled: false, // overridden by plugin
        configured,
        details: {
          hasAccessToken,
          hasVerifyToken,
          hasPhoneNumberId,
        },
        error: !configured
          ? "Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_VERIFY_TOKEN, and WHATSAPP_PHONE_NUMBER_ID"
          : undefined,
      };
    },
  };
}

async function readRawBody(event: H3Event): Promise<string> {
  if (event.context.__rawBody) return event.context.__rawBody as string;
  const body = await readBody(event);
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  event.context.__rawBody = raw;
  return raw;
}

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
