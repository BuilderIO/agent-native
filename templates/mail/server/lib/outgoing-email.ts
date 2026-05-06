import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ComposeAttachment } from "@shared/types.js";
import {
  decodeCommonHtmlEntities,
  normalizeMarkdownHardBreaks,
} from "@shared/markdown.js";
import {
  injectTrackingIntoHtml,
  type TrackingContext,
} from "./email-tracking.js";
import { getStoredUpload } from "./upload-store.js";

const UPLOADS_DIR = path.resolve("data/uploads");

export type ResolvedComposeAttachment = ComposeAttachment & {
  data: Buffer;
};

function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function safeHeaderParam(value: string): string {
  return stripCrlf(value).replace(/["\\]/g, "_") || "attachment";
}

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
  const normalized = decodeCommonHtmlEntities(
    normalizeMarkdownHardBreaks(markdown),
  ).trim();
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
  return decodeCommonHtmlEntities(normalizeMarkdownHardBreaks(markdown))
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

function quotedContentToHtml(attribution: string, quotedBody: string): string {
  const stripped = quotedBody
    .split("\n")
    .map((line) => {
      if (line.startsWith("> ")) return line.slice(2);
      if (line === ">") return "";
      return line;
    })
    .join("\n");
  const innerHtml = markdownToHtml(stripped);
  return (
    `<div class="gmail_quote" style="margin-top:2.5em">` +
    `<div class="gmail_attr">${escapeHtml(attribution)}</div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
    innerHtml +
    `</blockquote></div>`
  );
}

export function bodyToHtml(body: string, tracking?: TrackingContext): string {
  const split = splitReplyQuote(body);
  if (split) {
    const newHtml = markdownToHtml(split.newContent);
    const injected = tracking
      ? injectTrackingIntoHtml(newHtml, tracking)
      : newHtml;
    const quoteHtml = quotedContentToHtml(split.attribution, split.quotedBody);
    return injected + quoteHtml;
  }
  const html = markdownToHtml(body);
  return tracking ? injectTrackingIntoHtml(html, tracking) : html;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

export async function resolveComposeAttachments(
  attachments: unknown,
  ownerEmail?: string,
): Promise<ResolvedComposeAttachment[]> {
  if (!Array.isArray(attachments)) return [];

  const resolved: ResolvedComposeAttachment[] = [];
  for (const raw of attachments) {
    const att = raw as Partial<ComposeAttachment>;
    if (!att.filename || typeof att.filename !== "string") continue;
    if (att.filename.includes("/") || att.filename.includes("..")) continue;

    const filePath = path.join(UPLOADS_DIR, att.filename);
    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch (error) {
      if (!ownerEmail) throw error;
      const stored = await getStoredUpload(ownerEmail, att.filename);
      if (!stored) throw error;
      data = Buffer.from(stored.dataBase64, "base64");
      att.originalName = att.originalName || stored.originalName;
      att.mimeType = att.mimeType || stored.mimeType;
      att.size = att.size || stored.size;
      att.url = att.url || stored.url || `/api/media/${stored.filename}`;
    }
    resolved.push({
      id: att.id || att.filename,
      filename: att.filename,
      originalName: att.originalName || att.filename,
      mimeType: att.mimeType || "application/octet-stream",
      size: att.size || data.length,
      url: att.url || `/api/media/${att.filename}`,
      data,
    });
  }
  return resolved;
}

export function buildRawEmail(opts: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  tracking?: TrackingContext;
  attachments?: ResolvedComposeAttachment[];
}): string {
  const safeFrom = stripCrlf(opts.from);
  const safeTo = stripCrlf(opts.to);
  const safeCc = opts.cc ? stripCrlf(opts.cc) : "";
  const safeBcc = opts.bcc ? stripCrlf(opts.bcc) : "";
  const safeSubject = stripCrlf(opts.subject);
  const safeInReplyTo = opts.inReplyTo ? stripCrlf(opts.inReplyTo) : "";
  const safeReferences = opts.references ? stripCrlf(opts.references) : "";

  const altBoundary = `agent-native-alt-${nanoid(12)}`;
  const textBody = markdownToPlainText(opts.body);
  const htmlBody = bodyToHtml(opts.body, opts.tracking);
  const alternativePart = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    textBody,
    "",
    `--${altBoundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    "",
    htmlBody,
    "",
    `--${altBoundary}--`,
  ];

  const headers = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    ...(safeCc ? [`Cc: ${safeCc}`] : []),
    ...(safeBcc ? [`Bcc: ${safeBcc}`] : []),
    `Subject: ${safeSubject}`,
    ...(safeInReplyTo ? [`In-Reply-To: ${safeInReplyTo}`] : []),
    ...(safeReferences ? [`References: ${safeReferences}`] : []),
    `MIME-Version: 1.0`,
  ];

  const attachments = opts.attachments ?? [];
  const lines =
    attachments.length === 0
      ? [...headers, ...alternativePart]
      : (() => {
          const mixedBoundary = `agent-native-mixed-${nanoid(12)}`;
          const mixed = [
            ...headers,
            `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
            "",
            `--${mixedBoundary}`,
            ...alternativePart,
          ];
          for (const att of attachments) {
            const filename = safeHeaderParam(att.originalName || att.filename);
            mixed.push(
              "",
              `--${mixedBoundary}`,
              `Content-Type: ${stripCrlf(att.mimeType)}; name="${filename}"`,
              `Content-Disposition: attachment; filename="${filename}"`,
              `Content-Transfer-Encoding: base64`,
              "",
              wrapBase64(att.data.toString("base64")),
            );
          }
          mixed.push("", `--${mixedBoundary}--`);
          return mixed;
        })();

  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
