import { getAppConfig } from "../app-config/index.js";
import { FAVICON_PNG_BASE64 } from "../assets/branding/favicon-base64.js";
import {
  getScopedEmailProviderCategory,
  recordEmailSend,
} from "../email-catalog/log.js";
import { redactSensitiveEmailBodyContent } from "../email-catalog/redact-body.js";
import {
  readDeployCredentialEnv,
  resolveSecret,
} from "./credential-provider.js";
import { AGENT_NATIVE_EMAIL_LOGO_CONTENT_ID } from "./email-template.js";
import { getRequestOrgId } from "./request-context.js";
import { isTestIdentity } from "./test-identity.js";

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
  disableClickTracking?: boolean;
  useDeploymentCredentials?: boolean;
  from?: string;
  fromName?: string;
  cc?: string | string[];
  replyTo?: string;
  appSender?: { name: string; slug: string; replyTo?: string };
  inReplyTo?: string;
  references?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  attachments?: EmailAttachment[];
  timeoutMs?: number;
  templateId?: string;
  app?: string;
  orgId?: string;
  signal?: AbortSignal;
  /**
   * Account-access mail: sign-in links, verification, password reset, org
   * invitations. Delivered to test identities too, since they must still be
   * able to sign in. Everything else to a test identity is suppressed.
   */
  authCritical?: boolean;
}

export type SendEmailResult =
  | { status: "sent"; provider: EmailProvider }
  | { status: "suppressed"; reason: "test-identity" };

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

function resolveEmailHeaders(
  args: SendEmailArgs,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  const setHeader = (name: string, value: string) => {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new Error(
        "Email headers must have valid names and single-line values",
      );
    }
    const existingName = Object.keys(headers).find(
      (existing) => existing.toLowerCase() === name.toLowerCase(),
    );
    if (existingName) delete headers[existingName];
    headers[name] = value;
  };

  for (const [name, value] of Object.entries(args.headers ?? {})) {
    if (typeof value !== "string") {
      throw new Error(
        "Email headers must have valid names and single-line values",
      );
    }
    setHeader(name, value);
  }
  if (args.inReplyTo) setHeader("In-Reply-To", args.inReplyTo);
  if (args.references) setHeader("References", args.references);
  return Object.keys(headers).length > 0 ? headers : undefined;
}

interface EmailTransportConfig {
  provider: EmailProvider;
  resendApiKey?: string;
  sendgridApiKey?: string;
  from?: string;
}

