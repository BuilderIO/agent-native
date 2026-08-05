/**
 * Email transport for system emails (password resets, invitations, notifications).
 *
 * Providers are selected by scoped secrets:
 *   RESEND_API_KEY    — https://resend.com
 *   SENDGRID_API_KEY  — https://sendgrid.com
 *   EMAIL_FROM        — "Name <addr@domain>" (optional; defaults to Resend's sandbox)
 *
 * With neither provider configured, `sendEmail` logs the message to the console
 * so the reset-password flow still works end-to-end for local development.
 */

import { FAVICON_PNG_BASE64 } from "../assets/branding/favicon-base64.js";
import { recordEmailSend } from "../email-catalog/log.js";
import { getAppSlug } from "./app-name.js";
import { resolveSecret } from "./credential-provider.js";
import { AGENT_NATIVE_EMAIL_LOGO_CONTENT_ID } from "./email-template.js";

export type EmailProvider = "resend" | "sendgrid" | "dev";

export type EmailReadiness =
  | { status: "ready"; provider: Exclude<EmailProvider, "dev"> }
  | { status: "not-configured"; provider: "dev" }
  | {
      status: "misconfigured" | "unavailable";
      provider: EmailProvider | "unknown";
    };

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
  contentId?: string;
  disposition?: "attachment" | "inline";
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  /**
   * Display-name-only override. Keeps the configured (domain-verified) sending
   * address and just changes the name shown to the recipient, e.g.
   * "Alice via Clips". Ignored when `from` is set. Prefer this over `from` for
   * per-user senders: putting a user's own address in `From` breaks SPF/DKIM.
   */
  fromName?: string;
  cc?: string | string[];
  replyTo?: string;
  /**
   * Per-app branding for first-party agent-native.com deployments. Applied
   * only when the configured EMAIL_FROM is already on agent-native.com, so a
   * self-hosted deployment keeps its own verified sender and support mailbox
   * instead of sending as an unverified address a provider would reject.
   * An explicit `from` / `replyTo` always wins.
   */
  appSender?: { name: string; slug: string; replyTo?: string };
  inReplyTo?: string;
  references?: string;
  attachments?: EmailAttachment[];
  timeoutMs?: number;
  /**
   * Registered transactional email id (see `defineTransactionalEmail`), e.g.
   * `calendar.booking-confirmed`. Tags the message at the provider so delivery
   * and open metrics attribute to one email instead of to the whole account,
   * and keys the row written to `email_log`. Omit for genuinely one-off sends.
   */
  templateId?: string;
  /** App slug that owns the send. Defaults to the running app. */
  app?: string;
}

let cachedAgentNativeLogo: Buffer | undefined;

function getAgentNativeLogoAttachment(): EmailAttachment {
  cachedAgentNativeLogo ??= Buffer.from(FAVICON_PNG_BASE64, "base64");
  return {
    filename: "agent-native-logo.png",
    content: cachedAgentNativeLogo,
    contentType: "image/png",
    contentId: AGENT_NATIVE_EMAIL_LOGO_CONTENT_ID,
    disposition: "inline",
  };
}

function resolveAttachments(
  args: SendEmailArgs,
): EmailAttachment[] | undefined {
  if (!args.html.includes(`cid:${AGENT_NATIVE_EMAIL_LOGO_CONTENT_ID}`)) {
    return args.attachments;
  }
  if (
    args.attachments?.some(
      (attachment) =>
        attachment.contentId === AGENT_NATIVE_EMAIL_LOGO_CONTENT_ID,
    )
  ) {
    return args.attachments;
  }
  return [...(args.attachments ?? []), getAgentNativeLogoAttachment()];
}

interface EmailTransportConfig {
  provider: EmailProvider;
  resendApiKey?: string;
  sendgridApiKey?: string;
  from?: string;
}

async function resolveEmailTransport(): Promise<EmailTransportConfig> {
  const [resendApiKey, sendgridApiKey, from] = await Promise.all([
    resolveSecret("RESEND_API_KEY"),
    resolveSecret("SENDGRID_API_KEY"),
    resolveSecret("EMAIL_FROM"),
  ]);
  const resolvedFrom = from ?? undefined;
  if (resendApiKey) {
    return {
      provider: "resend",
      resendApiKey,
      from: resolvedFrom,
    };
  }
  if (sendgridApiKey) {
    return {
      provider: "sendgrid",
      sendgridApiKey,
      from: resolvedFrom,
    };
  }
  return { provider: "dev", from: resolvedFrom };
}

export async function isEmailConfigured(): Promise<boolean> {
  return (await getEmailReadiness()).status === "ready";
}

