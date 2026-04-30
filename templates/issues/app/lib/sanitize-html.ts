const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "p",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "code",
  "span",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "img",
  "sub",
  "sup",
]);

const ALLOWED_ATTRS = new Set([
  "href",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "class",
  "id",
  "colspan",
  "rowspan",
]);

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return false;
  return /^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(trimmed);
}

/** Sanitize HTML using an allowlist of safe tags and attributes. */
export function sanitizeHtml(html: string): string {
  let result = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  result = result.replace(
    /<\/?([a-z][a-z0-9]*)\b([^>]*)?\/?>/gi,
    (match, tag, attrs) => {
      const tagLower = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(tagLower)) return "";
      if (match.startsWith("</")) return `</${tagLower}>`;

      const safeAttrs: string[] = [];
      if (attrs) {
        const attrRegex =
          /([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
          const attrName = attrMatch[1].toLowerCase();
          const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
          if (!ALLOWED_ATTRS.has(attrName)) continue;
          if (
            (attrName === "href" || attrName === "src") &&
            !isSafeUrl(attrValue)
          )
            continue;
          safeAttrs.push(`${attrName}="${attrValue.replace(/"/g, "&quot;")}"`);
        }
      }

      const selfClosing =
        match.endsWith("/>") ||
        tagLower === "br" ||
        tagLower === "hr" ||
        tagLower === "img";
      const attrStr = safeAttrs.length > 0 ? " " + safeAttrs.join(" ") : "";
      return selfClosing
        ? `<${tagLower}${attrStr} />`
        : `<${tagLower}${attrStr}>`;
    },
  );

  return result;
}
