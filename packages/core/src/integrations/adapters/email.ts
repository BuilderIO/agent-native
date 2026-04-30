import type { H3Event } from "h3";
import { getHeader } from "h3";
import { timingSafeEqual } from "node:crypto";
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
import { getDbExec } from "../../db/client.js";
import {
  sendEmail,
  isEmailConfigured,
  getEmailProvider,
} from "../../server/email.js";

/** Max body length before truncation */
const EMAIL_MAX_BODY_LENGTH = 15000;

/** Rate limit: max emails per sender within the window */
const RATE_LIMIT_MAX = 20;
/** Rate limit window in ms (1 hour) */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * One-shot warning flags so we don't spam logs on every webhook.
 * Cleared per process — one warning per cold start is enough to surface
 * a misconfiguration without leaking config status to anyone with log access
 * (M6 in the webhook security audit).
 */
let _resendUnverifiedWarned = false;
let _sendgridUnverifiedWarned = false;

/**
 * Returns true when the deployment is running in production mode and the
 * operator has NOT explicitly opted into accepting unverified webhooks for
 * local testing. In production we MUST refuse webhooks whose signature can't
 * be verified — accepting them with attacker-controlled `from:` addresses
 * lets the dispatch owner-resolution path run as the victim (C1 in the
 * webhook security audit).
 */
