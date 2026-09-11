/**
 * Framework-level agent action for sending transactional/notification emails
 * via the configured core email transport (Resend or SendGrid).
 *
 * Registered as a native tool in every template. sendEmail() checks the
 * scoped Resend/SendGrid configuration at call time.
 *
 * SAFETY: interactive runs are draft-first. Unattended automation runs are
 * already authorized when the automation is created, so they get a separate
 * description that permits delivery without interactive confirmation.
 *
 * COLLISION: the mail template registers its own richer "send-email" action.
 * The template's registration comes after this one in the spread, so it wins
 * when both would be present under the same key. To avoid any ambiguity this
 * action is keyed "core-send-email" which is distinct from the template name.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import {
  markdownToHtml,
  markdownToText,
  wrapInEmailTemplate,
} from "./email-markdown.js";
import { sendEmail } from "./email.js";

export function createCoreEmailActionEntries(options?: {
  unattended?: boolean;
}): Record<string, ActionEntry> {
  const unattended = options?.unattended === true;
  return {
    "core-send-email": {
      tool: {
        description: [
          "Send a transactional email via the app's configured email provider (Resend or SendGrid).",
          "",
          ...(unattended
            ? [
                "This is an explicitly authorized unattended automation run. Send the email without asking for an interactive confirmation.",
              ]
            : [
                "IMPORTANT — DRAFT-FIRST SAFETY RULE: Never call this tool until the user has explicitly",
                "confirmed they want to send. Always compose the full email content first, show it to the",
                "user, and wait for an explicit 'yes, send it' before invoking this action.",
              ]),
          "",
          "The body is written in markdown. Tables, lists, bold, italic, links, and code blocks",
          "are all supported and will render correctly in email clients. Write the body in markdown; do not hand-write HTML.",
          "",
          "This sends via the framework transport (Resend/SendGrid). It is NOT the Gmail-based",
          "send-email action in the mail template — use this for system/notification emails from",
          "any template.",
        ].join("\n"),
        parameters: {
          type: "object" as const,
          properties: {
            to: {
              type: "string",
              description: "Recipient email address.",
            },
            subject: {
              type: "string",
              description: "Email subject line.",
            },
            body: {
              type: "string",
              description:
                "Email body in markdown. Tables, lists, headings, bold, italic, links, and code blocks are supported.",
            },
            cc: {
              type: "string",
              description: "CC email address (single address only).",
            },
            bcc: {
              type: "string",
              description: "BCC email address (single address only).",
            },
            replyTo: {
              type: "string",
              description:
                "Reply-To address. Useful when sending on behalf of someone.",
            },
            from: {
              type: "string",
              description:
                'Override the sender address. Must be a verified sender for the configured provider. Example: "Team Name <team@example.com>". Leave unset to use the default EMAIL_FROM env var.',
            },
          },
          required: ["to", "subject", "body"],
        },
      },
      run: async (input: Record<string, unknown>) => {
        const to = typeof input.to === "string" ? input.to.trim() : "";
        const subject =
          typeof input.subject === "string" ? input.subject.trim() : "";
        const bodyMd = typeof input.body === "string" ? input.body.trim() : "";
        const cc =
          typeof input.cc === "string" && input.cc.trim()
            ? input.cc.trim()
            : undefined;
        const bcc =
          typeof input.bcc === "string" && input.bcc.trim()
            ? input.bcc.trim()
            : undefined;
        const replyTo =
          typeof input.replyTo === "string" && input.replyTo.trim()
            ? input.replyTo.trim()
            : undefined;
        const from =
          typeof input.from === "string" && input.from.trim()
            ? input.from.trim()
            : undefined;

        if (!to) return "Error: 'to' is required.";
        if (!subject) return "Error: 'subject' is required.";
        if (!bodyMd) return "Error: 'body' is required.";

        try {
          await sendEmail({
            to,
            subject,
            html: wrapInEmailTemplate(markdownToHtml(bodyMd)),
            text: markdownToText(bodyMd),
            ...(from ? { from } : {}),
            ...(cc ? { cc } : {}),
            ...(replyTo ? { replyTo } : {}),
          });

          const bccNote = bcc ? ` (bcc: ${bcc})` : "";
          return `Email sent to ${to}${bccNote}: "${subject}"`;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error sending email: ${msg}`;
        }
      },
    },
  };
}