async function resolveEmailTransport(
  useDeploymentCredentials = false,
): Promise<EmailTransportConfig> {
  const resolve = useDeploymentCredentials
    ? (key: string) => readDeployCredentialEnv(key) ?? null
    : resolveSecret;
  const [resendApiKey, sendgridApiKey, from] = await Promise.all([
    resolve("RESEND_API_KEY"),
    resolve("SENDGRID_API_KEY"),
    resolve("EMAIL_FROM"),
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

function classifyEmailReadiness(config: EmailTransportConfig): EmailReadiness {
  if (config.provider === "dev") {
    return { status: "not-configured", provider: "dev" };
  }
  if (config.provider === "sendgrid" && !config.from) {
    return { status: "misconfigured", provider: "sendgrid" };
  }
  return { status: "ready", provider: config.provider };
}

/**
 * Auth uses one Better Auth instance per process, so its email policy must
 * come from deployment configuration rather than a request-scoped secret.
 * Scoped email keys still support transactional app mail, but cannot safely
 * configure unauthenticated magic-link or signup-verification flows.
 */
export function getDeploymentEmailReadiness(): EmailReadiness {
  const provider = readDeployCredentialEnv("RESEND_API_KEY")
    ? "resend"
    : readDeployCredentialEnv("SENDGRID_API_KEY")
      ? "sendgrid"
      : "dev";
  return classifyEmailReadiness({
    provider,
    from: readDeployCredentialEnv("EMAIL_FROM") || undefined,
  });
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
    return classifyEmailReadiness(await resolveEmailTransport());
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
  if (config.provider === "sendgrid") {
    throw new Error(
      "EMAIL_FROM is required when using SendGrid — save it as a verified sender address.",
    );
  }
  return "Agent-Native <onboarding@resend.dev>";
}

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
  requestPayload?: string;
  responseStatus?: number;
  responseBody?: string;
}

/**
 * Thrown when a provider request completed (we got an HTTP response) but the
 * status was not 2xx. Carries the raw request/response so the audit log can
 * distinguish "the provider rejected it" from a thrown error that never
 * reached the provider (network failure, timeout, credential resolution).
 */
export class EmailProviderError extends Error {
  readonly provider: EmailProvider;
  readonly from: string;
  readonly requestPayload: string;
  readonly responseStatus: number;
  readonly responseBody: string;

  constructor(
    message: string,
    details: {
      provider: EmailProvider;
      from: string;
      requestPayload: string;
      responseStatus: number;
      responseBody: string;
    },
  ) {
    super(message);
    this.name = "EmailProviderError";
    this.provider = details.provider;
    this.from = details.from;
    this.requestPayload = details.requestPayload;
    this.responseStatus = details.responseStatus;
    this.responseBody = details.responseBody;
  }
}

const MAX_LOGGED_TEXT_LENGTH = 8_000;

function truncateForLog(value: string): string {
  if (value.length <= MAX_LOGGED_TEXT_LENGTH) return value;
  const omitted = value.length - MAX_LOGGED_TEXT_LENGTH;
  return `${value.slice(0, MAX_LOGGED_TEXT_LENGTH)}<truncated, ${omitted} more characters>`;
}

function omittedBodyMarker(value: unknown): unknown {
  return typeof value === "string" ? `<omitted, ${value.length} chars>` : value;
}

function redactPayloadForLog(payload: Record<string, unknown>): string {
  const loggable: Record<string, unknown> = { ...payload };
  if ("html" in loggable) loggable.html = omittedBodyMarker(loggable.html);
  if ("text" in loggable) loggable.text = omittedBodyMarker(loggable.text);
  if (
    loggable.headers &&
    typeof loggable.headers === "object" &&
    !Array.isArray(loggable.headers)
  ) {
    const headers = { ...(loggable.headers as Record<string, unknown>) };
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "list-unsubscribe") {
        headers[name] = "[REDACTED]";
      }
    }
    loggable.headers = headers;
  }
  if (Array.isArray(loggable.content)) {
    loggable.content = (loggable.content as Record<string, unknown>[]).map(
      (entry) => ({ ...entry, value: omittedBodyMarker(entry.value) }),
    );
  }
  if (Array.isArray(loggable.attachments) && loggable.attachments.length) {
    loggable.attachments = (
      loggable.attachments as Record<string, unknown>[]
    ).map(({ content: _content, ...rest }) => ({
      ...rest,
      contentOmitted: true,
    }));
  }
  return truncateForLog(JSON.stringify(loggable));
}

