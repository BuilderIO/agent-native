import fs from "node:fs/promises";
import path from "node:path";

import {
  decodeCommonHtmlEntities,
  escapeHtml,
  normalizeMarkdownHardBreaks,
} from "@shared/markdown.js";
import type { ComposeAttachment } from "@shared/types.js";
import { marked, type Tokens, Renderer } from "marked";
import { nanoid } from "nanoid";

import {
  injectTrackingIntoHtml,
  type TrackingContext,
} from "./email-tracking.js";
import { getStoredUpload } from "./upload-store.js";

const UPLOADS_DIR = path.resolve("data/uploads");

export type ResolvedComposeAttachment = ComposeAttachment & {
  data: Buffer;
};

type ResolveComposeAttachmentOptions = {
  readGmailAttachment?: (
    attachment: ComposeAttachment,
  ) => Promise<Buffer | null>;
};

function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function safeHeaderParam(value: string): string {
  return stripCrlf(value).replace(/["\\]/g, "_") || "attachment";
}

// RFC 2047 base64-encode a header value when it contains non-ASCII. Without
// this, characters like the em-dash "—" arrive as mojibake (e.g. "Ã¢Â€Â\"")
// because intermediate MTAs interpret raw UTF-8 bytes in headers as Latin-1.
export function encodeMimeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

// RFC 2047 encode the display-name part of an address-list header
// (To/From/Cc/Bcc). The bare email itself is always ASCII-safe, so we leave it
// alone and only encode the name when needed.
export function encodeAddressHeader(value: string): string {
  return value
    .split(",")
    .map((part) => encodeSingleAddress(part.trim()))
    .filter(Boolean)
    .join(", ");
}

function encodeSingleAddress(addr: string): string {
  if (!addr) return "";
  const m = addr.match(/^("?)([^<"]*?)\1\s*<([^>]+)>$/);
  if (m) {
    const name = m[2].trim();
    const email = m[3].trim();
    if (!name) return `<${email}>`;
    return `${encodeMimeHeaderValue(name)} <${email}>`;
  }
  return encodeMimeHeaderValue(addr);
}

// Build a marked Renderer that keeps links safe for email clients (absolute
// hrefs only, target=_blank + rel=noopener, no javascript:).
function buildEmailRenderer(): Renderer {
  const renderer = new Renderer();

  renderer.link = ({ href, title, tokens }: Tokens.Link) => {
    const safeHref = href && /^https?:\/\//i.test(href) ? href : (href ?? "#");
    // Use the parser to render the inline tokens when available; fall back to
    // extracting raw text so the label is never empty.
    const label = (renderer as any).parser
      ? (renderer as any).parser.parseInline(tokens)
      : tokens.map((t: any) => t.text ?? "").join("") || safeHref;
    const titleAttr = title ? ` title="${title}"` : "";
    return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${label}</a>`;
  };

  renderer.image = ({ href, title, text }: Tokens.Image) => {
    const safeHref = href && /^https?:\/\//i.test(href) ? href : (href ?? "");
    const titleAttr = title ? ` title="${title}"` : "";
    return `<img src="${safeHref}" alt="${text}"${titleAttr} style="max-width:100%;height:auto;" />`;
  };

  return renderer;
}

function markdownToHtml(markdown: string): string {
  const normalized = decodeCommonHtmlEntities(
    normalizeMarkdownHardBreaks(markdown),
  ).trim();
  if (!normalized) return "<div></div>";

  const html = marked.parse(normalized, {
    renderer: buildEmailRenderer(),
    async: false,
    gfm: true,
    breaks: false,
  }) as string;

  return `<div>${html}</div>`;
}

function markdownToPlainText(markdown: string): string {
  return decodeCommonHtmlEntities(normalizeMarkdownHardBreaks(markdown))
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1$2")
    .trim();
}

export function splitReplyQuote(body: string): {
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
  options?: ResolveComposeAttachmentOptions,
): Promise<ResolvedComposeAttachment[]> {
  if (!Array.isArray(attachments)) return [];

  const resolved: ResolvedComposeAttachment[] = [];
  for (const raw of attachments) {
    const att = raw as Partial<ComposeAttachment>;
    // Every other failure branch below throws and is surfaced to the user as
    // "One or more attachments could not be read" by the send/save callers.
    // A malformed entry must fail the same way instead of being silently
    // dropped; otherwise the user believes the file was attached when the
    // sent email has fewer attachments than they added.
    if (!att.filename || typeof att.filename !== "string") {
      throw new Error("Attachment is missing a filename and could not be read");
    }
    if (att.filename.includes("/") || att.filename.includes("..")) {
      throw new Error(`Attachment filename is invalid: ${att.filename}`);
    }

    if (att.source === "gmail" || att.gmailMessageId || att.gmailAttachmentId) {
      if (
        !att.gmailMessageId ||
        !att.gmailAttachmentId ||
        !options?.readGmailAttachment
      ) {
        throw new Error("Gmail attachment cannot be resolved");
      }
      const data = await options.readGmailAttachment(att as ComposeAttachment);
      if (!data) throw new Error("Gmail attachment could not be read");
      resolved.push({
        id: att.id || att.gmailAttachmentId,
        filename: att.filename,
        originalName: att.originalName || att.filename,
        mimeType: att.mimeType || "application/octet-stream",
        size: att.size || data.length,
        url: att.url || "",
        source: "gmail",
        gmailMessageId: att.gmailMessageId,
        gmailAttachmentId: att.gmailAttachmentId,
        accountEmail: att.accountEmail,
        data,
      });
      continue;
    }

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
    `From: ${encodeAddressHeader(safeFrom)}`,
    `To: ${encodeAddressHeader(safeTo)}`,
    ...(safeCc ? [`Cc: ${encodeAddressHeader(safeCc)}`] : []),
    ...(safeBcc ? [`Bcc: ${encodeAddressHeader(safeBcc)}`] : []),
    `Subject: ${encodeMimeHeaderValue(safeSubject)}`,
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
