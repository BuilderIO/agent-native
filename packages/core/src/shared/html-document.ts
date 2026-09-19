type HtmlInjectionTarget = "head" | "body";
const RAW_TEXT_TAG_NAMES = new Set(["script", "style", "textarea", "title"]);

function tagEndIndex(html: string, start: number): number {
  let quote: '"' | "'" | null = null;

  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }

  return -1;
}

function tagNameAt(html: string, start: number): string | null {
  const match = /^[A-Za-z][\w:-]*/.exec(html.slice(start));
  return match?.[0]?.toLowerCase() ?? null;
}

function rawTextCloseIndex(html: string, tag: string, start: number): number {
  const pattern = new RegExp(`<\\/${tag}\\s*>`, "gi");
  pattern.lastIndex = start;
  return pattern.exec(html)?.index ?? -1;
}

function closingTagIndex(
  html: string,
  tag: HtmlInjectionTarget | "html",
  last: boolean,
): number {
  let index = -1;
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) break;

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const closing = html[tagStart + 1] === "/";
    const nameStart = tagStart + (closing ? 2 : 1);
    const tagName = tagNameAt(html, nameStart);
    if (!tagName) {
      cursor = tagStart + 1;
      continue;
    }

    const tagEnd = tagEndIndex(html, nameStart + tagName.length);
    if (tagEnd === -1) break;

    if (
      closing &&
      tagName === tag &&
      !/\S/.test(html.slice(nameStart + tagName.length, tagEnd))
    ) {
      index = tagStart;
      if (!last) return index;
    }

    if (!closing && RAW_TEXT_TAG_NAMES.has(tagName)) {
      const rawTextEnd = rawTextCloseIndex(html, tagName, tagEnd + 1);
      cursor =
        rawTextEnd === -1 ? html.length : rawTextEnd + tagName.length + 3;
      continue;
    }

    cursor = tagEnd + 1;
  }

  return index;
}

/**
 * Inserts markup at a document boundary without using String.replace's
 * replacement-string semantics. It ignores raw text, attributes, and comments
 * when locating a real closing tag. Body and html closers use their last
 * marker so literal close tags cannot capture the injection.
 */
export function injectDocumentMarkup(
  html: string,
  markup: string,
  options: { target?: HtmlInjectionTarget } = {},
): string {
  if (!markup) return html;

  const target = options.target ?? "body";
  const targetIndex = closingTagIndex(html, target, target === "body");
  if (targetIndex !== -1) {
    return html.slice(0, targetIndex) + markup + html.slice(targetIndex);
  }

  const bodyIndex = closingTagIndex(html, "body", true);
  if (bodyIndex !== -1) {
    return html.slice(0, bodyIndex) + markup + html.slice(bodyIndex);
  }

  const htmlIndex = closingTagIndex(html, "html", true);
  if (htmlIndex !== -1) {
    return html.slice(0, htmlIndex) + markup + html.slice(htmlIndex);
  }

  return html + markup;
}
