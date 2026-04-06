/**
 * Sanitize HTML using an allowlist approach.
 * Only permits known-safe tags and attributes, stripping everything else.
 */
export function sanitizeHtml(html: string): string {
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
  const SAFE_URL_PATTERN = /^(?:https?:\/\/|mailto:|tel:|\/|#)/i;

  // Strip script/style tags and their contents first
  let result = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // Process remaining tags
  result = result.replace(
    /<\/?([a-z][a-z0-9]*)\b([^>]*)?\/?>/gi,
    (match, tag, attrs) => {
      const tagLower = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(tagLower)) return "";

      // Closing tag
      if (match.startsWith("</")) return `</${tagLower}>`;

      // Filter attributes
      const safeAttrs: string[] = [];
      if (attrs) {
        const attrRegex =
          /([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
          const attrName = attrMatch[1].toLowerCase();
          const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
          if (!ALLOWED_ATTRS.has(attrName)) continue;
          // Validate URL attributes
          if (
            (attrName === "href" || attrName === "src") &&
            !SAFE_URL_PATTERN.test(attrValue)
          )
            continue;
          safeAttrs.push(`${attrName}="${attrValue.replace(/"/g, "&quot;")}"`);
        }
      }

      // Force all links to open in a new tab
      if (tagLower === "a") {
        safeAttrs.push('target="_blank"');
        safeAttrs.push('rel="noopener noreferrer"');
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

/**
 * Strip Google Calendar invitation boilerplate from event descriptions.
 * GCal embeds the full invitation HTML (guest list, RSVP buttons, "More options",
 * meeting details, "Invitation from Google Calendar" footer) into the description.
 * We render all of that natively, so strip it out to avoid ugly duplication.
 */
export function stripGcalInviteHtml(html: string): string {
  let cleaned = html;

  // Remove "Reply for <email>" section with Yes/No/Maybe buttons
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?Reply\s+for[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove standalone Yes/No/Maybe buttons (various Google formats)
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?(?:>Yes<|>No<|>Maybe<)[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove "More options" link/button
  cleaned = cleaned.replace(/<a[^>]*>[\s]*More\s+options[\s]*<\/a>/gi, "");
  cleaned = cleaned.replace(
    /<(table|div)[^>]*>[\s\S]*?More\s+options[\s\S]*?<\/(table|div)>/gi,
    "",
  );

  // Remove "Invitation from Google Calendar" footer
  cleaned = cleaned.replace(
    /Invitation\s+from\s+<a[^>]*>Google\s+Calendar<\/a>/gi,
    "",
  );
  cleaned = cleaned.replace(/Invitation\s+from\s+Google\s+Calendar/gi, "");

  // Remove "You are receiving this email" disclaimer
  cleaned = cleaned.replace(/You\s+are\s+receiving\s+this[\s\S]*?$/gi, "");

  // Remove "View all guest info" links
  cleaned = cleaned.replace(
    /<a[^>]*>[\s]*View\s+all\s+guest\s+info[\s]*<\/a>/gi,
    "",
  );

  // Remove the "When" / "Guests" sections that duplicate our native UI
  cleaned = cleaned.replace(
    /<b>When<\/b>[\s\S]*?(?=<b>|<hr|<br\s*\/?>[\s]*<br\s*\/?>|$)/gi,
    "",
  );

  // Remove "Join Zoom Meeting" / "Join by phone" blocks that duplicate our meeting link
  cleaned = cleaned.replace(
    /<b>Join\s+Zoom\s+Meeting<\/b>[\s\S]*?(?=<b>Joining\s+notes|<hr|<br\s*\/?>[\s]*<br\s*\/?>[\s]*<br|$)/gi,
    "",
  );
  cleaned = cleaned.replace(
    /<b>Join\s+by\s+phone<\/b>[\s\S]*?(?=<b>|<hr|$)/gi,
    "",
  );

  // Remove "Joining instructions" links
  cleaned = cleaned.replace(
    /<a[^>]*>[\s]*Joining\s+instructions[\s]*<\/a>/gi,
    "",
  );

  // Clean up leftover separators and whitespace
  cleaned = cleaned.replace(/(<hr\s*\/?>[\s]*){2,}/gi, "<hr/>");
  cleaned = cleaned.replace(/(<br\s*\/?>[\s]*){4,}/gi, "<br/><br/>");
  cleaned = cleaned.replace(/([-─]{5,}[\s]*){2,}/g, "");

  // Trim leading/trailing whitespace and empty elements
  cleaned = cleaned.replace(/^[\s<br\/>]*(<hr\s*\/?>)?[\s<br\/>]*/i, "");
  cleaned = cleaned.replace(/[\s<br\/>]*(<hr\s*\/?>)?[\s<br\/>]*$/i, "");

  return cleaned.trim();
}

/** Check if a string looks like HTML */
export function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}
