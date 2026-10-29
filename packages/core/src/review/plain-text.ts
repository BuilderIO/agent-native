/**
 * Comment bodies are Markdown. Emails, webhooks and other text-only readers
 * want what a person sees instead: these helpers drop the markers and keep the
 * words, matching what the toolkit's comment renderer shows.
 *
 * Every pattern stops at the next delimiter of its kind, so a long comment
 * full of unclosed markers still takes linear time.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ESCAPED = /\\([!-/:-@[-`{-~])/g;

/**
 * A comment as plain text. Emphasis, heading, quote and code markers go;
 * links and images keep their text; `@[Name](mailto:…)` mentions read
 * `@Name`; raw HTML tags are dropped, as the renderer skips them. Line breaks,
 * list markers and the lines of a code block stay, so a list still reads as
 * one.
 */
export function commentPlainText(markdown: string): string {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const opener = FENCE.exec(line);
    if (fence) {
      const closes =
        opener &&
        opener[1]![0] === fence[0] &&
        opener[1]!.length >= fence.length &&
        !line.slice(opener[0].length).trim();
      if (closes) fence = null;
      else lines.push(line);
      continue;
    }
    // A backtick fence's info string can't hold a backtick; one that does is
    // inline code, not a fence.
    if (
      opener &&
      !(opener[1]![0] === "`" && line.slice(opener[0].length).includes("`"))
    ) {
      fence = opener[1]!;
      continue;
    }
    lines.push(plainLine(line));
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A comment on one line, cut to `limit` characters with an ellipsis, for an
 * email or notification that quotes it.
 */
export function commentExcerpt(markdown: string, limit = 240): string {
  const collapsed = commentPlainText(markdown).replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  let cut = limit - 1;
  // Don't leave half of a character outside the Basic Multilingual Plane.
  const last = collapsed.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${collapsed.slice(0, cut).trimEnd()}…`;
}

function plainLine(line: string): string {
  if (/^ {0,3}([-*_])(?: *\1){2,} *$/.test(line)) return "";
  const text = line
    .replace(/^(?: {0,3}> ?)+/, "")
    .replace(/^ {0,3}#{1,6}(?:\s+|$)/, "")
    .replace(/\s+#+\s*$/, "");
  let plain = "";
  let cursor = 0;
  for (const span of codeSpans(text)) {
    plain += plainInline(text.slice(cursor, span.start));
    const code = text.slice(span.start + span.ticks, span.end - span.ticks);
    plain += /^ .*[^ ].* $/.test(code) ? code.slice(1, -1) : code;
    cursor = span.end;
  }
  return plain + plainInline(text.slice(cursor));
}

/**
 * Inline code runs from a run of backticks to the next run of the same
 * length. The runs are collected in one pass and each is paired once.
 */
function codeSpans(
  text: string,
): { start: number; end: number; ticks: number }[] {
  const runs = Array.from(text.matchAll(/`+/g), (match) => ({
    at: match.index,
    length: match[0].length,
  }));
  const nextSameLength = new Array<number>(runs.length);
  const laterByLength = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const { length } = runs[index]!;
    nextSameLength[index] = laterByLength.get(length) ?? -1;
    laterByLength.set(length, index);
  }
  const spans: { start: number; end: number; ticks: number }[] = [];
  for (let index = 0; index < runs.length; index += 1) {
    const close = nextSameLength[index]!;
    if (close === -1) continue;
    const open = runs[index]!;
    const closing = runs[close]!;
    spans.push({
      start: open.at,
      end: closing.at + closing.length,
      ticks: open.length,
    });
    index = close;
  }
  return spans;
}

function plainInline(text: string): string {
  const escaped: string[] = [];
  return (
    text
      .replace(ESCAPED, (_, char: string) => {
        escaped.push(char);
        return `\uE000${escaped.length - 1}\uE001`;
      })
      .replace(/@\[([^[\]]+)\]\(mailto:[^()]*\)/g, "@$1")
      .replace(/!\[([^[\]]*)\]\([^()]*\)/g, "$1")
      .replace(/\[([^[\]]+)\]\([^()]*\)/g, "$1")
      .replace(/<((?:https?|mailto):[^\s<>]+)>/gi, "$1")
      .replace(/<\/?[a-z][^<>]*>/gi, "")
      .replace(/(\*\*|__)(?!\s)((?:(?!\1)[\s\S])*?\S)\1/g, "$2")
      .replace(/~~(?!\s)((?:(?!~~)[\s\S])*?\S)~~/g, "$1")
      .replace(/\*([^\s*](?:[^*]*?[^\s*])?)\*/g, "$1")
      // Unlike `*`, `_` doesn't emphasize inside a word, so snake_case stays.
      .replace(
        /(^|[^\p{L}\p{N}_])_([^\s_](?:[^_]*?[^\s_])?)_(?![\p{L}\p{N}_])/gu,
        "$1$2",
      )
      .replace(/\uE000(\d+)\uE001/g, (_, index: string) => escaped[+index]!)
  );
}
