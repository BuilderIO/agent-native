/**
 * Framework-level agent action for sending transactional/notification emails
 * via the configured core email transport (Resend or SendGrid).
 *
 * Registered as a native tool in every template when RESEND_API_KEY or
 * SENDGRID_API_KEY is set. When neither key is present the tool is omitted
 * from the agent surface so the agent never sees it.
 *
 * SAFETY: the action description instructs the agent to draft-first and only
 * send when the user explicitly confirms, matching the mail template convention.
 *
 * COLLISION: the mail template registers its own richer "send-email" action.
 * The template's registration comes after this one in the spread, so it wins
 * when both would be present under the same key. To avoid any ambiguity this
 * action is keyed "core-send-email" which is distinct from the template name.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import { isEmailConfigured, sendEmail } from "./email.js";

function markdownToText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^\s)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^\s)]+\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

function markdownToHtml(md: string): string {
  const normalized = md.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "<p></p>";

  // Escape HTML entities in a string, preserving already-encoded references.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // Inline markdown: links, bold, italic, code, bare URLs.
  const inline = (s: string): string =>
    s
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (_m, label: string, url: string) =>
          `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`,
      )
      .replace(
        /(^|[^\w"'=])(https?:\/\/[^\s<]+)/g,
        (_m, pre: string, url: string) =>
          `${pre}<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`,
      )
      .replace(/`([^`]+)`/g, (_m, code: string) => `<code>${esc(code)}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>");

  const blocks = normalized.split(/\n{2,}/);
  const html = blocks
    .map((block) => {
      const trimmed = block.trim();

      // Fenced code block
      if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
        const code = trimmed
          .replace(/^```[^\n]*\n?/, "")
          .replace(/\n?```$/, "");
        return `<pre><code>${esc(code)}</code></pre>`;
      }

      // Heading
      const hm = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (hm) {
        const level = hm[1].length;
        return `<h${level}>${inline(hm[2])}</h${level}>`;
      }

      // Unordered list
      if (/^[-*+]\s+/m.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter(Boolean)
          .map((l) => `<li>${inline(l.replace(/^[-*+]\s+/, ""))}</li>`)
          .join("");
        return `<ul style="margin:0 0 1em;padding-left:1.5em">${items}</ul>`;
      }

      // Ordered list
      if (/^\d+\.\s+/m.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter(Boolean)
          .map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ""))}</li>`)
          .join("");
        return `<ol style="margin:0 0 1em;padding-left:1.5em">${items}</ol>`;
      }

      // Blockquote
      if (trimmed.startsWith("> ")) {
        const inner = trimmed
          .split("\n")
          .map((l) => (l.startsWith("> ") ? l.slice(2) : l))
          .join("\n");
        return `<blockquote style="margin:0 0 1em 1em;border-left:3px solid #ccc;padding-left:0.75em;color:#555">${inline(inner)}</blockquote>`;
      }

      return `<p style="margin:0 0 1em">${inline(trimmed).replace(/\n/g, "<br />")}</p>`;
    })
    .join("");

  return html;
}

export function createCoreEmailActionEntries(): Record<string, ActionEntry> {
  if (!isEmailConfigured()) return {};

  return {
    "core-send-email": {
      tool: {
        description: [
          "Send a transactional email via the app's configured email provider (Resend or SendGrid).",
          "",
          "IMPORTANT — DRAFT-FIRST SAFETY RULE: Never call this tool until the user has explicitly",
          "confirmed they want to send. Always compose the full email content first, show it to the",
          "user, and wait for an explicit 'yes, send it' before invoking this action.",
          "",
          "The body is written in markdown. Tables, lists, bold, italic, links, and code blocks",
          "are all supported and will render correctly in email clients.",
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
            html: markdownToHtml(bodyMd),
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
