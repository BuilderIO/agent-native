export { cn } from "@agent-native/core/client";
import {
  decodeCommonHtmlEntities,
  escapeHtml,
  normalizeMarkdownHardBreaks,
  renderInlineMarkdown,
} from "@shared/markdown";
import { format, isToday, isYesterday, isThisYear } from "date-fns";

export function formatEmailDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  if (isThisYear(date)) return format(date, "MMM d");
  return format(date, "MMM d, yyyy");
}

export function formatEmailDateFull(dateStr: string): string {
  return format(new Date(dateStr), "EEE, MMM d, yyyy 'at' h:mm a");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500",
    "bg-sky-500",
    "bg-green-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-teal-500",
    "bg-indigo-500",
    "bg-rose-500",
    "bg-amber-500",
    "bg-cyan-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function markdownToHtml(markdown: string): string {
  const normalized = decodeCommonHtmlEntities(
    markdown.replace(/\r\n/g, "\n"),
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
        return `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`;
      }

      if (/^(-|\*|\+)\s+/m.test(block)) {
        const items = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^(-|\*|\+)\s+/, ""))
          .map((line) => `<li>${renderInlineMarkdown(line)}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      if (/^\d+\.\s+/m.test(block)) {
        const items = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^\d+\.\s+/, ""))
          .map((line) => `<li>${renderInlineMarkdown(line)}</li>`)
          .join("");
        return `<ol>${items}</ol>`;
      }

      const cleanBlock = normalizeMarkdownHardBreaks(block);
      return `<p>${renderInlineMarkdown(cleanBlock).replace(/\n/g, "<br />")}</p>`;
    })
    .join("");

  return `<div>${html}</div>`;
}

/**
 * Split a compose body at the reply/forward quote separator.
 * Returns null for non-reply bodies (no separator found).
 * Mirrors `splitReplyQuote` in server/handlers/emails.ts.
 */
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

/**
 * Convert quoted content into Gmail-compatible HTML blockquote.
 * Strips leading `> ` prefixes from each line before converting to HTML.
 * Mirrors `quotedContentToHtml` in server/handlers/emails.ts.
 */
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

/**
 * Convert a compose body to HTML, properly formatting reply/forward quotes
 * with Gmail-compatible blockquote structure. Mirrors `bodyToHtml` in
 * server/handlers/emails.ts so the optimistic reply preview renders
 * identically to the real sent message.
 */
export function bodyToHtml(body: string): string {
  const split = splitReplyQuote(body);
  if (split) {
    const newHtml = markdownToHtml(split.newContent);
    const quoteHtml = quotedContentToHtml(split.attribution, split.quotedBody);
    return newHtml + quoteHtml;
  }
  return markdownToHtml(body);
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

export function isMac(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0
  );
}

export function formatShortcut(key: string): string {
  const isMacPlatform = isMac();
  const mod = isMacPlatform ? "⌘" : "Ctrl";
  return key
    .split("+")
    .map((part) => {
      const token = part.trim();
      const lower = token.toLowerCase();
      if (lower === "cmd" || lower === "meta") return mod;
      if (lower === "ctrl" || lower === "control") return "Ctrl";
      if (lower === "alt" || lower === "option")
        return isMacPlatform ? "⌥" : "Alt";
      if (lower === "shift") return isMacPlatform ? "⇧" : "Shift";
      if (lower === "enter") return "Enter";
      if (lower === "space") return "Space";
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join("+");
}
