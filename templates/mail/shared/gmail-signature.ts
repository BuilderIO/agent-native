import { decodeCommonHtmlEntities } from "./markdown";

function attr(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return decodeCommonHtmlEntities(
    match?.[2] ?? match?.[3] ?? match?.[4] ?? "",
  ).trim();
}

function safeUrl(value: string | null, allowMailto = false): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    if (allowMailto && parsed.protocol === "mailto:") return parsed.toString();
  } catch {
    // fallthrough
  }
  return null;
}

function normalizeMarkdownUrl(value: string): string {
  return value.replace(/\)/g, "%29");
}

function cleanMarkdown(value: string): string {
  return decodeCommonHtmlEntities(value)
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").trimStart())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlSignatureToMarkdown(html: string): string {
  let next = html
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  next = next.replace(/<br\s*\/?>/gi, "\n");
  next = next.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = safeUrl(attr(tag, "src"));
    if (!src) return "";
    const alt = attr(tag, "alt") ?? "";
    return `![${alt.replace(/]/g, "\\]")}](${normalizeMarkdownUrl(src)})`;
  });
  next = next.replace(
    /<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>([\s\S]*?)<\/a>/gi,
    (match, label) => {
      const href = safeUrl(attr(match, "href"), true);
      if (!href) return label;
      const text = cleanMarkdown(label.replace(/<[^>]+>/g, ""));
      if (!text) return href;
      return `[${text.replace(/]/g, "\\]")}](${normalizeMarkdownUrl(href)})`;
    },
  );
  next = next
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<\/(div|p|li|tr|table|section|article|blockquote|h[1-6])>/gi, "\n")
    .replace(/<(div|p|li|tr|table|section|article|blockquote|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return cleanMarkdown(next);
}