/**
 * Auth must only offer magic links when sending can succeed. In particular,
 * SendGrid needs EMAIL_FROM while Resend can use its sandbox sender. Keep
 * unreadable credential stores distinct from an unconfigured deployment so
 * callers can fail closed without claiming setup is absent.
 */
export async function getEmailReadiness(): Promise<EmailReadiness> {
  try {
    const config = await resolveEmailTransport();
    if (config.provider === "dev") {
      return { status: "not-configured", provider: "dev" };
    }
    if (config.provider === "sendgrid" && !config.from) {
      return { status: "misconfigured", provider: "sendgrid" };
    }
    return { status: "ready", provider: config.provider };
  } catch {
    return { status: "unavailable", provider: "unknown" };
  }
}

export async function getEmailProvider(): Promise<EmailProvider> {
  return (await resolveEmailTransport()).provider;
}

function getFromAddress(
  config: EmailTransportConfig,
  override?: string,
  fromName?: string,
): string {
  if (override) return override;
  const base = config.from ?? defaultFromAddress(config);
  return fromName ? withDisplayName(base, fromName) : base;
}

function defaultFromAddress(config: EmailTransportConfig): string {
  // Resend lets unverified accounts send from its sandbox domain; SendGrid
  // does not, so falling back there would cause silent 403s at runtime.
  if (config.provider === "sendgrid") {
    throw new Error(
      "EMAIL_FROM is required when using SendGrid — save it as a verified sender address.",
    );
  }
  return "Agent Native <onboarding@resend.dev>";
}

/**
 * Swap the display name while keeping the verified address. The name is
 * sanitized and quoted because it lands in a header: CR/LF would allow header
 * injection, and quotes/angle brackets would break address parsing.
 */
function withDisplayName(from: string, name: string): string {
  const safe = name
    .replace(/[\r\n"<>\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!safe) return from;
  const address = from.match(/<([^>]+)>/)?.[1]?.trim() ?? from.trim();
  return `"${safe}" <${address}>`;
}

const AGENT_NATIVE_SENDER_DOMAIN = "agent-native.com";

/**
 * Resolve the per-app sender address, but only for deployments whose
 * configured sender is already on agent-native.com. Any other (or missing)
 * EMAIL_FROM means we cannot prove the branded address is a verified sender,
 * so the deployment's own configuration is left untouched.
 */
let warnedAppSenderSuppressed = false;

/**
 * Suppressing the branding is correct for a sender we cannot prove we own,
 * but it must not be invisible, or an operator sees generic senders with
 * nothing pointing at why.
 *
 * EMAIL_FROM resolves per user/org/workspace through the scoped secret store,
 * so the resolved address is tenant data and must never reach shared logs, and
 * anything keyed by it would grow without bound in a warm worker. The message
 * therefore carries no tenant values, which also makes it identical for every
 * suppressed config — so emitting it once per process loses nothing.
 */
function warnAppSenderSuppressed(): void {
  if (warnedAppSenderSuppressed) return;
  warnedAppSenderSuppressed = true;
  console.warn(
    `[agent-native:email] Per-app sender branding is off because the ` +
      `configured EMAIL_FROM is not on ${AGENT_NATIVE_SENDER_DOMAIN}. ` +
      `Transactional email keeps the configured sender. Expected when self-hosting.`,
  );
}

function resolveAppSender(
  configuredFrom: string | undefined,
  appSender: SendEmailArgs["appSender"],
): { address: string; name: string; replyTo?: string } | undefined {
  if (!appSender) return undefined;
  const address = configuredFrom
    ? parseSendGridFrom(configuredFrom).email.toLowerCase()
    : undefined;
  if (!address?.endsWith(`@${AGENT_NATIVE_SENDER_DOMAIN}`)) {
    warnAppSenderSuppressed();
    return undefined;
  }
  return {
    address: `${appSender.slug}@${AGENT_NATIVE_SENDER_DOMAIN}`,
    name: appSender.name,
    replyTo: appSender.replyTo,
  };
}

interface DeliveryOutcome {
  provider: EmailProvider;
  from: string;
}

async function deliverEmail(
  args: SendEmailArgs,
  signal?: AbortSignal,
): Promise<DeliveryOutcome> {
  const config = await resolveEmailTransport();
  signal?.throwIfAborted();
  const provider = config.provider;
  const branded = resolveAppSender(config.from, args.appSender);
  const from =
    branded && !args.from
      ? withDisplayName(branded.address, args.fromName ?? branded.name)
      : getFromAddress(config, args.from, args.fromName);
  const replyTo = args.replyTo ?? branded?.replyTo;
  const attachments = resolveAttachments(args);

  if (provider === "resend") {
    const payload: Record<string, unknown> = {
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    };
    if (args.cc) payload.cc = Array.isArray(args.cc) ? args.cc : [args.cc];
    if (replyTo) payload.reply_to = replyTo;
    if (attachments?.length) {
      payload.attachments = attachments.map((a) => ({
        filename: a.filename,
        content:
          typeof a.content === "string"
            ? a.content
            : a.content.toString("base64"),
        content_type: a.contentType,
        content_id: a.contentId,
      }));
    }
    const headers: Record<string, string> = {};
    if (args.inReplyTo) headers["In-Reply-To"] = args.inReplyTo;
    if (args.references) headers["References"] = args.references;
    if (Object.keys(headers).length) payload.headers = headers;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend error ${res.status}: ${body}`);
    }
    return { provider, from };
  }

  if (provider === "sendgrid") {
    const personalization: Record<string, unknown> = {
      to: [{ email: args.to }],
    };
    if (args.cc) {
      const ccList = Array.isArray(args.cc) ? args.cc : [args.cc];
      personalization.cc = ccList.map((email) => ({ email }));
    }

    const sgPayload: Record<string, unknown> = {
      personalizations: [personalization],
      from: parseSendGridFrom(from),
      subject: args.subject,
      content: [
        ...(args.text ? [{ type: "text/plain", value: args.text }] : []),
        { type: "text/html", value: args.html },
      ],
    };
    if (replyTo) sgPayload.reply_to = parseSendGridFrom(replyTo);
    // Categories are how per-email delivery/open stats are attributed. Without
    // them every send lands in one undifferentiated account-wide bucket, which
    // is indistinguishable from an email that never sent.
    const categories = [args.templateId, args.app ?? getAppSlug()].filter(
      (value): value is string => Boolean(value),
    );
    if (categories.length) sgPayload.categories = categories;
    const sgHeaders: Record<string, string> = {};
    if (args.inReplyTo) sgHeaders["In-Reply-To"] = args.inReplyTo;
    if (args.references) sgHeaders["References"] = args.references;
    if (Object.keys(sgHeaders).length) sgPayload.headers = sgHeaders;
    if (attachments?.length) {
      sgPayload.attachments = attachments.map((a) => ({
        filename: a.filename,
        content:
          typeof a.content === "string"
            ? Buffer.from(a.content).toString("base64")
            : a.content.toString("base64"),
        type: a.contentType,
        disposition: a.disposition ?? (a.contentId ? "inline" : undefined),
        content_id: a.contentId,
      }));
    }

    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sgPayload),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SendGrid error ${res.status}: ${body}`);
    }
    return { provider, from };
  }

  // Dev fallback — no provider configured. Logging the full body exposes
  // reset tokens, so only do it outside production. In production, refuse
  // to send rather than silently leaking secrets to logs.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No email provider configured. Save RESEND_API_KEY or SENDGRID_API_KEY in settings.",
    );
  }
  console.log(
    `\n[agent-native:email] No email provider configured. ` +
      `Save RESEND_API_KEY or SENDGRID_API_KEY in settings to send real emails.\n` +
      `---\nTo: ${args.to}\nFrom: ${from}\nSubject: ${args.subject}\n\n` +
      `${args.text || stripHtml(args.html)}\n---\n`,
  );
  return { provider, from };
}

