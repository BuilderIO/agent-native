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

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
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
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend error ${res.status}: ${body}`);
    }
    return;
  }

  if (provider === "sendgrid") {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: args.to }] }],
        from: parseSendGridFrom(from),
        subject: args.subject,
        content: [
          ...(args.text ? [{ type: "text/plain", value: args.text }] : []),
          { type: "text/html", value: args.html },
        ],
      }),
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
