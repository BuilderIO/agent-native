export type HtmlToken =
  | {
      type: "open";
      name: string;
      attrs: Record<string, string>;
      selfClosing: boolean;
    }
  | { type: "close"; name: string }
  /** Comments, doctype, CDATA, and processing instructions: never rendered. */
  | { type: "hidden"; raw: string }
  | { type: "text"; text: string };

/** Elements whose contents a reader never sees on the rendered page. */
export const HIDDEN_HTML_ELEMENTS = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "head",
  "title",
]);

/**
 * Where script and style bodies end. Matched case-insensitively in place:
 * lowercasing first can lengthen the text (`İ` becomes two characters) and
 * shift every offset after it.
 */
const RAW_TEXT_CLOSE = new Map([
  ["script", /<\/script/gi],
  ["style", /<\/style/gi],
]);

const TOKEN_RE =
  /<!--[\s\S]*?(?:-->|$)|<![\s\S]*?(?:>|$)|<\?[\s\S]*?(?:\?>|$)|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR_RE =
  /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  times: "×",
  divide: "÷",
  deg: "°",
  plusmn: "±",
  para: "¶",
  sect: "§",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  check: "✓",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

export function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const pattern = new RegExp(TOKEN_RE);
  let last = 0;
  for (;;) {
    const match = pattern.exec(html);
    if (!match) break;
    if (match.index > last) {
      tokens.push({
        type: "text",
        text: decodeHtmlEntities(html.slice(last, match.index)),
      });
    }
    last = pattern.lastIndex;
    if (match[1]) {
      tokens.push({ type: "close", name: match[1].toLowerCase() });
    } else if (match[2]) {
      const name = match[2].toLowerCase();
      const selfClosing = match[4] === "/";
      tokens.push({
        type: "open",
        name,
        attrs: parseAttributes(match[3] ?? ""),
        selfClosing,
      });
      // Script and style bodies are raw text: a `<` or `<!--` inside them
      // opens nothing, so the body runs to the element's own closing tag.
      const rawTextClose = selfClosing ? undefined : RAW_TEXT_CLOSE.get(name);
      if (rawTextClose) {
        rawTextClose.lastIndex = last;
        const close = rawTextClose.exec(html);
        const end = close ? close.index : html.length;
        if (end > last)
          tokens.push({ type: "text", text: html.slice(last, end) });
        last = end;
        pattern.lastIndex = end;
      }
    } else {
      tokens.push({ type: "hidden", raw: match[0] });
    }
  }
  if (last < html.length) {
    tokens.push({ type: "text", text: decodeHtmlEntities(html.slice(last)) });
  }
  return tokens;
}

/** The text a reader sees when the fragment renders. */
export function htmlVisibleText(html: string): string {
  const parts: string[] = [];
  // A hidden element ends at its own closing tag; tags inside it don't count.
  let hidden: string | null = null;
  for (const token of tokenizeHtml(html)) {
    if (hidden) {
      if (token.type === "close" && token.name === hidden) hidden = null;
    } else if (token.type === "open" && HIDDEN_HTML_ELEMENTS.has(token.name)) {
      if (!token.selfClosing) hidden = token.name;
    } else if (token.type === "text") {
      parts.push(token.text);
    } else if (token.type === "open" && token.name === "img") {
      if (token.attrs.alt) parts.push(` ${token.attrs.alt} `);
    } else if (token.type === "open" || token.type === "close") {
      parts.push(" ");
    }
  }
  return parts.join("");
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTR_RE)) {
    const name = match[1].toLowerCase();
    attrs[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}