/**
 * Deliver, then record the attempt. Recording lives here rather than in each
 * provider branch so a new transport cannot be added without being logged.
 */
async function sendEmailWithSignal(
  args: SendEmailArgs,
  signal?: AbortSignal,
): Promise<void> {
  let outcome: DeliveryOutcome | undefined;
  try {
    outcome = await deliverEmail(args, signal);
  } catch (error) {
    await recordEmailSend({
      templateId: args.templateId,
      app: args.app ?? getAppSlug() ?? "unknown",
      recipient: args.to,
      sender: outcome?.from ?? args.from ?? "unknown",
      subject: args.subject,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      provider: outcome?.provider ?? "unknown",
    });
    throw error;
  }
  await recordEmailSend({
    templateId: args.templateId,
    app: args.app ?? getAppSlug() ?? "unknown",
    recipient: args.to,
    sender: outcome.from,
    subject: args.subject,
    status: "sent",
    provider: outcome.provider,
  });
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const requestedTimeoutMs = Number(args.timeoutMs);
  if (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs <= 0) {
    return sendEmailWithSignal(args);
  }

  const timeoutMs = Math.floor(requestedTimeoutMs);
  const controller = new AbortController();
  const timeoutError = new Error(`Email send timed out after ${timeoutMs}ms`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sendEmailWithSignal(args, controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseSendGridFrom(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  if (m && m[2]) return { name: unquoteDisplayName(m[1]), email: m[2] };
  return { email: from.trim() };
}

function unquoteDisplayName(name: string): string | undefined {
  const trimmed = name.trim();
  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1).replace(/\\(.)/g, "$1")
      : trimmed;
  return unquoted || undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}
