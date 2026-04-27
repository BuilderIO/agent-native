import { defineAction } from "@agent-native/core";
import { getAccessTokens } from "./helpers.js";
import { z } from "zod";
import {
  gmailGetMessage,
  gmailSendMessage,
  googleFetch,
} from "../server/lib/google-api.js";
import { getSetting } from "@agent-native/core/settings";
import { emit } from "@agent-native/core/event-bus";
import {
  collectLinks,
  injectTrackingIntoHtml,
  newClickToken,
  newPixelToken,
  persistTracking,
  type TrackingContext,
} from "../server/lib/email-tracking.js";
import { getAppProductionUrl } from "@agent-native/core/server";
import type { UserSettings } from "../shared/types.js";

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
      const cleanBlock = block.replace(/\\\n/g, "\n").replace(/\\$/gm, "");
      return `<p>${applyInlineMarkdown(escapeHtml(cleanBlock)).replace(/\n/g, "<br />")}</p>`;
    })
    .join("");

  return `<div>${html}</div>`;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\\\n/g, "\n")
    .replace(/\\$/gm, "")
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

function bodyToHtml(body: string, tracking?: TrackingContext): string {
  const split = splitReplyQuote(body);
  if (split) {
    const newHtml = markdownToHtml(split.newContent);
    const injectedNew = tracking
      ? injectTrackingIntoHtml(newHtml, tracking)
      : newHtml;
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
    return injectedNew + quoteHtml;
  }
  const html = markdownToHtml(body);
  return tracking ? injectTrackingIntoHtml(html, tracking) : html;
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
  tracking?: TrackingContext;
}): string {
  const boundary = `agent-native-${Date.now()}`;
  const textBody = markdownToPlainText(opts.body);
  const htmlBody = bodyToHtml(opts.body, opts.tracking);
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

async function readSettings(): Promise<{
  name: string;
  email: string;
  tracking?: UserSettings["tracking"];
}> {
  const data = await getSetting("mail-settings");
  if (data && typeof (data as any).name === "string") {
    return {
      name: (data as any).name ?? "",
      email: (data as any).email ?? "",
      tracking: (data as any).tracking,
    };
  }
  return { name: "", email: "" };
}

function buildTrackingContext(
  body: string,
  tracking: UserSettings["tracking"],
): TrackingContext | undefined {
  const trackOpens = tracking?.opens !== false;
  const trackClicks = tracking?.clicks === true;
  if (!trackOpens && !trackClicks) return undefined;

  const linkTokens = new Map<string, string>();
  if (trackClicks) {
    const split = splitReplyQuote(body);
    const portion = split ? split.newContent : body;
    for (const url of collectLinks(portion)) {
      linkTokens.set(url, newClickToken());
    }
  }

  return {
    pixelToken: newPixelToken(),
    linkTokens,
    trackOpens,
    trackClicks,
    appUrl: getAppProductionUrl(),
  };
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

    const tracking = buildTrackingContext(args.body, settings.tracking);

    const raw = buildRawEmail({
      from: fromHeader,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      body: args.body,
      inReplyTo,
      references,
      tracking,
    });

    try {
      const sent = await gmailSendMessage(selectedToken, raw, threadId);
      if (tracking && sent?.id) {
        await persistTracking({
          pixelToken: tracking.pixelToken,
          messageId: sent.id,
          ownerEmail: selectedEmail,
          sentAt: Date.now(),
          linkTokens: tracking.linkTokens,
        }).catch((err) =>
          console.error("[send-email] persistTracking failed:", err),
        );
      }
      // Emit mail.message.sent event (best-effort)
      try {
        emit(
          "mail.message.sent",
          {
            messageId: sent.id,
            to: args.to,
            subject: args.subject,
          },
          { owner: selectedEmail },
        );
      } catch {
        // best-effort — never block the send response
      }

      return `Email sent successfully (id: ${sent.id})`;
    } catch (err: any) {
      return `Error sending email: ${err?.message}`;
    }
  },
});