function unreadableResponseBody(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<response body unreadable: ${message}>`;
}

async function deliverEmail(
  args: SendEmailArgs,
  signal?: AbortSignal,
): Promise<DeliveryOutcome> {
  const config = await resolveEmailTransport(args.useDeploymentCredentials);
  signal?.throwIfAborted();
  const provider = config.provider;
  const branded = resolveAppSender(config.from, args.appSender);
  const from =
    branded && !args.from
      ? withDisplayName(branded.address, args.fromName ?? branded.name)
      : getFromAddress(config, args.from, args.fromName);
  const replyTo = args.replyTo ?? branded?.replyTo;
  const attachments = resolveAttachments(args);
  const messageHeaders = resolveEmailHeaders(args);

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
    if (messageHeaders) payload.headers = messageHeaders;

    const requestPayload = redactPayloadForLog(payload);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
        ...(args.idempotencyKey
          ? { "Idempotency-Key": args.idempotencyKey }
          : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });
    const responseBody = truncateForLog(
      await res.text().catch(unreadableResponseBody),
    );
    if (!res.ok) {
      throw new EmailProviderError(
        `Resend error ${res.status}: ${responseBody}`,
        {
          provider,
          from,
          requestPayload,
          responseStatus: res.status,
          responseBody,
        },
      );
    }
    return {
      provider,
      from,
      requestPayload,
      responseStatus: res.status,
      responseBody,
    };
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
    const orgId = args.orgId ?? getRequestOrgId();
    const categories = [
      args.templateId,
      args.app ?? getAppConfig().app.slug,
      args.templateId && orgId
        ? getScopedEmailProviderCategory(args.templateId, orgId)
        : undefined,
    ].filter((value): value is string => Boolean(value));
    if (categories.length) sgPayload.categories = categories;
    if (args.disableClickTracking) {
      sgPayload.tracking_settings = {
        click_tracking: { enable: false },
      };
    }
    if (messageHeaders) sgPayload.headers = messageHeaders;
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

    const requestPayload = redactPayloadForLog(sgPayload);
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sgPayload),
      signal,
    });
    const responseBody = truncateForLog(
      await res.text().catch(unreadableResponseBody),
    );
    if (!res.ok) {
      throw new EmailProviderError(
        `SendGrid error ${res.status}: ${responseBody}`,
        {
          provider,
          from,
          requestPayload,
          responseStatus: res.status,
          responseBody,
        },
      );
    }
    return {
      provider,
      from,
      requestPayload,
      responseStatus: res.status,
      responseBody,
    };
  }

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

async function sendEmailWithSignal(
  args: SendEmailArgs,
  signal?: AbortSignal,
): Promise<SendEmailResult> {
  const baseRecord = {
    templateId: args.templateId,
    app: args.app ?? getAppConfig().app.slug ?? "unknown",
    orgId: args.orgId ?? getRequestOrgId(),
    recipient: args.to,
    subject: args.subject,
    htmlBody: truncateForLog(redactSensitiveEmailBodyContent(args.html)),
    textBody: args.text
      ? truncateForLog(redactSensitiveEmailBodyContent(args.text))
      : undefined,
  };
  if (!args.authCritical && isTestIdentity(args.to)) {
    console.info(
      `[agent-native:email] suppressed: test identity (${args.templateId ?? "untemplated"})`,
    );
    await recordEmailSend({
      ...baseRecord,
      sender: args.from ?? "unknown",
      status: "suppressed",
      error: "suppressed: test identity",
      provider: "none",
    });
    return { status: "suppressed", reason: "test-identity" };
  }
  let outcome: DeliveryOutcome | undefined;
  try {
    outcome = await deliverEmail(args, signal);
  } catch (error) {
    // A response was received but the provider rejected it: the error carries
    // the raw request/response so "provider said no" stays distinguishable
    // from "we never reached the provider" (network failure, timeout,
    // credential resolution failure), which sets none of these three fields.
    const providerError =
      error instanceof EmailProviderError ? error : undefined;
    await recordEmailSend({
      ...baseRecord,
      sender: providerError?.from ?? args.from ?? "unknown",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      provider: providerError?.provider ?? "unknown",
      requestPayload: providerError?.requestPayload,
      responseStatus: providerError?.responseStatus,
      responseBody: providerError?.responseBody,
    });
    throw error;
  }
  await recordEmailSend({
    ...baseRecord,
    sender: outcome.from,
    status: "sent",
    provider: outcome.provider,
    requestPayload: outcome.requestPayload,
    responseStatus: outcome.responseStatus,
    responseBody: outcome.responseBody,
  });
  return { status: "sent", provider: outcome.provider };
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  if (
    args.idempotencyKey !== undefined &&
    (!args.idempotencyKey ||
      args.idempotencyKey.length > 256 ||
      args.idempotencyKey !== args.idempotencyKey.trim() ||
      /[\r\n]/.test(args.idempotencyKey))
  ) {
    throw new Error(
      "Email idempotency keys must be single-line values up to 256 characters",
    );
  }
  const requestedTimeoutMs = Number(args.timeoutMs);
  if (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs <= 0) {
    return sendEmailWithSignal(args, args.signal);
  }

  const timeoutMs = Math.floor(requestedTimeoutMs);
  const controller = new AbortController();
  const signal = args.signal
    ? AbortSignal.any([args.signal, controller.signal])
    : controller.signal;
  const timeoutError = new Error(`Email send timed out after ${timeoutMs}ms`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sendEmailWithSignal(args, signal),
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
