import type { H3Event } from "h3";
import { getQuery, getHeader, readRawBody as h3ReadRawBody } from "h3";
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
 * One-shot warning flag — log once per process when accepting unverified
 * webhooks (M6 in the webhook security audit).
 */
let _whatsappUnverifiedWarned = false;

/**
 * Returns true when the deployment is running in production mode and the
 * operator has NOT explicitly opted into accepting unverified webhooks for
 * local testing. In production we MUST refuse webhooks whose signature can't
 * be verified (C2 in the webhook security audit).
 */
function shouldRefuseWhenSecretMissing(): boolean {
  if (process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS === "1") return false;
  return process.env.NODE_ENV === "production";
}

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
      const method = event.node?.req?.method || "POST";

      // For POST flows, pre-cache the raw body so verifyWebhook (HMAC) and
      // parseIncomingMessage don't both try to consume the request body
      // stream — h3 v2's body stream is consume-once, so a second read
      // hangs (M3 in the webhook security audit). Reads raw bytes; never
      // re-stringifies a parsed body, since Meta computes HMAC over the
      // exact bytes it sent (M2 in the audit).
      if (method === "POST") {
        try {
          await readRawBody(event);
        } catch {
          // Surfaces in verifyWebhook / parseIncomingMessage if it actually matters.
        }
        return { handled: false };
      }

      // GET: WhatsApp's challenge handshake.
      const query = getQuery(event);
      const mode = query["hub.mode"];
      const token = query["hub.verify_token"];
      const challenge = query["hub.challenge"];
      const expected = process.env.WHATSAPP_VERIFY_TOKEN;

      if (mode === "subscribe" && expected && typeof token === "string") {
        // Timing-safe compare so an attacker can't measure character-wise
        // mismatch latency (H6 in the webhook security audit).
        const a = Buffer.from(String(token));
        const b = Buffer.from(String(expected));
        if (a.length === b.length) {
          try {
            const crypto = await import("node:crypto");
            if (crypto.timingSafeEqual(a, b)) {
              return { handled: true, response: challenge };
            }
          } catch {
            // fall through
          }
        }
      }

      return { handled: false };
    },

    async verifyWebhook(event: H3Event): Promise<boolean> {
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      if (!appSecret) {
        if (shouldRefuseWhenSecretMissing()) {
          if (!_whatsappUnverifiedWarned) {
            _whatsappUnverifiedWarned = true;
            console.error(
              "[whatsapp] WHATSAPP_APP_SECRET not set — refusing webhook in production. " +
                "Set WHATSAPP_APP_SECRET, or set AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1 for local testing only.",
            );
          }
          return false;
        }
        if (!_whatsappUnverifiedWarned) {
          _whatsappUnverifiedWarned = true;
          console.warn(
            "[whatsapp] WHATSAPP_APP_SECRET not set — accepting webhook without verification (dev mode)",
          );
        }
        // Dev mode: still require the access token to be configured at all.
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
      // Always read via the cached raw body so HMAC and parse see identical
      // bytes — h3 v2's body stream is consume-once, and re-stringifying a
      // parsed body breaks Meta's signature check (M2/M3 in the audit).
      const raw = await readRawBody(event);
      if (!raw) return null;
      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        return null;
      }
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

/**
 * Read the raw request body as a string and cache it on the event context.
 *
 * Reads raw bytes from the request stream, NEVER `JSON.stringify`s a parsed
 * body — Meta's signature is computed over the exact bytes Meta sent
 * (M2/M3 in the webhook security audit). h3 v2's body stream is consume-once
 * so we cache the raw string after the first read.
 */
async function readRawBody(event: H3Event): Promise<string> {
  const cached = event.context.__rawBody;
  if (typeof cached === "string") return cached;
  const raw = (await h3ReadRawBody(event)) ?? "";
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
