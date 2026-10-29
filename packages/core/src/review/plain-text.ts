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
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const QUOTE = /^(?: {0,3}> ?)+/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
/**
 * An HTML open or closing tag as CommonMark reads one. Text that only looks
 * like a tag, such as `x<y+1 and y>2`, stays: the renderer shows it too. No
 * part can cross a `<` or `>`, so each scan stops at the next one.
 */
const HTML_TAG =
  /<(?:[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^'<>]*'|"[^"<>]*"))?)*\s*\/?|\/[A-Za-z][A-Za-z0-9-]*\s*)>/g;

/**
 * A comment as plain text. Emphasis, heading, quote and code markers go;
 * links and images keep their text; `@[Name](mailto:…)` mentions read
 * `@Name`; raw HTML tags are dropped, as the renderer skips them. Line breaks,
 * list markers and the lines of a code block stay, so a list still reads as
 * one.
 */
export function commentPlainText(markdown: string): string {
  const lines: string[] = [];
  // A paragraph's lines are read together, since code and emphasis can cross
  // a line break inside one, but not into the next paragraph or list item.
  let paragraph: string[] = [];
  let paragraphDepth = 0;
  const endParagraph = () => {
    if (paragraph.length) lines.push(plainInline(paragraph.join("\n")));
    paragraph = [];
  };
  // A fence inside a quote ends with the quote, and its lines lose the
  // quote's markers and the fence's indent.
  let fence: { marker: string; depth: number; indent: number } | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const quote = QUOTE.exec(line)?.[0] ?? "";
    const depth = quote.split(">").length - 1;
    if (fence) {
      if (depth >= fence.depth) {
        const code = withoutIndent(
          withoutQuotes(line, fence.depth),
          fence.indent,
        );
        const closer = FENCE.exec(code);
        const marker = closer?.[1] ?? "";
        const closes =
          marker.charAt(0) === fence.marker.charAt(0) &&
          marker.length >= fence.marker.length &&
          !code.slice(closer?.[0].length ?? 0).trim();
        if (closes) fence = null;
        else lines.push(code);
        continue;
      }
      fence = null;
    }
    const text = line.slice(quote.length);
    // A fence can open a list item, after its marker.
    const item = LIST_ITEM.exec(text);
    const fenceText = item ? text.slice(item[0].length) : text;
    const opener = FENCE.exec(fenceText);
    const marker = opener?.[1] ?? "";
    const info = fenceText.slice(opener?.[0].length ?? 0);
    // A backtick fence's info string can't hold a backtick; one that does is
    // inline code, not a fence.
    if (marker && !(marker.startsWith("`") && info.includes("`"))) {
      endParagraph();
      const indent =
        (item?.[0].length ?? 0) + (opener?.[0].length ?? 0) - marker.length;
      fence = { marker, depth, indent };
      continue;
    }
    const heading = HEADING.exec(text);
    // A line of `=` or `-` under a paragraph underlines it as a heading.
    const underline = paragraph.length > 0 && SETEXT_UNDERLINE.test(text);
    if (!text.trim() || THEMATIC_BREAK.test(text) || underline || heading) {
      endParagraph();
      lines.push(
        heading
          ? plainInline(withoutClosingHashes(text.slice(heading[0].length)))
          : "",
      );
      continue;
    }
    if (depth !== paragraphDepth || LIST_ITEM.test(text)) endParagraph();
    paragraphDepth = depth;
    paragraph.push(text);
  }
  endParagraph();
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

/**
 * Inline text, which may hold line breaks. Code spans and escaped characters
 * are set aside first, so the markers around them still pair and nothing
 * inside them is read as Markdown.
 */
function plainInline(text: string): string {
  const { open, close } = placeholderMarks(text);
  const kept: string[] = [];
  const keep = (value: string) => `${open}${kept.push(value) - 1}${close}`;
  let prose = "";
  let cursor = 0;
  for (const span of codeSpans(text)) {
    prose += text.slice(cursor, span.start);
    // A line break inside code reads as a space, as CommonMark has it.
    const code = text
      .slice(span.start + span.ticks, span.end - span.ticks)
      .replaceAll("\n", " ");
    // One space comes off each side when both sides have one and the code
    // isn't all spaces, as CommonMark reads `` ` a ` ``.
    const padded =
      code.length > 2 &&
      code.startsWith(" ") &&
      code.endsWith(" ") &&
      /[^ ]/.test(code);
    prose += keep(padded ? code.slice(1, -1) : code);
    cursor = span.end;
  }
  prose += text.slice(cursor);
  return plainProse(
    prose.replace(ESCAPED, (_, char: string) => keep(char)),
  ).replace(
    new RegExp(`${open}(\\d+)${close}`, "g"),
    (_, index: string) => kept[+index] ?? "",
  );
}

/**
 * Two private-use characters the text doesn't contain, to mark what
 * `plainInline` sets aside without matching anything the author wrote.
 */
function placeholderMarks(text: string): { open: string; close: string } {
  const used = new Set(
    Array.from(text.matchAll(/[\uE000-\uF8FF]/g), (match) => match[0]),
  );
  const unused = (from: number) => {
    let code = from;
    while (used.has(String.fromCharCode(code))) code += 1;
    return code;
  };
  const open = unused(0xe000);
  return {
    open: String.fromCharCode(open),
    close: String.fromCharCode(unused(open + 1)),
  };
}

/** Removes up to `indent` leading spaces from a line. */
function withoutIndent(line: string, indent: number): string {
  let start = 0;
  while (start < indent && line[start] === " ") start += 1;
  return line.slice(start);
}

/** Removes the first `depth` quote markers from a line. */
function withoutQuotes(line: string, depth: number): string {
  let text = line;
  for (let level = 0; level < depth; level += 1) {
    text = text.replace(/^ {0,3}> ?/, "");
  }
  return text;
}

/**
 * A heading's text without its optional closing `#`s, which only count after
 * a space or tab. Scanned from the end, so a long run of spaces or `#`s
 * can't make a pattern backtrack.
 */
function withoutClosingHashes(text: string): string {
  const trimmed = text.trimEnd();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "#") end -= 1;
  if (end === trimmed.length) return trimmed;
  if (end === 0) return "";
  const before = trimmed[end - 1];
  return before === " " || before === "\t"
    ? trimmed.slice(0, end).trimEnd()
    : trimmed;
}