function shouldRefuseWhenSecretMissing(): boolean {
  if (process.env.AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS === "1") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * Create an Email platform adapter for inbound/outbound email via
 * Resend or SendGrid webhooks.
 *
 * Required env vars:
 * - EMAIL_AGENT_ADDRESS — The email address the agent receives mail at
 *
 * One of these must also be set (checked via isEmailConfigured()):
 * - RESEND_API_KEY — For sending/receiving via Resend
 * - SENDGRID_API_KEY — For sending/receiving via SendGrid
 *
 * Optional:
 * - EMAIL_INBOUND_WEBHOOK_SECRET — Webhook signature verification secret
 */
export function emailAdapter(): PlatformAdapter {
  return {
    platform: "email",
    label: "Email",

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "EMAIL_AGENT_ADDRESS",
          label: "Agent Email Address",
          required: true,
          helpText:
            "The email address people will use to message your agent (e.g. `agent@yourcompany.com`, or pick from your `<slug>.resend.app` sandbox).",
        },
        {
          key: "RESEND_API_KEY",
          label: "Resend API Key",
          required: false,
          helpText:
            "From resend.com → API keys (starts with `re_`). Either Resend or SendGrid is required for sending and receiving mail.",
        },
        {
          key: "SENDGRID_API_KEY",
          label: "SendGrid API Key",
          required: false,
          helpText:
            "From sendgrid.com → Settings → API Keys (starts with `SG.`). Either Resend or SendGrid is required.",
        },
        {
          key: "EMAIL_INBOUND_WEBHOOK_SECRET",
          label: "Inbound Webhook Secret",
          required: false,
          helpText:
            "Optional. From Resend (Webhooks → Signing Secret, starts with `whsec_`) or your SendGrid Inbound Parse basic-auth password. Used to verify inbound webhooks are real.",
        },
      ];
    },

    async handleVerification(
      _event: H3Event,
    ): Promise<{ handled: boolean; response?: unknown }> {
      // Email webhooks don't need challenge handshakes
      return { handled: false };
    },

    async verifyWebhook(event: H3Event): Promise<boolean> {
      const secret = process.env.EMAIL_INBOUND_WEBHOOK_SECRET;
      const provider = getEmailProvider();

      if (provider === "resend") {
        return verifyResendWebhook(event, secret);
      }

      if (provider === "sendgrid") {
        return verifySendGridWebhook(event, secret);
      }

      // No provider configured — reject
      console.warn("[email] No email provider configured, rejecting webhook");
      return false;
    },

    async parseIncomingMessage(
      event: H3Event,
    ): Promise<IncomingMessage | null> {
      const provider = getEmailProvider();
      const agentAddress = process.env.EMAIL_AGENT_ADDRESS?.toLowerCase();
      if (!agentAddress) {
        console.warn("[email] EMAIL_AGENT_ADDRESS not configured");
        return null;
      }

      let parsed: ParsedEmail | null = null;

      if (provider === "resend") {
        parsed = await parseResendWebhook(event);
      } else if (provider === "sendgrid") {
        parsed = await parseSendGridWebhook(event);
      }

      if (!parsed) return null;

      // Rate limiting (SQL-backed heuristic — counts the sender's already-queued
      // tasks within the last hour). The previous in-memory map reset on every
      // serverless cold start, so the actual ceiling per attacker was
      // RATE_LIMIT_MAX × number_of_active_instances. SQL-backed counting holds
      // across instances. See H4 in the webhook security audit.
      const senderEmail = parsed.from.email.toLowerCase();
      if (await isRateLimited(senderEmail)) {
        console.warn(
          `[email] Rate limited sender: ${senderEmail} (>${RATE_LIMIT_MAX}/hr)`,
        );
        return null;
      }

      // Check allowed domains
      const config = await getIntegrationConfig("email");
      if (config?.configData?.allowedDomains) {
        const allowed = config.configData.allowedDomains as string[];
        if (allowed.length > 0) {
          const senderDomain = senderEmail.split("@")[1];
          if (!senderDomain || !allowed.includes(senderDomain)) {
            console.warn(
              `[email] Rejected email from ${senderEmail}: domain not in allowedDomains`,
            );
            return null;
          }
        }
      }

      // Determine if agent was CC'd (not in To, but in CC)
      const toAddresses = parsed.to.map((a) => a.toLowerCase());
      const ccAddresses = (parsed.cc ?? []).map((a) => a.toLowerCase());
      const isCC =
        !toAddresses.includes(agentAddress) &&
        ccAddresses.includes(agentAddress);

      // Build thread ID from References chain (Gmail-style: oldest Message-ID is thread root).
      // Scope the thread root by sender so an attacker who can forge a `References:`
      // header pointing at someone else's thread root can't graft into that thread.
      // Without this scoping, a third party could craft an inbound email whose
      // References chain matches a known victim's Message-ID and inject messages into
      // the victim's existing conversation — leaking prior content via the agent's
      // reply (M1 in the webhooks security audit).
      const threadRootId = scopeThreadIdToSender(
        getThreadRootId(parsed.messageId, parsed.references),
        senderEmail,
      );

      // Build body text
      let bodyText = parsed.text || stripHtmlForPlainText(parsed.html || "");

      // Truncate if needed
      if (bodyText.length > EMAIL_MAX_BODY_LENGTH) {
        bodyText =
          bodyText.slice(0, EMAIL_MAX_BODY_LENGTH) + "\n[Message truncated]";
      }

      // Prefix CC'd emails with context
      if (isCC) {
        const otherRecipients = toAddresses
          .filter((a) => a !== agentAddress)
          .join(", ");
        bodyText =
          `[CC'd on email between ${senderEmail} and ${otherRecipients || "others"}]\n` +
          `Subject: ${parsed.subject}\n\n` +
          bodyText;
      }

      return {
        platform: "email",
        externalThreadId: threadRootId,
        text: bodyText,
        senderName: parsed.from.name,
        senderId: senderEmail,
        platformContext: {
          messageId: parsed.messageId,
          subject: parsed.subject,
          from: senderEmail,
          to: parsed.to,
          cc: parsed.cc,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          isCC,
        },
        timestamp: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
      };
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
    ): Promise<void> {
      const agentAddress = process.env.EMAIL_AGENT_ADDRESS;
      if (!agentAddress) {
        console.error("[email] EMAIL_AGENT_ADDRESS not configured");
        return;
      }

      const config = await getIntegrationConfig("email");
      const displayName =
        (config?.configData?.displayName as string) || "Dispatch Agent";

      // EMAIL_FROM overrides the from-address — required when the receiving
      // address is on a sub-domain that can't be a verified sender (e.g.
      // *.resend.app). Inbound and outbound addresses can differ.
      const fromAddress = process.env.EMAIL_FROM
        ? process.env.EMAIL_FROM
        : `${displayName} <${agentAddress}>`;

      const subject = context.platformContext.subject as string;
      const reSubject = subject.startsWith("Re: ") ? subject : `Re: ${subject}`;

      try {
        await sendEmail({
          to: context.senderId!,
          from: fromAddress,
          subject: reSubject,
          html: message.text,
          text: stripHtmlForPlainText(message.text),
          inReplyTo: context.platformContext.messageId as string,
          references: buildReferencesHeader(context.platformContext),
          cc: context.platformContext.isCC
            ? buildReplyAllCc(context)
            : undefined,
        });
      } catch (err) {
        console.error("[email] Failed to send response:", err);
      }
    },

    async sendMessageToTarget(
      message: OutgoingMessage,
      target: OutboundTarget,
    ): Promise<void> {
      const agentAddress = process.env.EMAIL_AGENT_ADDRESS;
      if (!agentAddress) {
        console.error("[email] EMAIL_AGENT_ADDRESS not configured");
        return;
      }

      const config = await getIntegrationConfig("email");
      const displayName =
        (config?.configData?.displayName as string) || "Dispatch Agent";

      try {
        await sendEmail({
          to: target.destination,
          from: `${displayName} <${agentAddress}>`,
          subject: target.label || "Message from Dispatch Agent",
          html: message.text,
          text: stripHtmlForPlainText(message.text),
          ...(target.threadRef
            ? {
                inReplyTo: target.threadRef,
                references: target.threadRef,
              }
            : {}),
        });
      } catch (err) {
        console.error("[email] Failed to send proactive message:", err);
        throw err;
      }
    },

    formatAgentResponse(text: string): OutgoingMessage {
      const bodyHtml = markdownToHtml(text);
      const html = wrapInEmailTemplate(bodyHtml);
      return { text: html, platformContext: {} };
    },

    async getStatus(_baseUrl?: string): Promise<IntegrationStatus> {
      const hasAgentAddress = !!process.env.EMAIL_AGENT_ADDRESS;
      const hasEmailProvider = isEmailConfigured();
      const hasWebhookSecret = !!process.env.EMAIL_INBOUND_WEBHOOK_SECRET;
      const configured = hasAgentAddress && hasEmailProvider;

      return {
        platform: "email",
        label: "Email",
        enabled: false, // overridden by plugin
        configured,
        details: {
          hasAgentAddress,
          hasEmailProvider,
          hasWebhookSecret,
          provider: getEmailProvider(),
        },
        error: !configured
          ? "Set EMAIL_AGENT_ADDRESS and either RESEND_API_KEY or SENDGRID_API_KEY"
          : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Parsed email shape
// ---------------------------------------------------------------------------

interface ParsedEmail {
  messageId: string;
  subject: string;
  from: { name?: string; email: string };
  to: string[];
  cc?: string[];
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  date?: string;
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

async function verifyResendWebhook(
  event: H3Event,
  secret?: string,
): Promise<boolean> {
  if (!secret) {
    if (shouldRefuseWhenSecretMissing()) {
      if (!_resendUnverifiedWarned) {
        _resendUnverifiedWarned = true;
        console.error(
          "[email] EMAIL_INBOUND_WEBHOOK_SECRET not set — refusing Resend webhook in production. " +
            "Set EMAIL_INBOUND_WEBHOOK_SECRET, or set AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1 for local testing only.",
        );
      }
      return false;
    }
    if (!_resendUnverifiedWarned) {
      _resendUnverifiedWarned = true;
      console.warn(
        "[email] EMAIL_INBOUND_WEBHOOK_SECRET not set — accepting Resend webhook without verification (dev mode)",
      );
    }
    return true;
  }

  const svixId = getHeader(event, "svix-id");
  const svixTimestamp = getHeader(event, "svix-timestamp");
  const svixSignature = getHeader(event, "svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn("[email] Missing Svix signature headers");
    return false;
  }

  // Reject requests older than 5 minutes (replay protection)
  const ts = parseInt(svixTimestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) {
    console.warn("[email] Svix timestamp too old, rejecting");
    return false;
  }

  const body = await readRawBody(event);
  const crypto = await import("node:crypto");

  // Svix signing secret may be prefixed with "whsec_"
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const secretBytes = Buffer.from(rawSecret, "base64");

  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const expectedSignature = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // Svix sends multiple signatures separated by spaces, each prefixed with "v1,"
  const signatures = svixSignature.split(" ");
  for (const sig of signatures) {
    const sigValue = sig.startsWith("v1,") ? sig.slice(3) : sig;
    try {
      if (
        crypto.timingSafeEqual(
          Buffer.from(expectedSignature),
          Buffer.from(sigValue),
        )
      ) {
        return true;
      }
    } catch {
      // Length mismatch — try next signature
    }
  }

  console.warn("[email] Svix signature verification failed");
  return false;
}

function safeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

async function verifySendGridWebhook(
  event: H3Event,
  secret?: string,
): Promise<boolean> {
  if (!secret) {
    if (shouldRefuseWhenSecretMissing()) {
      if (!_sendgridUnverifiedWarned) {
        _sendgridUnverifiedWarned = true;
        console.error(
          "[email] EMAIL_INBOUND_WEBHOOK_SECRET not set — refusing SendGrid webhook in production. " +
            "Set EMAIL_INBOUND_WEBHOOK_SECRET, or set AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1 for local testing only.",
        );
      }
      return false;
    }
    if (!_sendgridUnverifiedWarned) {
      _sendgridUnverifiedWarned = true;
      console.warn(
        "[email] EMAIL_INBOUND_WEBHOOK_SECRET not set — accepting SendGrid webhook without verification (dev mode)",
      );
    }
    return true;
  }

  // Check for the secret in a custom header or basic auth
  const authHeader = getHeader(event, "authorization");
  if (authHeader) {
    // Basic auth: "Basic base64(user:pass)" — secret is the password
    if (authHeader.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
      const password = decoded.split(":")[1];
      if (password !== undefined && safeEq(password, secret)) return true;
    }
  }

  // Also check a custom header (common SendGrid Inbound Parse pattern)
  const customSecret = getHeader(event, "x-webhook-secret");
  if (customSecret !== undefined && safeEq(customSecret, secret)) return true;

  console.warn("[email] SendGrid webhook secret verification failed");
  return false;
}

// ---------------------------------------------------------------------------
// Inbound email parsing
// ---------------------------------------------------------------------------

async function parseResendWebhook(event: H3Event): Promise<ParsedEmail | null> {
  const raw = await readRawBody(event);
  const body = JSON.parse(raw);
  if (!body || body.type !== "email.received") return null;

  const data = body.data;
  if (!data) return null;

  // Resend webhook payload provides email metadata directly in data
  // Fields: from, to, cc, subject, text, html, headers, created_at
  const fromRaw = data.from as string | undefined;
  const from = fromRaw ? parseEmailAddress(fromRaw) : null;
  if (!from) return null;

  const toRaw = data.to as string | string[] | undefined;
  const to = normalizeAddressList(toRaw);
  const ccRaw = data.cc as string | string[] | undefined;
  const cc = normalizeAddressList(ccRaw);

  // Parse headers for Message-ID, In-Reply-To, References
  const headers = parseHeadersObject(data.headers);
  const messageId =
    headers["message-id"] || data.email_id || `resend-${Date.now()}`;

  return {
    messageId,
    subject: (data.subject as string) || "(no subject)",
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    text: data.text as string | undefined,
    html: data.html as string | undefined,
    inReplyTo: headers["in-reply-to"] || undefined,
    references: parseReferencesHeader(headers["references"]),
    date: (data.created_at as string) || undefined,
  };
}

async function parseSendGridWebhook(
  event: H3Event,
): Promise<ParsedEmail | null> {
  const raw = await readRawBody(event);
  const body = JSON.parse(raw);
  if (!body) return null;

  // SendGrid Inbound Parse sends form data with fields:
  // from, to, cc, subject, text, html, headers, envelope
  const fromRaw = body.from as string | undefined;
  const from = fromRaw ? parseEmailAddress(fromRaw) : null;
  if (!from) return null;

  const toRaw = body.to as string | undefined;
  const to = toRaw ? toRaw.split(",").map((a: string) => a.trim()) : [];
  const ccRaw = body.cc as string | undefined;
  const cc = ccRaw ? ccRaw.split(",").map((a: string) => a.trim()) : [];

  // Parse raw headers string
  const headersStr = body.headers as string | undefined;
  const headers = parseHeadersString(headersStr);
  const messageId = headers["message-id"] || `sendgrid-${Date.now()}`;

  return {
    messageId,
    subject: (body.subject as string) || "(no subject)",
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    text: body.text as string | undefined,
    html: body.html as string | undefined,
    inReplyTo: headers["in-reply-to"] || undefined,
    references: parseReferencesHeader(headers["references"]),
    date: headers["date"] || undefined,
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function isRateLimited(senderEmail: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(senderEmail);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(senderEmail, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers — email address parsing
// ---------------------------------------------------------------------------

/** Parse "Name <addr@example.com>" or plain "addr@example.com" */
function parseEmailAddress(raw: string): { name?: string; email: string } {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match && match[2]) {
    return {
      name: match[1].replace(/^["']|["']$/g, "").trim() || undefined,
      email: match[2].trim(),
    };
  }
  return { email: raw.trim() };
}

/** Normalize a to/cc field that may be a string, array, or undefined into a string[] of addresses */
function normalizeAddressList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((a) => a.trim());
  return raw.split(",").map((a) => a.trim());
}

// ---------------------------------------------------------------------------
// Helpers — header parsing
// ---------------------------------------------------------------------------

/** Parse a headers object (Resend format: array of {name, value} or Record) */
function parseHeadersObject(headers: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (h && typeof h === "object" && "name" in h && "value" in h) {
        result[(h.name as string).toLowerCase()] = h.value as string;
      }
    }
  } else if (typeof headers === "object") {
    for (const [key, value] of Object.entries(
      headers as Record<string, unknown>,
    )) {
      result[key.toLowerCase()] = String(value);
    }
  }
  return result;
}

/** Parse a raw headers string (SendGrid format: "Key: Value\nKey: Value\n...") */
function parseHeadersString(raw: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;

  const lines = raw.split(/\r?\n/);
  let currentKey = "";
  let currentValue = "";

  for (const line of lines) {
    // Continuation line (starts with whitespace)
    if (/^\s/.test(line) && currentKey) {
      currentValue += " " + line.trim();
      continue;
    }
    // Save previous header
    if (currentKey) {
      result[currentKey.toLowerCase()] = currentValue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      currentKey = line.slice(0, colonIdx).trim();
      currentValue = line.slice(colonIdx + 1).trim();
    } else {
      currentKey = "";
      currentValue = "";
    }
  }
  // Save last header
  if (currentKey) {
    result[currentKey.toLowerCase()] = currentValue;
  }
  return result;
}

/** Parse a References header value into an array of Message-IDs */
function parseReferencesHeader(
  references: string | undefined,
): string[] | undefined {
  if (!references) return undefined;
  const ids = references.match(/<[^>]+>/g);
  return ids && ids.length > 0 ? ids : undefined;
}

// ---------------------------------------------------------------------------
// Helpers — threading
// ---------------------------------------------------------------------------

/**
 * Get the thread root ID using a Gmail-style approach:
 * the oldest Message-ID from the References chain is the thread root.
 * If no References, use the current Message-ID.
 */
function getThreadRootId(messageId: string, references?: string[]): string {
  if (references && references.length > 0) {
    return references[0];
  }
  return messageId;
}

/**
 * Scope a raw thread root id by the sender's email address. Two different
 * senders crafting the same `References:` header value should NOT collide
 * onto the same internal thread mapping — that's the email-side fix for the
 * thread-injection finding (M1 in the webhook security audit).
 *
 * The returned id is opaque to callers and stays stable across messages
 * from the same sender on the same conversation thread, so reply behaviour
 * is unchanged.
 */
function scopeThreadIdToSender(rawThreadId: string, senderEmail: string): string {
  return `${senderEmail.toLowerCase()}::${rawThreadId}`;
}

// ---------------------------------------------------------------------------
// Helpers — reply building
// ---------------------------------------------------------------------------

/** Build a References header from the platform context */
function buildReferencesHeader(ctx: Record<string, unknown>): string {
  const parts: string[] = [];

  // Include existing references
  const refs = ctx.references as string[] | undefined;
  if (refs) {
    parts.push(...refs);
  }

  // Append the current message ID
  const messageId = ctx.messageId as string | undefined;
  if (messageId) {
    // Avoid duplicates
    if (!parts.includes(messageId)) {
      parts.push(messageId);
    }
  }

  return parts.join(" ");
}

/**
 * Build CC list for reply-all when agent was CC'd.
 * Include original To addresses and other CC addresses, excluding the agent and the original sender.
 */
function buildReplyAllCc(context: IncomingMessage): string[] | undefined {
  const agentAddress = process.env.EMAIL_AGENT_ADDRESS?.toLowerCase();
  const senderEmail = context.senderId?.toLowerCase();
  const toAddresses = (context.platformContext.to as string[]) || [];
  const ccAddresses = (context.platformContext.cc as string[]) || [];

  const allRecipients = new Set<string>();
  for (const addr of [...toAddresses, ...ccAddresses]) {
    const normalized = addr.toLowerCase().trim();
    // Exclude agent address and original sender (sender goes in To)
    if (normalized !== agentAddress && normalized !== senderEmail) {
      allRecipients.add(normalized);
    }
  }

  return allRecipients.size > 0 ? Array.from(allRecipients) : undefined;
}

// ---------------------------------------------------------------------------
// Helpers — text conversion
// ---------------------------------------------------------------------------

/** Strip HTML tags for a plain-text version of the email */
function stripHtmlForPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Convert basic markdown to HTML for email rendering */
function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML entities in the source (but not our generated tags)
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_ (but not inside words with underscores)
  html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<em>$1</em>");
  html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<em>$1</em>");

  // Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color:#2563eb;text-decoration:underline;">$1</a>',
  );

  // Inline code: `code`
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:0.9em;">$1</code>',
  );

  // Unordered lists: lines starting with "- " or "* "
  html = html.replace(/^([*-]) (.+)$/gm, "<li>$2</li>");
  // Wrap consecutive <li> in <ul>
  html = html.replace(
    /(<li>.*?<\/li>\n?)+/g,
    '<ul style="margin:8px 0;padding-left:20px;">$&</ul>',
  );

  // Ordered lists: lines starting with "1. ", "2. " etc.
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  // Wrap consecutive <li> that aren't in <ul> in <ol>
  html = html.replace(/(?<!<\/ul>)(<li>.*?<\/li>\n?)+/g, (match) => {
    if (match.includes("<ul")) return match;
    return `<ol style="margin:8px 0;padding-left:20px;">${match}</ol>`;
  });

  // Headings: # through ###
  html = html.replace(
    /^### (.+)$/gm,
    '<h3 style="margin:16px 0 8px;font-size:1.1em;">$1</h3>',
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h2 style="margin:16px 0 8px;font-size:1.25em;">$1</h2>',
  );
  html = html.replace(
    /^# (.+)$/gm,
    '<h1 style="margin:16px 0 8px;font-size:1.4em;">$1</h1>',
  );

  // Horizontal rules: --- or ***
  html = html.replace(
    /^(-{3,}|\*{3,})$/gm,
    '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">',
  );

  // Paragraphs: double newlines
  html = html.replace(/\n\n/g, "</p><p>");
  // Single newlines → <br>
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph tags
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}

/** Wrap body HTML in a minimal email template with inline styles */
function wrapInEmailTemplate(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<div style="max-width:600px;margin:0 auto;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">
${bodyHtml}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Raw body reader (matches Slack adapter pattern)
// ---------------------------------------------------------------------------

/** Read the raw body as a string (H3 may have already parsed it) */
async function readRawBody(event: H3Event): Promise<string> {
  if (event.context.__rawBody) return event.context.__rawBody as string;
  const body = await readBody(event);
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  event.context.__rawBody = raw;
  return raw;
}
