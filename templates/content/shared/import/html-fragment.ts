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

const TOKEN_RE =
  /<!--[\s\S]*?(?:-->|$)|<![\s\S]*?(?:>|$)|<\?[\s\S]*?(?:\?>|$)|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
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
  let last = 0;
  for (const match of html.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) {
      tokens.push({
        type: "text",
        text: decodeHtmlEntities(html.slice(last, index)),
      });
    }
    last = index + match[0].length;
    if (match[1]) {
      tokens.push({ type: "close", name: match[1].toLowerCase() });
    } else if (match[2]) {
      tokens.push({
        type: "open",
        name: match[2].toLowerCase(),
        attrs: parseAttributes(match[3] ?? ""),
        selfClosing: match[4] === "/",
      });
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
  let hiddenDepth = 0;
  for (const token of tokenizeHtml(html)) {
    if (token.type === "open" && HIDDEN_HTML_ELEMENTS.has(token.name)) {
      if (!token.selfClosing) hiddenDepth += 1;
    } else if (token.type === "close" && HIDDEN_HTML_ELEMENTS.has(token.name)) {
      hiddenDepth = Math.max(0, hiddenDepth - 1);
    } else if (token.type === "text" && hiddenDepth === 0) {
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
