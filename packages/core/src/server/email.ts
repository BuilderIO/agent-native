/**
 * Email transport for system emails (password resets, invitations, notifications).
 *
 * Providers are selected by env var:
 *   RESEND_API_KEY    — https://resend.com
 *   SENDGRID_API_KEY  — https://sendgrid.com
 *   EMAIL_FROM        — "Name <addr@domain>" (optional; defaults to Resend's sandbox)
 *
 * With neither provider configured, `sendEmail` logs the message to the console
 * so the reset-password flow still works end-to-end for local development.
 */

export type EmailProvider = "resend" | "sendgrid" | "dev";

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  cc?: string | string[];
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: EmailAttachment[];
}

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY);
}

export function getEmailProvider(): EmailProvider {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SENDGRID_API_KEY) return "sendgrid";
  return "dev";
}

function getFromAddress(override?: string, provider?: EmailProvider): string {
  const explicit = override || process.env.EMAIL_FROM;
  if (explicit) return explicit;
  // Resend lets unverified accounts send from its sandbox domain; SendGrid
  // does not, so falling back there would cause silent 403s at runtime.
  if (provider === "sendgrid") {
    throw new Error(
      "EMAIL_FROM is required when using SendGrid — set it to a verified sender address.",
    );
  }
  return "Agent Native <onboarding@resend.dev>";
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const provider = getEmailProvider();
  const from = getFromAddress(args.from, provider);

  if (provider === "resend") {
    const payload: Record<string, unknown> = {
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    };
    if (args.cc) payload.cc = Array.isArray(args.cc) ? args.cc : [args.cc];
    if (args.replyTo) payload.reply_to = args.replyTo;
    if (args.attachments?.length) {
      payload.attachments = args.attachments.map((a) => ({
        filename: a.filename,
        content:
          typeof a.content === "string"
            ? a.content
            : a.content.toString("base64"),
        content_type: a.contentType,
      }));
    }
    const headers: Record<string, string> = {};
    if (args.inReplyTo) headers["In-Reply-To"] = args.inReplyTo;
    if (args.references) headers["References"] = args.references;
    if (Object.keys(headers).length) payload.headers = headers;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend error ${res.status}: ${body}`);
    }
    return;
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
    if (args.replyTo) sgPayload.reply_to = parseSendGridFrom(args.replyTo);
    const sgHeaders: Record<string, string> = {};
    if (args.inReplyTo) sgHeaders["In-Reply-To"] = args.inReplyTo;
    if (args.references) sgHeaders["References"] = args.references;
    if (Object.keys(sgHeaders).length) sgPayload.headers = sgHeaders;
    if (args.attachments?.length) {
      sgPayload.attachments = args.attachments.map((a) => ({
        filename: a.filename,
        content:
          typeof a.content === "string"
            ? Buffer.from(a.content).toString("base64")
            : a.content.toString("base64"),
        type: a.contentType,
      }));
    }

    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sgPayload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SendGrid error ${res.status}: ${body}`);
    }
    return;
  }

  // Dev fallback — no provider configured. Logging the full body exposes
  // reset tokens, so only do it outside production. In production, refuse
  // to send rather than silently leaking secrets to logs.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.",
    );
  }
  console.log(
    `\n[agent-native:email] No email provider configured. ` +
      `Set RESEND_API_KEY or SENDGRID_API_KEY to send real emails.\n` +
      `---\nTo: ${args.to}\nFrom: ${from}\nSubject: ${args.subject}\n\n` +
      `${args.text || stripHtml(args.html)}\n---\n`,
  );
}

function parseSendGridFrom(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  if (m && m[2]) return { name: m[1] || undefined, email: m[2] };
  return { email: from.trim() };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}
