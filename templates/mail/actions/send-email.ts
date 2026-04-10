import { defineAction } from "@agent-native/core";
import { getAccessTokens } from "./helpers.js";
import { z } from "zod";
import {
  gmailGetMessage,
  gmailSendMessage,
  googleFetch,
} from "../server/lib/google-api.js";
import { getSetting } from "@agent-native/core/settings";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInlineMarkdown(text: string): string {
  return text
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label, url) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    )
    .replace(
      /(?<!["(>])(https?:\/\/[^\s<]+)/g,
      (url) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "<div></div>";

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim());
  const html = blocks
    .map((block) => {
      if (block.startsWith("```") && block.endsWith("```")) {
        const code = block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
      const heading = block.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${applyInlineMarkdown(escapeHtml(heading[2]))}</h${level}>`;
      }
      if (/^(\-|\*|\+)\s+/m.test(block)) {
        const items = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^(\-|\*|\+)\s+/, ""))
          .map((line) => `<li>${applyInlineMarkdown(escapeHtml(line))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      if (/^\d+\.\s+/m.test(block)) {
        const items = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^\d+\.\s+/, ""))
          .map((line) => `<li>${applyInlineMarkdown(escapeHtml(line))}</li>`)
          .join("");
        return `<ol>${items}</ol>`;
      }
      return `<p>${applyInlineMarkdown(escapeHtml(block)).replace(/\n/g, "<br />")}</p>`;
    })
    .join("");

  return `<div>${html}</div>`;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1$2")
    .trim();
}

function splitReplyQuote(body: string): {
  newContent: string;
  attribution: string;
  quotedBody: string;
} | null {
  const replyMatch = body.match(/\n*— On (.+? wrote):\n/);
  const fwdMatch = body.match(/\n*(— Forwarded message —)\n/);
  const match = replyMatch || fwdMatch;
  if (!match || match.index === undefined) return null;

  const newContent = body.slice(0, match.index);
  const attribution = replyMatch ? `On ${match[1]}:` : "Forwarded message";
  const afterSeparator = body.slice(match.index + match[0].length);
  return { newContent, attribution, quotedBody: afterSeparator };
}

function bodyToHtml(body: string): string {
  const split = splitReplyQuote(body);
  if (split) {
    const newHtml = markdownToHtml(split.newContent);
    const stripped = split.quotedBody
      .split("\n")
      .map((line) => {
        if (line.startsWith("> ")) return line.slice(2);
        if (line === ">") return "";
        return line;
      })
      .join("\n");
    const innerHtml = markdownToHtml(stripped);
    const quoteHtml =
      `<div class="gmail_quote" style="margin-top:2.5em">` +
      `<div class="gmail_attr">${escapeHtml(split.attribution)}</div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
      innerHtml +
      `</blockquote></div>`;
    return newHtml + quoteHtml;
  }
  return markdownToHtml(body);
}

function buildRawEmail(opts: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const boundary = `agent-native-${Date.now()}`;
  const textBody = markdownToPlainText(opts.body);
  const htmlBody = bodyToHtml(opts.body);
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${opts.subject}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    textBody,
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    "",
    htmlBody,
    "",
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function readSettings(): Promise<{ name: string; email: string }> {
  const data = await getSetting("mail-settings");
  if (data && typeof (data as any).name === "string") {
    return { name: (data as any).name ?? "", email: (data as any).email ?? "" };
  }
  return { name: "", email: "" };
}

export default defineAction({
  description: "Send an email via Gmail.",
  schema: z.object({
    to: z.string().describe("Recipient email(s), comma-separated"),
    subject: z.string().describe("Email subject"),
    body: z
      .string()
      .describe(
        "Email body in markdown. Use [text](url) for links, **bold**, *italic*, - lists, etc.",
      ),
    cc: z.string().optional().describe("CC email(s), comma-separated"),
    bcc: z.string().optional().describe("BCC email(s), comma-separated"),
    replyToId: z
      .string()
      .optional()
      .describe("Message ID being replied to (for threading)"),
    account: z
      .string()
      .optional()
      .describe("Specific account email to send from"),
  }),
  run: async (args) => {
    const settings = await readSettings();
    const accounts = await getAccessTokens();
    if (accounts.length === 0) return "Error: No Google account connected.";

    let selectedToken = accounts[0].accessToken;
    let selectedEmail = accounts[0].email;

    if (args.account) {
      const match = accounts.find((a) => a.email === args.account);
      if (!match) return `Error: Account ${args.account} not connected`;
      selectedToken = match.accessToken;
      selectedEmail = match.email;
    }

    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    let references: string | undefined;

    if (args.replyToId) {
      for (const { email, accessToken } of accounts) {
        try {
          const original = await gmailGetMessage(
            accessToken,
            args.replyToId,
            "metadata",
          );
          threadId = original.threadId ?? undefined;
          const headers = original.payload?.headers || [];
          inReplyTo =
            headers.find(
              (h: any) => h.name === "Message-Id" || h.name === "Message-ID",
            )?.value ?? undefined;
          const refs = headers.find((h: any) => h.name === "References")?.value;
          references = [refs, inReplyTo].filter(Boolean).join(" ");
          if (!args.account) {
            selectedToken = accessToken;
            selectedEmail = email;
          }
          break;
        } catch {}
      }
    }

    // Fetch sender display name from Gmail send-as settings,
    // falling back to Google profile name, then settings.name
    let fromHeader = settings.name
      ? `${settings.name} <${selectedEmail}>`
      : selectedEmail;
    try {
      const sendAs = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs`,
        selectedToken,
      );
      const match = sendAs?.sendAs?.find(
        (s: any) =>
          s.sendAsEmail?.toLowerCase() === selectedEmail.toLowerCase(),
      );
      if (match?.displayName) {
        fromHeader = `${match.displayName} <${selectedEmail}>`;
      }
    } catch {
      // Fall back to profile name below
    }
    // If still no display name, try Google profile
    if (
      fromHeader === selectedEmail ||
      (!fromHeader.includes("<") && !settings.name)
    ) {
      try {
        const profile = await googleFetch(
          `https://www.googleapis.com/oauth2/v2/userinfo`,
          selectedToken,
        );
        if (profile?.name) {
          fromHeader = `${profile.name} <${selectedEmail}>`;
        }
      } catch {
        // Fall back to settings.name or email-only
      }
    }

    const raw = buildRawEmail({
      from: fromHeader,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      body: args.body,
      inReplyTo,
      references,
    });

    try {
      const sent = await gmailSendMessage(selectedToken, raw, threadId);
      return `Email sent successfully (id: ${sent.id})`;
    } catch (err: any) {
      return `Error sending email: ${err?.message}`;
    }
  },
});