/**
 * Inline code runs from a run of backticks to the next run of the same
 * length. The runs are collected in one pass and each is paired once.
 */
function codeSpans(
  text: string,
): { start: number; end: number; ticks: number }[] {
  const runs = Array.from(text.matchAll(/`+/g), (match, index) => {
    // An unescaped backslash before a run makes its first backtick literal.
    // That only matters where the run opens code: inside code, a backslash
    // is literal, so it can't escape the closing run.
    let slashes = 0;
    while (text[match.index - slashes - 1] === "\\") slashes += 1;
    const escaped = slashes % 2 === 1;
    return {
      index,
      at: match.index + (escaped ? 1 : 0),
      opens: match[0].length - (escaped ? 1 : 0),
      end: match.index + match[0].length,
      length: match[0].length,
    };
  });
  type Run = (typeof runs)[number];
  const closers = new Map<Run, Run>();
  const laterByLength = new Map<number, Run>();
  for (const run of [...runs].reverse()) {
    const later = laterByLength.get(run.opens);
    if (run.opens > 0 && later) closers.set(run, later);
    laterByLength.set(run.length, run);
  }
  const spans: { start: number; end: number; ticks: number }[] = [];
  let next = 0;
  for (const open of runs) {
    const closing = closers.get(open);
    if (open.index < next || !closing) continue;
    spans.push({ start: open.at, end: closing.end, ticks: open.opens });
    next = closing.index + 1;
  }
  return spans;
}

function plainProse(text: string): string {
  return (
    text
      .replace(/@\[([^[\]]+)\]\(mailto:[^()]*\)/g, "@$1")
      .replace(/!\[([^[\]]*)\]\([^()]*\)/g, "$1")
      .replace(/\[([^[\]]+)\]\([^()]*\)/g, "$1")
      .replace(/<((?:https?|mailto):[^\s<>]+)>/gi, "$1")
      .replace(HTML_TAG, "")
      .replace(/(\*\*|__)(?!\s)((?:(?!\1)[\s\S])*?\S)\1/g, "$2")
      .replace(/~~(?!\s)((?:(?!~~)[\s\S])*?\S)~~/g, "$1")
      .replace(/\*([^\s*](?:[^*]*?[^\s*])?)\*/g, "$1")
      // Unlike `*`, `_` doesn't emphasize inside a word, so snake_case stays.
      .replace(
        /(^|[^\p{L}\p{N}_])_([^\s_](?:[^_]*?[^\s_])?)_(?![\p{L}\p{N}_])/gu,
        "$1$2",
      )
  );
}
