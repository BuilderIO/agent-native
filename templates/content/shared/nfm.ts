import { matchInlineMathAt } from "./inline-math.js";
import { registryBlockSpecByTag } from "./nfm-registry.js";

export interface PMMark {
  type: string;
  attrs?: Record<string, any>;
}
export interface PMNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}
export interface PMDoc {
  type: "doc";
  content: PMNode[];
}

export type NfmFidelityStatus =
  | "preserved"
  | "transformed"
  | "unresolved"
  | "failed";

export interface NfmFidelityReport {
  status: NfmFidelityStatus;
  normalizedChanged: boolean;
  conversions: Array<{ kind: string; count: number }>;
  unresolved: Array<{ kind: string; count: number }>;
  error?: string;
}

/** Source the parse reads but cannot keep. */
export type NfmParseLossKind =
  | "dropped-source"
  | "dropped-attribute"
  | "dropped-formatting";

export interface NfmParseLoss {
  kind: NfmParseLossKind;
  sample: string;
}

let activeLossSink: NfmParseLoss[] | null = null;

function reportLoss(kind: NfmParseLossKind, sample: string): void {
  activeLossSink?.push({ kind, sample });
}

const BASE_COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];
export const NFM_COLORS = new Set<string>([
  "default",
  ...BASE_COLORS,
  ...BASE_COLORS.map((c) => `${c}_bg`),
]);
function isColor(value: string | null | undefined): value is string {
  return !!value && NFM_COLORS.has(value) && value !== "default";
}

const ESCAPABLE = new Set("\\*~`$[]<>{}|^".split(""));

// CommonMark lets a backslash escape any ASCII punctuation, and agents write
// `\_` or `1\.`. Writing still escapes only `ESCAPABLE`, so the bytes the
// editor already stored keep their spelling.
const PARSE_ESCAPABLE = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split(""));

export function escapeInlineText(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ESCAPABLE.has(ch)) out += "\\" + ch;
    else out += ch;
  }
  return out;
}

function unescapeInlineText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (
      text[i] === "\\" &&
      i + 1 < text.length &&
      PARSE_ESCAPABLE.has(text[i + 1])
    ) {
      out += text[i + 1];
      i++;
    } else {
      out += text[i];
    }
  }
  return out;
}

const LEADING_BLOCK_MARKER = /^(#{1,6} |[-*+] |\d+[.)] |\[[ xX]\] )/;

const DIVIDER_LOOKALIKE = /^(-{3,}|\*{3,}|_{3,})$/;

// A list marker after spaces nests under the list above it, the way agents
// indent with spaces, so paragraph text shaped like one is escaped too.
const SPACED_LIST_MARKER = /^ +(?:[-*+] |\d+[.)] )/;

function escapeLeadingBlockMarker(text: string): string {
  if (
    LEADING_BLOCK_MARKER.test(text) ||
    SPACED_LIST_MARKER.test(text) ||
    DIVIDER_LOOKALIKE.test(text.trim())
  ) {
    return "\\" + text;
  }
  return text;
}

function unescapeLeadingBlockMarker(text: string): string {
  if (
    text[0] === "\\" &&
    (LEADING_BLOCK_MARKER.test(text.slice(1)) ||
      SPACED_LIST_MARKER.test(text.slice(1)) ||
      DIVIDER_LOOKALIKE.test(text.slice(1).trim()))
  ) {
    return text.slice(1);
  }
  return text;
}

function escapeAttr(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function serializeAttrs(
  attrs: Array<[string, string | number | boolean | null | undefined]>,
): string {
  const parts = attrs
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
    .map(([k, v]) =>
      v === true ? `${k}="true"` : `${k}="${escapeAttr(String(v))}"`,
    );
  return parts.length ? " " + parts.join(" ") : "";
}
const ATTR_NAME_CHAR = /[\w:-]/;
const ATTR_NAME_START = /[a-zA-Z_:]/;
const SPACE_CHAR = /\s/;

// Each `name="value"` in `raw`, as /([a-zA-Z_:][\w:-]*)\s*=\s*"([^"]*)"/g
// finds them. Found by hand: that pattern tries a name from every offset of a
// word, and rescans the rest of a long word from each one.
function attrMatches(
  raw: string,
): Array<{ from: number; to: number; name: string; value: string }> {
  const found: Array<{
    from: number;
    to: number;
    name: string;
    value: string;
  }> = [];
  let i = 0;
  while (i < raw.length) {
    if (!ATTR_NAME_CHAR.test(raw[i])) {
      i++;
      continue;
    }
    let end = i;
    while (end < raw.length && ATTR_NAME_CHAR.test(raw[end])) end++;
    // A name from any later offset of the word ends where this one does.
    let from = i;
    while (from < end && !ATTR_NAME_START.test(raw[from])) from++;
    let at = end;
    while (at < raw.length && SPACE_CHAR.test(raw[at])) at++;
    if (from < end && raw[at] === "=") {
      at++;
      while (at < raw.length && SPACE_CHAR.test(raw[at])) at++;
      const close = raw[at] === '"' ? raw.indexOf('"', at + 1) : -1;
      if (close !== -1) {
        found.push({
          from,
          to: close + 1,
          name: raw.slice(from, end),
          value: raw.slice(at + 1, close),
        });
        i = close + 1;
        continue;
      }
    }
    i = end;
  }
  return found;
}
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const { name, value } of attrMatches(raw))
    attrs[name] = unescapeAttr(value);
  return attrs;
}
/** Attribute source `parseAttrs` skips: unquoted, single-quoted or bare. */
function unparsedAttrSource(raw: string): string {
  let rest = "";
  let last = 0;
  for (const { from, to } of attrMatches(raw)) {
    rest += raw.slice(last, from);
    last = to;
  }
  return (rest + raw.slice(last)).replace(/\/\s*$/, "").trim();
}

/**
 * `parseAttrs`, reporting what the node cannot keep: source it cannot read
 * and, when the node keeps only `kept`, any other attribute and a color it
 * does not know.
 */
function readAttrs(
  tag: string,
  raw: string,
  kept?: ReadonlySet<string>,
): Record<string, string> {
  const attrs = parseAttrs(raw);
  for (const [name, value] of Object.entries(attrs)) {
    if (kept && (!kept.has(name) || (name === "color" && !isColor(value))))
      reportLoss("dropped-attribute", `<${tag} ${name}="${value}">`);
  }
  const unparsed = unparsedAttrSource(raw);
  if (unparsed) reportLoss("dropped-attribute", `<${tag} ${unparsed}>`);
  return attrs;
}

function hasUnsupportedJsxProps(raw: string): boolean {
  const withoutDoubleQuotedStrings = raw.replace(/"[^"]*"/g, '""');
  return (
    /\s[a-zA-Z_:][\w:-]*\s*=\s*(?:\{|`|')/.test(withoutDoubleQuotedStrings) ||
    /\s[a-zA-Z_:][\w:-]*(?=\s*\/?>)/.test(withoutDoubleQuotedStrings)
  );
}

function blockAttrSuffix(opts: {
  toggle?: boolean;
  color?: string | null;
}): string {
  const parts: string[] = [];
  if (opts.toggle) parts.push('toggle="true"');
  if (isColor(opts.color)) parts.push(`color="${opts.color}"`);
  return parts.length ? ` {${parts.join(" ")}}` : "";
}
// Counted by hand: /\\+$/ retries from every backslash of a run that does
// not end the string.
function trailingBackslashes(s: string): number {
  let run = 0;
  while (run < s.length && s[s.length - 1 - run] === "\\") run++;
  return run;
}

function oddTrailingBackslashes(s: string): boolean {
  return trailingBackslashes(s) % 2 === 1;
}

function escapeTrailingBackslashRun(s: string): string {
  return s + "\\".repeat(trailingBackslashes(s));
}

function unescapeTrailingBackslashRun(s: string): string {
  const run = trailingBackslashes(s);
  if (!run) return s;
  return s.slice(0, -run) + "\\".repeat(run / 2);
}

// /^(.*?)\s*\{([^{}]*)\}\s*$/, found by hand: that pattern retries the spaces
// before the brace from every offset of a long run of them.
function matchBlockAttrSuffix(
  line: string,
): { text: string; body: string } | null {
  const brace = /\{([^{}]*)\}\s*$/.exec(line);
  if (!brace) return null;
  let end = brace.index;
  while (end > 0 && SPACE_CHAR.test(line[end - 1])) end--;
  const text = line.slice(0, end);
  // The pattern's `.` stops at a line terminator.
  if (/[\n\r\u2028\u2029]/.test(text)) return null;
  return { text, body: brace[1] };
}

function splitBlockAttrs(
  line: string,
  allowToggle = false,
): {
  text: string;
  toggle: boolean;
  color: string | null;
} {
  const m = matchBlockAttrSuffix(line);
  if (!m) return { text: line, toggle: false, color: null };
  const body = m.body;
  if (oddTrailingBackslashes(m.text) || oddTrailingBackslashes(body)) {
    return { text: line, toggle: false, color: null };
  }
  const toggle = /\btoggle\s*=\s*"true"/.test(body);
  const colorMatch = body.match(/\bcolor\s*=\s*"([^"]+)"/);
  const color = colorMatch && isColor(colorMatch[1]) ? colorMatch[1] : null;
  if (!toggle && !color) return { text: line, toggle: false, color: null };
  if (toggle && !allowToggle)
    reportLoss("dropped-attribute", '{toggle="true"}');
  const rest = body
    .replace(/\btoggle\s*=\s*"true"/, "")
    .replace(/\bcolor\s*=\s*"[^"]+"/, "")
    .trim();
  if (rest || (colorMatch && !color))
    reportLoss("dropped-attribute", `{${body}}`);
  return { text: m.text, toggle, color };
}

function markOf(node: PMNode, type: string): PMMark | undefined {
  return node.marks?.find((m) => m.type === type);
}

function serializeInlineAtom(node: PMNode, following = ""): string {
  const tagName = (node.attrs?.tagName as string) || "mention";
  const label = (node.attrs?.label as string) || "";
  let attrs: Record<string, string> = {};
  try {
    attrs = JSON.parse((node.attrs?.attrsJson as string) || "{}");
  } catch {
    attrs = {};
  }
  if (tagName === "math") {
    return serializeInlineMath(label || attrs.latex || "", following);
  }
  const attrEntries = Object.entries(attrs).filter(([k]) => k !== "latex");
  const attrStr = serializeAttrs(attrEntries);
  const selfClosing = !label.trim();
  if (selfClosing) return `<${tagName}${attrStr}/>`;
  return `<${tagName}${attrStr}>${escapeAttr(label)}</${tagName}>`;
}

// Plain math does not close before a digit or another `$`, nor next to a
// space inside it; GitHub's $`…`$ form has none of those rules.
function serializeInlineMath(latex: string, following: string): string {
  const plain = `$${latex}$`;
  const read = matchInlineMathAt(plain + following, 0);
  if (read?.to === plain.length && read.latex === latex) return plain;
  return latex.includes("`$") ? plain : `$\`${latex}\`$`;
}

function serializeInline(
  nodes: PMNode[] | undefined,
  escapeUnderscore = false,
): string {
  if (!nodes || !nodes.length) return "";
  const parts = nodes.map((node) =>
    node.type === "notionInlineAtom"
      ? ""
      : serializeInlineNode(node, escapeUnderscore),
  );
  let following = "";
  for (let index = parts.length - 1; index >= 0; index--) {
    if (nodes[index]!.type === "notionInlineAtom")
      parts[index] = serializeInlineAtom(nodes[index]!, following);
    following = (parts[index] + following).slice(0, 1);
  }
  const source = parts.join("");
  return escapeUnderscore || !readsUnderscoreEmphasis(source)
    ? source
    : serializeInline(nodes, true);
}

// The writer never spells formatting with underscores, so underscore emphasis
// in its own output means literal text such as `__init__` would come back
// bold; escaping that line's underscores keeps it text.
function readsUnderscoreEmphasis(source: string): boolean {
  if (!source.includes("_")) return false;
  const before = underscoreEmphasisParsed;
  const sink = activeLossSink;
  activeLossSink = null;
  try {
    parseInline(source);
  } finally {
    activeLossSink = sink;
  }
  return underscoreEmphasisParsed !== before;
}

/** The longest match of a global `run` pattern, like /`+/g, in `text`. */
export function longestRun(text: string, run: RegExp): number {
  // Not Math.max(...matches): a long code block holds more runs than a call
  // can take arguments.
  let longest = 0;
  for (const [match] of text.matchAll(run))
    longest = Math.max(longest, match.length);
  return longest;
}

function serializeInlineTextNode(
  node: PMNode,
  collectOffsets: boolean,
  escapeUnderscore = false,
): {
  source: string;
  textOffsets: number[] | null;
} | null {
  if (node.type !== "text") return null;
  const raw = node.text ?? "";
  const code = markOf(node, "code");
  let out: string;
  let textOffsets: number[] | null = collectOffsets ? [0] : null;
  if (code) {
    const codeText = raw.replace(/\n/g, "<br>");
    // The reader strips padding only around code that is not all whitespace.
    const isAllSpaces = raw.trim() === "";
    const delim = "`".repeat(longestRun(codeText, /`+/g) + 1);
    const needsPadding =
      !isAllSpaces &&
      (codeText.startsWith("`") ||
        codeText.endsWith("`") ||
        codeText.startsWith(" ") ||
        codeText.endsWith(" "));
    const body = needsPadding ? ` ${codeText} ` : codeText;
    out = delim + body + delim;
    if (textOffsets) {
      let contentOffset = delim.length + (needsPadding ? 1 : 0);
      textOffsets = [contentOffset];
      for (let index = 0; index < raw.length; index += 1) {
        contentOffset += raw[index] === "\n" ? "<br>".length : 1;
        textOffsets.push(contentOffset);
      }
    }
  } else {
    if (escapeUnderscore) contextualSpellings?.escapedUnderscores.add(node);
    const escape = (text: string) => {
      const escaped = escapeInlineText(text);
      return escapeUnderscore ? escaped.replace(/_/g, "\\_") : escaped;
    };
    out = escape(raw);
    if (textOffsets) {
      let contentOffset = 0;
      textOffsets = [contentOffset];
      for (let index = 0; index < raw.length; index += 1) {
        contentOffset += escape(raw[index]!).length;
        textOffsets.push(contentOffset);
      }
    }
  }

  const wrap = (prefix: string, suffix: string) => {
    out = prefix + out + suffix;
    if (textOffsets)
      textOffsets = textOffsets.map((offset) => prefix.length + offset);
  };

  const bold = markOf(node, "bold");
  const italic = markOf(node, "italic");
  if (bold && italic) {
    wrap("***", "***");
  } else {
    if (markOf(node, "strike")) wrap("~~", "~~");
    if (italic) wrap("*", "*");
    if (bold) wrap("**", "**");
  }
  if (!(bold && italic) && markOf(node, "strike") && (bold || italic)) {
    // strike already applied above; nothing to do
  }
  if (bold && italic && markOf(node, "strike")) {
    wrap("~~", "~~");
  }

  const span = markOf(node, "notionSpan");
  const plainUnderline = !!markOf(node, "underline");
  if (span || plainUnderline) {
    const a = span?.attrs || {};
    const underlined =
      a.underline === "true" || a.underline === true || plainUnderline;
    const foregroundColor =
      isColor(a.color) && !a.color.endsWith("_bg") ? a.color : null;
    const backgroundColor =
      isColor(a.bgColor) && a.bgColor.endsWith("_bg") ? a.bgColor : null;
    const attrStr = serializeAttrs([
      ["color", foregroundColor || backgroundColor],
      ["bg_color", foregroundColor ? backgroundColor : null],
      ["underline", underlined ? "true" : null],
    ]);
    if (attrStr) wrap(`<span${attrStr}>`, "</span>");
  }

  const link = markOf(node, "link");
  if (link?.attrs?.href) {
    wrap("[", `](${serializeUrlForParens(link.attrs.href)})`);
  }
  return { source: out, textOffsets };
}

export function serializeInlineTextNodeWithOffsets(
  node: PMNode,
  escapeUnderscore = false,
): {
  source: string;
  textOffsets: number[];
} | null {
  const serialized = serializeInlineTextNode(node, true, escapeUnderscore);
  return serialized?.textOffsets
    ? { source: serialized.source, textOffsets: serialized.textOffsets }
    : null;
}

export function serializeInlineNode(
  node: PMNode,
  escapeUnderscore = false,
): string {
  if (node.type === "hardBreak") return "<br>";
  if (node.type === "notionInlineAtom") return serializeInlineAtom(node);
  const textNode = serializeInlineTextNode(node, false, escapeUnderscore);
  if (textNode) return textNode.source;
  return node.text ? escapeInlineText(node.text) : "";
}

function textNode(text: string, marks: PMMark[]): PMNode {
  return marks.length ? { type: "text", text, marks } : { type: "text", text };
}

// The live copy keeps formatting only on text: Yjs stores no marks on math or
// a mention, so formatting around one is a loss.
function reportAtomFormatting(node: PMNode, markType: string): void {
  if (node.type === "notionInlineAtom")
    reportLoss(
      "dropped-formatting",
      `${markType} on ${serializeInlineAtom(node)}`,
    );
}

function addMark(nodes: PMNode[], mark: PMMark): void {
  for (const n of nodes) {
    if (n.type === "text") {
      n.marks = n.marks || [];
      if (!n.marks.some((m) => m.type === mark.type)) n.marks.push(mark);
    } else reportAtomFormatting(n, mark.type);
  }
}

/** The `notionSpan` mark attrs read from an NFM `<span>` tag's attributes. */
export function notionSpanAttrs(
  attrs: Record<string, string>,
): Record<string, any> {
  const color = attrs.color;
  const isBg = color ? color.endsWith("_bg") : false;
  const explicitBackground = attrs.bg_color;
  return {
    color: isColor(color) && !isBg ? color : null,
    bgColor:
      isColor(explicitBackground) && explicitBackground.endsWith("_bg")
        ? explicitBackground
        : isColor(color) && isBg
          ? color
          : null,
    underline: attrs.underline === "true" ? "true" : null,
    href: attrs.href || null,
    attrsJson: "{}",
  };
}

function mergeSpanMark(
  nodes: PMNode[],
  attrs: Record<string, string>,
  rawAttrs: string,
): void {
  const spanAttrs = notionSpanAttrs(attrs);
  for (const [name, value] of Object.entries(attrs)) {
    const kept =
      name === "color"
        ? spanAttrs.color === value || spanAttrs.bgColor === value
        : name === "bg_color"
          ? spanAttrs.bgColor === value
          : name === "underline" && (value === "true" || value === "false");
    if (!kept) reportLoss("dropped-attribute", `<span ${name}="${value}">`);
  }
  const unparsed = unparsedAttrSource(rawAttrs);
  if (unparsed) reportLoss("dropped-attribute", `<span ${unparsed}>`);
  // A bare span is no formatting; the writer would drop it. One whose
  // attributes could not be read keeps an empty mark, so suggestions can tell
  // its source holds formatting they cannot map.
  if (
    !spanAttrs.color &&
    !spanAttrs.bgColor &&
    !spanAttrs.underline &&
    !spanAttrs.href &&
    !rawAttrs.trim()
  )
    return;
  for (const n of nodes) {
    if (n.type === "text") {
      n.marks = n.marks || [];
      if (!n.marks.some((m) => m.type === "notionSpan")) {
        n.marks.push({ type: "notionSpan", attrs: spanAttrs });
      }
    } else reportAtomFormatting(n, "span");
  }
}

// Code spans and math bind tighter than emphasis, so a delimiter inside one
// never closes a run outside it: the editor writes the code `*args` in
// italics as *`*args`*.
function findToken(
  s: string,
  token: string,
  from: number,
  codeRuns: CodeRuns,
): number {
  for (let i = from; i <= s.length - token.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    const skipTo = atomicSpanEnd(s, i, codeRuns);
    if (skipTo !== -1) {
      i = skipTo - 1;
      continue;
    }
    if (s.startsWith(token, i)) return i;
  }
  return -1;
}

// A `**` before a word that the next `**` closes, as in `*Run **npm**
// install*`, is bold inside the italic when a `*` after it closes the italic.
// Otherwise the `**` closes the italic, as main reads it. The writer's own `**`
// inside an italic closes and reopens it around another mark's delimiter
// (`*a **~~b~~** c*`), so a `**` before punctuation always closes the italic.
// `chains` holds each bold opener's walk, so a line of them stays linear.
function findItalicClose(
  s: string,
  from: number,
  codeRuns: CodeRuns,
  chains: Map<number, number>,
): number {
  const first = findToken(s, "*", from, codeRuns);
  const walked: number[] = [];
  let close = -1;
  for (let at = first; at !== -1; ) {
    const known = chains.get(at);
    if (known !== undefined) {
      close = known;
      break;
    }
    const bold = boldInsideItalicClose(s, at, codeRuns);
    if (bold === -1) {
      close = at;
      break;
    }
    walked.push(at);
    at = findToken(s, "*", bold + 2, codeRuns);
  }
  for (const at of walked) chains.set(at, close);
  return close === -1 ? first : close;
}

/** Where the bold opened by the `**` at `at` closes, or -1 if it opens none. */
function boldInsideItalicClose(
  s: string,
  at: number,
  codeRuns: CodeRuns,
): number {
  if (s[at - 1] === "*" || delimiterRunLength(s, at, "*") !== 2) return -1;
  const open = delimiterFlanking(s, at, at + 2);
  if (!open.left || open.right || isFlankPunctuation(open.after)) return -1;
  const bold = findToken(s, "**", at + 2, codeRuns);
  if (bold <= at + 2) return -1;
  const run = delimiterRunLength(s, bold, "*");
  const close = delimiterFlanking(s, bold, bold + run);
  return run > 3 || !close.right || close.left ? -1 : bold;
}

/**
 * Where the code span or math starting at `at` ends, or where an unclosed
 * backtick run ends; -1 when neither starts there.
 */
function atomicSpanEnd(s: string, at: number, codeRuns: CodeRuns): number {
  if (s[at] === "$") return matchInlineMathAt(s, at)?.to ?? -1;
  return codeSpanSkip(s, at, codeRuns);
}

/** `atomicSpanEnd` for code spans alone. */
function codeSpanSkip(s: string, at: number, codeRuns: CodeRuns): number {
  if (s[at] !== "`") return -1;
  const run = delimiterRunLength(s, at, "`");
  const end = codeSpanEnd(at, run, codeRuns);
  return end === -1 ? at + run : end;
}

// Where each backtick run of one source starts, by run length. Every scanner
// of that source shares it: searching the rest of the source for a closer
// from each opener is quadratic in a source of unclosed runs of many lengths.
type CodeRuns = Map<number, number[]>;

function indexCodeRuns(s: string): CodeRuns {
  const runs: CodeRuns = new Map();
  for (let at = s.indexOf("`"); at !== -1; ) {
    const run = delimiterRunLength(s, at, "`");
    const starts = runs.get(run);
    if (starts) starts.push(at);
    else runs.set(run, [at]);
    at = s.indexOf("`", at + run);
  }
  return runs;
}

// A code span closes at the next run of exactly its length; the backticks
// at `at` may be the end of a longer run an escape split.
function codeSpanEnd(at: number, run: number, codeRuns: CodeRuns): number {
  const starts = codeRuns.get(run);
  if (!starts) return -1;
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (starts[mid] <= at) low = mid + 1;
    else high = mid;
  }
  return low < starts.length ? starts[low] + run : -1;
}

function delimiterRunLength(s: string, from: number, ch: string): number {
  let length = 0;
  while (s[from + length] === ch) length++;
  return length;
}

function characterBefore(s: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const low = s.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = s.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return s.slice(index - 2, index);
  }
  return s[index - 1];
}

function characterAt(s: string, index: number): string | undefined {
  if (index >= s.length) return undefined;
  return String.fromCodePoint(s.codePointAt(index)!);
}

function isFlankWhitespace(ch: string | undefined): boolean {
  return ch === undefined || /^\s$/u.test(ch);
}

function isFlankPunctuation(ch: string | undefined): boolean {
  return ch !== undefined && /^[\p{P}\p{S}]$/u.test(ch);
}

// CommonMark's flanking rules, so `snake_case_name` and other underscores
// inside words stay literal.
function delimiterFlanking(s: string, from: number, to: number) {
  const before = characterBefore(s, from);
  const after = characterAt(s, to);
  const left =
    !isFlankWhitespace(after) &&
    (!isFlankPunctuation(after) ||
      isFlankWhitespace(before) ||
      isFlankPunctuation(before));
  const right =
    !isFlankWhitespace(before) &&
    (!isFlankPunctuation(before) ||
      isFlankWhitespace(after) ||
      isFlankPunctuation(after));
  return { left, right, before, after };
}

let underscoreEmphasisParsed = 0;

// `misses[run]` is the earliest offset a search for a closer of that length
// already failed from, so a paragraph of unmatched `_x` openers stays linear.
function matchUnderscoreEmphasis(
  input: string,
  start: number,
  misses: number[],
  codeRuns: CodeRuns,
): { from: number; to: number; run: number } | null {
  const run = delimiterRunLength(input, start, "_");
  if (run > 3) return null;
  const open = delimiterFlanking(input, start, start + run);
  if (!open.left || (open.right && !isFlankPunctuation(open.before)))
    return null;
  const from = start + run;
  if (misses[run] !== undefined && from >= misses[run]) return null;
  for (let j = from; j < input.length; j++) {
    if (input[j] === "\\") {
      j++;
      continue;
    }
    const skipTo = atomicSpanEnd(input, j, codeRuns);
    if (skipTo !== -1) {
      j = skipTo - 1;
      continue;
    }
    if (input[j] !== "_") continue;
    const length = delimiterRunLength(input, j, "_");
    const close = delimiterFlanking(input, j, j + length);
    if (
      j > from &&
      length >= run &&
      close.right &&
      (!close.left || isFlankPunctuation(close.after))
    )
      return { from, to: j, run };
    j += length - 1;
  }
  misses[run] = Math.min(misses[run] ?? from, from);
  return null;
}

// Every run of one link or span shares its mark, so each mark is keyed once:
// keying it per neighbouring pair is quadratic under one long URL.
const markKeys = new WeakMap<PMMark, string>();

function markKey(mark: PMMark): string {
  let key = markKeys.get(mark);
  if (key === undefined) {
    key = `${mark.type}:${JSON.stringify(mark.attrs ?? null)}`;
    markKeys.set(mark, key);
  }
  return key;
}

function sameMarks(a: PMMark[] | undefined, b: PMMark[] | undefined): boolean {
  const left = (a ?? []).map(markKey).sort();
  const right = (b ?? []).map(markKey).sort();
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

// The editor joins neighbouring text with the same formatting into one run,
// so the parse does too; otherwise `**a****b**` keeps a seam the editor never
// saves.
function mergeAdjacentText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (
      node.type === "text" &&
      last?.type === "text" &&
      sameMarks(last.marks, node.marks)
    ) {
      out[out.length - 1] = {
        ...last,
        text: (last.text ?? "") + (node.text ?? ""),
      };
    } else {
      out.push(node);
    }
  }
  return out;
}

// Spans, marks and links read their text by parsing it again, so each level
// of nesting costs its whole text and a few call frames. Past this depth,
// which no page needs, the text reads as written and the loss is reported.
const MAX_INLINE_DEPTH = 32;

function parseInline(input: string, depth = 0): PMNode[] {
  if (depth > MAX_INLINE_DEPTH) {
    // Without a character that opens a construct, text reads as itself.
    if (/[\\$`<*~_[]/.test(input)) reportLoss("dropped-formatting", input);
    return input ? [textNode(input, [])] : [];
  }
  const out: PMNode[] = [];
  let buf = "";
  let i = 0;
  const codeRuns = indexCodeRuns(input);
  const underscoreMisses: number[] = [];
  let italicChains: Map<number, number> | null = null;
  let linkCloses: LinkCloses | null = null;
  let nextIndex: ((needle: string, from: number) => number) | null = null;
  let mentionCloses: MentionCloseTrie | null = null;
  const flush = () => {
    if (buf) {
      out.push(textNode(buf, []));
      buf = "";
    }
  };

  while (i < input.length) {
    const ch = input[i];

    if (
      ch === "\\" &&
      i + 1 < input.length &&
      PARSE_ESCAPABLE.has(input[i + 1])
    ) {
      buf += input[i + 1];
      i += 2;
      continue;
    }

    const inlineMath = ch === "$" ? matchInlineMathAt(input, i) : null;
    if (inlineMath) {
      flush();
      out.push({
        type: "notionInlineAtom",
        attrs: {
          tagName: "math",
          attrsJson: "{}",
          label: inlineMath.latex,
        },
      });
      i = inlineMath.to;
      continue;
    }

    if (ch === "`") {
      // A run with no closer stays text, and so does each backtick of it
      // until what is left of the run finds one: ```a`` is ` then code `a`.
      // The run is walked once, since measuring it again from each backtick
      // is quadratic in its length.
      const runEnd = i + delimiterRunLength(input, i, "`");
      let at = i;
      let end = codeSpanEnd(at, runEnd - at, codeRuns);
      while (end === -1 && ++at < runEnd)
        end = codeSpanEnd(at, runEnd - at, codeRuns);
      buf += input.slice(i, at);
      if (end === -1) {
        i = runEnd;
        continue;
      }
      const openRun = runEnd - at;
      const close = end - openRun;
      flush();
      let codeText = input.slice(at + openRun, close).replace(/<br\/?>/g, "\n");
      if (
        codeText.startsWith(" ") &&
        codeText.endsWith(" ") &&
        codeText.trim().length > 0
      ) {
        codeText = codeText.slice(1, -1);
      }
      out.push(textNode(codeText, [{ type: "code" }]));
      i = end;
      continue;
    }

    if (input.startsWith("<br/>", i) || input.startsWith("<br>", i)) {
      flush();
      out.push({ type: "hardBreak" });
      i += input.startsWith("<br/>", i) ? 5 : 4;
      continue;
    }

    if (input.startsWith("<span", i)) {
      nextIndex ??= nextIndexFinder(input);
      const open = nextIndex(">", i);
      const close = open === -1 ? -1 : nextIndex("</span>", open);
      if (open !== -1 && close !== -1) {
        flush();
        const rawAttrs = input.slice(i + 5, open);
        const inner = parseInline(input.slice(open + 1, close), depth + 1);
        mergeSpanMark(inner, parseAttrs(rawAttrs), rawAttrs);
        pushAll(out, inner);
        i = close + "</span>".length;
        continue;
      }
    }

    if (input.startsWith("<mention-", i)) {
      nextIndex ??= nextIndexFinder(input);
      const selfClose = nextIndex("/>", i);
      const open = nextIndex(">", i);
      if (selfClose !== -1 && (open === -1 || selfClose <= open)) {
        flush();
        const tagMatch = input.slice(i).match(/^<(mention-[\w-]+)([^>]*?)\/>/);
        if (tagMatch) {
          out.push(makeInlineAtom(tagMatch[1], tagMatch[2], ""));
          i += tagMatch[0].length;
          continue;
        }
      }
      const tag =
        open === -1
          ? null
          : matchMentionTag(
              input,
              i,
              open,
              (mentionCloses ??= indexMentionCloses(input)),
            );
      if (tag) {
        flush();
        out.push(makeInlineAtom(tag.name, tag.attrs, tag.label));
        i = tag.end;
        continue;
      }
    }

    if (input.startsWith("***", i)) {
      const close = findToken(input, "***", i + 3, codeRuns);
      if (close > i + 3) {
        flush();
        const inner = parseInline(input.slice(i + 3, close), depth + 1);
        addMark(inner, { type: "bold" });
        addMark(inner, { type: "italic" });
        pushAll(out, inner);
        i = close + 3;
        continue;
      }
    }

    if (input.startsWith("**", i)) {
      const close = findToken(input, "**", i + 2, codeRuns);
      if (close > i + 2) {
        flush();
        const inner = parseInline(input.slice(i + 2, close), depth + 1);
        addMark(inner, { type: "bold" });
        pushAll(out, inner);
        i = close + 2;
        continue;
      }
    }

    if (input.startsWith("~~", i)) {
      const close = findToken(input, "~~", i + 2, codeRuns);
      if (close > i + 2) {
        flush();
        const inner = parseInline(input.slice(i + 2, close), depth + 1);
        addMark(inner, { type: "strike" });
        pushAll(out, inner);
        i = close + 2;
        continue;
      }
    }

    if (ch === "_") {
      const emphasis = matchUnderscoreEmphasis(
        input,
        i,
        underscoreMisses,
        codeRuns,
      );
      if (emphasis) {
        flush();
        const inner = parseInline(
          input.slice(emphasis.from, emphasis.to),
          depth + 1,
        );
        if (emphasis.run >= 2) addMark(inner, { type: "bold" });
        if (emphasis.run !== 2) addMark(inner, { type: "italic" });
        pushAll(out, inner);
        underscoreEmphasisParsed++;
        i = emphasis.to + emphasis.run;
        continue;
      }
      const run = delimiterRunLength(input, i, "_");
      buf += input.slice(i, i + run);
      i += run;
      continue;
    }

    if (ch === "*") {
      const close = findItalicClose(
        input,
        i + 1,
        codeRuns,
        (italicChains ??= new Map()),
      );
      if (close > i + 1) {
        flush();
        const inner = parseInline(input.slice(i + 1, close), depth + 1);
        addMark(inner, { type: "italic" });
        pushAll(out, inner);
        i = close + 1;
        continue;
      }
    }

    if (ch === "[") {
      linkCloses ??= {
        brackets: new Int32Array(input.length),
        parens: new Int32Array(input.length),
      };
      const link = matchLink(input, i, linkCloses, codeRuns);
      if (link) {
        flush();
        const inner = parseInline(link.text, depth + 1);
        addMark(inner, { type: "link", attrs: { href: link.href } });
        pushAll(out, inner);
        i = link.end;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return mergeAdjacentText(out);
}

// The next `needle` at or after `from`. The parse asks with growing offsets,
// so the last answer for each needle usually still holds, and a line of
// unclosed tags is searched once rather than once per tag.
function nextIndexFinder(s: string): (needle: string, from: number) => number {
  const last = new Map<string, { from: number; at: number }>();
  return (needle, from) => {
    const hit = last.get(needle);
    if (hit && from >= hit.from && (hit.at === -1 || from <= hit.at))
      return hit.at;
    const at = s.indexOf(needle, from);
    last.set(needle, { from, at });
    return at;
  };
}

const MENTION_NAME_CHAR = /[\w-]/;

// The names of a source's `</mention-name>` close tags, as a trie of their
// characters holding each name's tag offsets.
type MentionCloseTrie = { next: Map<string, MentionCloseTrie>; at: number[] };

function indexMentionCloses(s: string): MentionCloseTrie {
  const root: MentionCloseTrie = { next: new Map(), at: [] };
  const prefix = "</mention-";
  for (
    let tag = s.indexOf(prefix);
    tag !== -1;
    tag = s.indexOf(prefix, tag + 1)
  ) {
    let node = root;
    let end = tag + prefix.length;
    for (; end < s.length && MENTION_NAME_CHAR.test(s[end]); end++) {
      let child = node.next.get(s[end]);
      if (!child) node.next.set(s[end], (child = { next: new Map(), at: [] }));
      node = child;
    }
    if (node !== root && s[end] === ">") node.at.push(tag);
  }
  return root;
}

// The mention at `at` whose open tag ends at `gt`, as
// /^<(mention-[\w-]+)([^>]*)>([\s\S]*?)<\/\1>/ reads it: the longest name
// with a close tag after the open tag, up to that tag's first occurrence. By
// hand, since the pattern searches the rest of the source again for each
// shorter name it backs off to.
function matchMentionTag(
  s: string,
  at: number,
  gt: number,
  closes: MentionCloseTrie,
): { name: string; attrs: string; label: string; end: number } | null {
  const closable: Array<{ node: MentionCloseTrie; end: number }> = [];
  let node: MentionCloseTrie | undefined = closes;
  let end = at + "<mention-".length;
  while (node && end < s.length && MENTION_NAME_CHAR.test(s[end])) {
    node = node.next.get(s[end++]);
    if (node?.at.length) closable.push({ node, end });
  }
  for (let k = closable.length - 1; k >= 0; k--) {
    const tags = closable[k].node.at;
    let low = 0;
    let high = tags.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tags[mid] <= gt) low = mid + 1;
      else high = mid;
    }
    if (low === tags.length) continue;
    const name = s.slice(at + 1, closable[k].end);
    return {
      name,
      attrs: s.slice(closable[k].end, gt),
      label: s.slice(gt + 1, tags[low]),
      end: tags[low] + name.length + 3,
    };
  }
  return null;
}

function makeInlineAtom(
  tagName: string,
  rawAttrs: string,
  label: string,
): PMNode {
  const attrs = readAttrs(tagName, rawAttrs);
  const text = unescapeAttr(label);
  const trimmed = text.trim();
  // The chip shows the spaces; the editor never makes a label that has them.
  if (trimmed !== text)
    reportLoss("dropped-source", `<${tagName}>${label}</${tagName}>`);
  return {
    type: "notionInlineAtom",
    attrs: {
      tagName,
      attrsJson: JSON.stringify(attrs),
      label: trimmed,
    },
  };
}

// A scan from one opener passes the same steps a scan from any opener inside
// it would, so it records their closers too in `closes`, and a line of
// unmatched openers is scanned once instead of once per opener. Each is kept
// at its opener's offset as the closer + 2, so 0 is unknown and 1 is none: a
// Map of every opener in a long line slows faster than the line grows.
type LinkCloses = { brackets: Int32Array; parens: Int32Array };

// A code span binds tighter than link text, as the editor writes code `]`
// under a link: [`]`](u). Math in link text and an image's alt read as main
// reads them: the editor writes neither.
function findMatchingBracketClose(
  s: string,
  start: number,
  closes: Int32Array = new Int32Array(s.length),
  codeRuns?: CodeRuns,
): number {
  if (closes[start]) return closes[start] - 2;
  const openers: number[] = [];
  for (let i = start; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    const skipTo = codeRuns ? codeSpanSkip(s, i, codeRuns) : -1;
    if (skipTo !== -1) {
      i = skipTo - 1;
      continue;
    }
    if (s[i] === "[") openers.push(i);
    else if (s[i] === "]") {
      closes[openers.pop()!] = i + 2;
      if (openers.length === 0) return i;
    }
  }
  for (const opener of openers) closes[opener] = 1;
  return -1;
}

function findMatchingParenClose(
  s: string,
  openParenIdx: number,
  closes: Int32Array = new Int32Array(s.length),
): number {
  if (closes[openParenIdx]) return closes[openParenIdx] - 2;
  const openers: number[] = [];
  for (let i = openParenIdx; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "(") openers.push(i);
    else if (s[i] === ")") {
      closes[openers.pop()!] = i + 2;
      if (openers.length === 0) return i;
    }
  }
  for (const opener of openers) closes[opener] = 1;
  return -1;
}

function hasBalancedParens(url: string): boolean {
  let depth = 0;
  for (let i = 0; i < url.length; i++) {
    if (url[i] === "(") depth++;
    else if (url[i] === ")") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function serializeUrlForParens(url: string): string {
  if (hasBalancedParens(url)) return url;
  return url.replace(/[()]/g, (ch) => "\\" + ch);
}

function unescapeUrlParens(url: string): string {
  return url.replace(/\\([()])/g, "$1");
}

function matchLink(
  s: string,
  start: number,
  closes: LinkCloses,
  codeRuns: CodeRuns,
): { text: string; href: string; end: number } | null {
  const closeBracket = findMatchingBracketClose(
    s,
    start,
    closes.brackets,
    codeRuns,
  );
  if (closeBracket === -1 || s[closeBracket + 1] !== "(") return null;
  const closeParen = findMatchingParenClose(s, closeBracket + 1, closes.parens);
  if (closeParen === -1) return null;
  return {
    text: s.slice(start + 1, closeBracket),
    href: unescapeUrlParens(s.slice(closeBracket + 2, closeParen)),
    end: closeParen + 1,
  };
}

const TAB = "\t";
function indentStr(n: number): string {
  return TAB.repeat(Math.max(0, n));
}

export interface NfmSerializeContext {
  serializeRegistryBlock?: (
    blockId: string,
    node: PMNode,
  ) => string | undefined | null;
  /** Write the trailing empty paragraph the editor's save drops. */
  keepTrailingEmptyBlock?: boolean;
}

/**
 * Appends without spreading: `push(...items)` passes each item as an argument,
 * and a long document has more blocks or lines than the stack holds.
 */
export function pushAll<T>(target: T[], items: readonly T[]) {
  for (const item of items) target.push(item);
}

let activeSerializeContext: NfmSerializeContext | null = null;

/** Text nodes the writer spelled differently because of their neighbors. */
export interface NfmContextualSpellings {
  /** Its line read as underscore emphasis, so every `_` became `\_`. */
  escapedUnderscores: ReadonlySet<PMNode>;
  /** It opens a paragraph that looked like block syntax, so a `\` precedes it. */
  escapedBlockMarker: ReadonlySet<PMNode>;
}

let contextualSpellings: {
  escapedUnderscores: Set<PMNode>;
  escapedBlockMarker: Set<PMNode>;
} | null = null;

/**
 * Which text nodes `docToNfm(doc)` spells in context. A caller that writes
 * each text node on its own, like the suggestion mapper, needs these to
 * reproduce the writer's bytes.
 */
export function nfmContextualSpellings(
  doc: PMDoc | PMNode,
): NfmContextualSpellings {
  const spellings = {
    escapedUnderscores: new Set<PMNode>(),
    escapedBlockMarker: new Set<PMNode>(),
  };
  const previous = contextualSpellings;
  contextualSpellings = spellings;
  try {
    docToNfm(doc);
  } finally {
    contextualSpellings = previous;
  }
  return spellings;
}

export function docToNfm(
  doc: PMDoc | PMNode | null | undefined,
  context?: NfmSerializeContext,
): string {
  const content = (doc?.content as PMNode[]) || [];
  const previous = activeSerializeContext;
  activeSerializeContext = context ?? null;
  try {
    const lines = serializeBlocks(content, 0, /* isTopLevel */ true);
    return lines.join("\n");
  } finally {
    activeSerializeContext = previous;
  }
}

function isEmptyParagraphNode(node: PMNode | undefined): boolean {
  if (!node || node.type !== "paragraph") return false;
  if (node.content?.length) return false;
  if (isColor(node.attrs?.color)) return false;
  return (Number(node.attrs?.indent) || 0) === 0;
}

function trimEditorTerminalFiller(blocks: PMNode[]): PMNode[] {
  if (blocks.length < 2) return blocks;
  const last = blocks[blocks.length - 1];
  const previous = blocks[blocks.length - 2];
  if (!isEmptyParagraphNode(last) || previous?.type === "paragraph") {
    return blocks;
  }
  return blocks.slice(0, -1);
}

function serializeBlocks(
  blocks: PMNode[],
  indent: number,
  isTopLevel = false,
): string[] {
  const out: string[] = [];
  const serializableBlocks =
    isTopLevel && !activeSerializeContext?.keepTrailingEmptyBlock
      ? trimEditorTerminalFiller(blocks)
      : blocks;
  for (let i = 0; i < serializableBlocks.length; i++) {
    const block = serializableBlocks[i];
    if (block.type === "bulletList" || block.type === "orderedList") {
      pushAll(out, serializeList(block, indent));
    } else if (block.type === "taskList") {
      pushAll(out, serializeTaskList(block, indent));
    } else {
      pushAll(out, serializeBlock(block, indent));
    }
  }
  return out;
}

function firstParagraph(node: PMNode): PMNode | null {
  const first = node.content?.[0];
  return first && first.type === "paragraph" ? first : null;
}

function serializeBlock(node: PMNode, indent: number): string[] {
  const extra = Number(node.attrs?.indent) || 0;
  const ind = indent + extra;

  switch (node.type) {
    case "paragraph": {
      const inline = serializeInline(node.content);
      if (!inline) return [indentStr(ind) + "<empty-block/>"];
      const escaped = escapeLeadingBlockMarker(inline);
      if (escaped !== inline && node.content?.[0])
        contextualSpellings?.escapedBlockMarker.add(node.content[0]);
      const suffix = blockAttrSuffix({ color: node.attrs?.color });
      // Text one space short of a block marker, like `#`, would become one
      // with the suffix's space, so the suffix goes on without it.
      const joined =
        escaped === inline &&
        escapeLeadingBlockMarker(`${inline} `) !== `${inline} `
          ? inline + suffix.trimStart()
          : escaped + suffix;
      return [indentStr(ind) + joined];
    }
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      const inline = serializeInline(node.content);
      return [
        indentStr(ind) +
          "#".repeat(level) +
          " " +
          inline +
          blockAttrSuffix({ color: node.attrs?.color }),
      ];
    }
    case "horizontalRule":
      return [indentStr(ind) + "---"];
    case "codeBlock": {
      const lang = (node.attrs?.language as string) || "";
      const text = (node.content || []).map((t) => t.text || "").join("");
      const body = text.split("\n").map((l) => indentStr(ind) + l);
      // A backtick fence's language cannot hold a backtick, so a language
      // with one takes a tilde fence, spaced off when it starts with a tilde
      // that would lengthen the fence.
      const marker = lang.includes("`") ? "~" : "`";
      const fence = marker.repeat(
        Math.max(3, longestRun(text, marker === "`" ? /`+/g : /~+/g) + 1),
      );
      const gap = lang.startsWith(marker) ? " " : "";
      return [
        indentStr(ind) + fence + gap + lang,
        ...body,
        indentStr(ind) + fence,
      ];
    }
    case "blockquote":
      return serializeQuote(node, ind);
    case "notionToggle":
      return serializeToggle(node, ind);
    case "notionCallout":
      return serializeCallout(node, ind);
    case "notionColumns":
      return serializeColumns(node, ind);
    case "notionColumn": {
      const out = [indentStr(ind) + "<column>"];
      pushAll(out, serializeBlocks(node.content || [], ind + 1));
      out.push(indentStr(ind) + "</column>");
      return out;
    }
    case "notionSyncedBlock":
      return serializeSynced(node, ind);
    case "table":
      return serializeTable(node, ind);
    case "image":
      return serializeImage(node, ind);
    case "video":
    case "audio":
      return serializeMedia(node, ind);
    case "notionBlockAtom":
      return serializeBlockAtom(node, ind);
    case "registryBlock":
      return serializeRegistryBlock(node, ind);
    case "contentReference":
    case "localMdxComponent":
      return serializeRawSourceBlock(node, ind);
    default: {
      const raw = serializeRawSourceBlock(node, ind);
      if (raw.length > 0) return raw;
      const inline = serializeInline(node.content);
      return inline ? [indentStr(ind) + inline] : [];
    }
  }
}

function serializeQuote(node: PMNode, ind: number): string[] {
  const textPara = firstParagraph(node);
  const out: string[] = [];
  const inline = textPara ? serializeInline(textPara.content) : "";
  out.push(
    indentStr(ind) +
      "> " +
      inline +
      blockAttrSuffix({ color: node.attrs?.color }),
  );
  const children = textPara
    ? (node.content || []).slice(1)
    : node.content || [];
  pushAll(out, serializeBlocks(children, ind + 1));
  return out;
}

function serializeToggle(node: PMNode, ind: number): string[] {
  const summary = (node.attrs?.summary as string) || "";
  const headingLevel = Number(node.attrs?.headingLevel) || 0;
  const color = node.attrs?.color;
  const out: string[] = [];
  if (headingLevel >= 1 && headingLevel <= 4) {
    out.push(
      indentStr(ind) +
        "#".repeat(headingLevel) +
        " " +
        escapeTrailingBackslashRun(summary) +
        blockAttrSuffix({ toggle: true, color }),
    );
    pushAll(out, serializeBlocks(node.content || [], ind + 1));
    return out;
  }
  const attrStr = serializeAttrs([["color", isColor(color) ? color : null]]);
  const openAttr = node.attrs?.open === true ? " open" : "";
  out.push(indentStr(ind) + `<details${attrStr}${openAttr}>`);
  out.push(indentStr(ind) + `<summary>${summary}</summary>`);
  pushAll(out, serializeBlocks(node.content || [], ind + 1));
  out.push(indentStr(ind) + "</details>");
  return out;
}

function serializeCallout(node: PMNode, ind: number): string[] {
  const icon = (node.attrs?.icon as string) ?? "";
  const color = node.attrs?.color;
  const attrStr = serializeAttrs([
    ["icon", icon || null],
    ["color", isColor(color) ? color : null],
  ]);
  const out = [indentStr(ind) + `<callout${attrStr}>`];
  pushAll(out, serializeBlocks(node.content || [], ind + 1));
  out.push(indentStr(ind) + "</callout>");
  return out;
}

function serializeColumns(node: PMNode, ind: number): string[] {
  const out = [indentStr(ind) + "<columns>"];
  pushAll(out, serializeBlocks(node.content || [], ind + 1));
  out.push(indentStr(ind) + "</columns>");
  return out;
}

function serializeSynced(node: PMNode, ind: number): string[] {
  const tag = node.attrs?.isReference
    ? "synced_block_reference"
    : "synced_block";
  const attrStr = serializeAttrs([
    ["url", node.attrs?.url || null],
    ["notice", node.attrs?.notice || null],
  ]);
  const out = [indentStr(ind) + `<${tag}${attrStr}>`];
  pushAll(out, serializeBlocks(node.content || [], ind + 1));
  out.push(indentStr(ind) + `</${tag}>`);
  return out;
}

function serializeImage(node: PMNode, ind: number): string[] {
  const src = (node.attrs?.src as string) || "";
  const alt = (node.attrs?.alt as string) || "";
  const color = node.attrs?.color;
  const suffix = isColor(color) ? ` {color="${color}"}` : "";
  return [
    indentStr(ind) +
      `![${escapeInlineText(alt)}](${serializeUrlForParens(src)})${suffix}`,
  ];
}

function serializeMedia(node: PMNode, ind: number): string[] {
  const tag = node.type;
  const src = (node.attrs?.src as string) || "";
  const caption = (node.attrs?.title as string) || "";
  const color = node.attrs?.color;
  const attrStr = serializeAttrs([
    ["src", src],
    ["color", isColor(color) ? color : null],
  ]);
  return [
    indentStr(ind) +
      `<${tag}${attrStr}>${caption ? escapeAttr(caption) : ""}</${tag}>`,
  ];
}

function serializeBlockAtom(node: PMNode, ind: number): string[] {
  const raw = serializeRawSourceBlock(node, ind);
  if (raw.length > 0) return raw;

  const tagName = (node.attrs?.tagName as string) || "unknown";
  const label = (node.attrs?.label as string) || "";
  let attrs: Record<string, string> = {};
  try {
    attrs = JSON.parse((node.attrs?.attrsJson as string) || "{}");
  } catch {
    attrs = {};
  }

  if (tagName === "equation") {
    const latex = label || attrs.latex || "";
    return [
      indentStr(ind) + "$$",
      ...latex.split("\n").map((l) => indentStr(ind) + l),
      indentStr(ind) + "$$",
    ];
  }

  const rawEntries = Object.entries(attrs);
  const attrStr = serializeAttrs(rawEntries);
  if (label.trim()) {
    return [
      indentStr(ind) +
        `<${tagName}${attrStr}>${escapeAttr(label)}</${tagName}>`,
    ];
  }
  return [indentStr(ind) + `<${tagName}${attrStr}/>`];
}

function serializeRegistryBlock(node: PMNode, ind: number): string[] {
  const blockId = (node.attrs?.blockId as string) || "";
  const fromContext =
    activeSerializeContext?.serializeRegistryBlock?.(blockId, node) ?? null;
  const mdx =
    typeof fromContext === "string" && fromContext.length > 0
      ? fromContext
      : typeof node.attrs?.__raw === "string"
        ? (node.attrs.__raw as string)
        : "";
  if (!mdx) return [];
  return mdx.split("\n").map((l) => (l.length ? indentStr(ind) + l : l));
}

function serializeRawSourceBlock(node: PMNode, ind: number): string[] {
  if (typeof node.attrs?.__raw !== "string" || !node.attrs.__raw) return [];
  return (node.attrs.__raw as string)
    .split("\n")
    .map((l) => (l.length ? indentStr(ind) + l : l));
}

function serializeList(node: PMNode, indent: number): string[] {
  const ordered = node.type === "orderedList";
  const start = ordered ? Number(node.attrs?.start) || 1 : 0;
  const out: string[] = [];
  let n = start;
  for (const item of node.content || []) {
    const textPara = firstParagraph(item);
    const inline = textPara ? serializeInline(textPara.content) : "";
    const color = textPara?.attrs?.color;
    const marker = ordered ? `${n}. ` : "- ";
    out.push(indentStr(indent) + marker + inline + blockAttrSuffix({ color }));
    const children = textPara
      ? (item.content || []).slice(1)
      : item.content || [];
    pushAll(out, serializeBlocks(children, indent + 1));
    n++;
  }
  return out;
}

function serializeTaskList(node: PMNode, indent: number): string[] {
  const out: string[] = [];
  for (const item of node.content || []) {
    const checked = !!item.attrs?.checked;
    const textPara = firstParagraph(item);
    const inline = textPara ? serializeInline(textPara.content) : "";
    const color = textPara?.attrs?.color;
    out.push(
      indentStr(indent) +
        `- [${checked ? "x" : " "}] ` +
        inline +
        blockAttrSuffix({ color }),
    );
    const children = textPara
      ? (item.content || []).slice(1)
      : item.content || [];
    pushAll(out, serializeBlocks(children, indent + 1));
  }
  return out;
}

// A cell reads back as one line, so its children share one underscore check.
function serializeCellInline(cell: PMNode, escapeUnderscore = false): string {
  const parts: string[] = [];
  for (const child of cell.content || []) {
    const part = serializeCellChildInline(child, escapeUnderscore);
    if (part) parts.push(part);
  }
  const source = parts.join("<br>");
  return escapeUnderscore || !readsUnderscoreEmphasis(source)
    ? source
    : serializeCellInline(cell, true);
}

function serializeCellChildInline(
  node: PMNode,
  escapeUnderscore: boolean,
): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return serializeInline(node.content, escapeUnderscore);
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const items: string[] = [];
      for (const item of node.content || []) {
        const textPara = firstParagraph(item);
        const inline = textPara
          ? serializeInline(textPara.content, escapeUnderscore)
          : "";
        if (inline) items.push(inline);
      }
      return items.join("<br>");
    }
    case "blockquote": {
      const parts: string[] = [];
      for (const child of node.content || []) {
        const part = serializeCellChildInline(child, escapeUnderscore);
        if (part) parts.push(part);
      }
      return parts.join("<br>");
    }
    default:
      return serializeInline(node.content, escapeUnderscore);
  }
}

function serializeTable(node: PMNode, ind: number): string[] {
  const attrs = node.attrs || {};
  const tableAttrStr = serializeAttrs([
    ["fit-page-width", attrs.fitPageWidth ? "true" : null],
    ["header-row", attrs.headerRow ? "true" : null],
    ["header-column", attrs.headerColumn ? "true" : null],
  ]);
  const out = [indentStr(ind) + `<table${tableAttrStr}>`];

  const colMeta: Array<{ color?: string; width?: string }> = Array.isArray(
    attrs.colMeta,
  )
    ? attrs.colMeta
    : [];
  if (colMeta.some((c) => c && (c.color || c.width))) {
    out.push(indentStr(ind) + "<colgroup>");
    for (const col of colMeta) {
      const colAttrStr = serializeAttrs([
        ["color", col && isColor(col.color) ? col.color : null],
        ["width", col && col.width ? col.width : null],
      ]);
      out.push(indentStr(ind) + `<col${colAttrStr}/>`);
    }
    out.push(indentStr(ind) + "</colgroup>");
  }

  for (const row of node.content || []) {
    const rowAttrStr = serializeAttrs([
      ["color", isColor(row.attrs?.color) ? row.attrs?.color : null],
    ]);
    out.push(indentStr(ind) + `<tr${rowAttrStr}>`);
    for (const cell of row.content || []) {
      const cellColor = isColor(cell.attrs?.color) ? cell.attrs?.color : null;
      const inline = serializeCellInline(cell);
      const cellAttrStr = serializeAttrs([
        ["color", cellColor],
        [
          "align",
          isTableAlignment(cell.attrs?.textAlign) ? cell.attrs.textAlign : null,
        ],
      ]);
      out.push(indentStr(ind) + `<td${cellAttrStr}>${inline}</td>`);
    }
    out.push(indentStr(ind) + "</tr>");
  }
  out.push(indentStr(ind) + "</table>");
  return out;
}

function leadingTabs(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === "\t") n++;
  return n;
}

// Code fences open with three or more backticks or tildes, and close with at
// least as many of the same character.
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^(`{3,}|~{3,})\s*$/;

// A backtick fence's language holds no backtick, so a line that starts with
// a long code span, as the editor writes ``` `` ```, stays a paragraph.
function matchFenceOpen(line: string): RegExpMatchArray | null {
  const open = line.match(FENCE_OPEN);
  return open && open[1][0] === "`" && open[2].includes("`") ? null : open;
}

function closesFence(
  close: RegExpMatchArray | null,
  marker: string,
): close is RegExpMatchArray {
  return (
    !!close && close[1][0] === marker[0] && close[1].length >= marker.length
  );
}

export function nfmToDoc(nfm: string | null | undefined): PMDoc {
  const lines = (nfm ?? "").replace(/\r\n?/g, "\n").split("\n");
  const { nodes } = parseBlockSequence(lines, 0, 0);
  return {
    type: "doc",
    content: nodes.length ? nodes : [{ type: "paragraph" }],
  };
}

/** `nfmToDoc`, with the source it read but could not keep. */
export function parseNfmWithLosses(nfm: string | null | undefined): {
  doc: PMDoc;
  losses: NfmParseLoss[];
} {
  const previous = activeLossSink;
  const losses: NfmParseLoss[] = [];
  activeLossSink = losses;
  try {
    return { doc: nfmToDoc(nfm), losses };
  } finally {
    activeLossSink = previous;
  }
}

interface ParseResult {
  nodes: PMNode[];
  end: number;
}

const CONTAINER_CLOSE: Record<string, string> = {
  "<details": "</details>",
  "<callout": "</callout>",
  "<columns>": "</columns>",
  "<column>": "</column>",
  "<table": "</table>",
  "<synced_block_reference": "</synced_block_reference>",
  "<synced_block": "</synced_block>",
  "<meeting-notes>": "</meeting-notes>",
};

function parseBlockSequence(
  lines: string[],
  start: number,
  baseIndent: number,
): ParseResult {
  const out: PMNode[] = [];
  let i = start;

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === "") {
      i++;
      continue;
    }
    const ind = leadingTabs(raw);
    if (ind < baseIndent) break;

    const dedent = raw.slice(ind);
    const rel = ind - baseIndent;

    const pipeTable = parseGfmPipeTable(lines, i, ind, rel);
    if (pipeTable) {
      out.push(pipeTable.nodes[0]);
      i = pipeTable.end;
      continue;
    }

    const listKind =
      listKindOf(dedent) ?? listKindOf(dedent.replace(/^ {1,3}/, ""));
    if (listKind) {
      const res = parseList(lines, i, ind, listKind);
      out.push(res.nodes[0]);
      i = res.end;
      continue;
    }

    const res = parseSingleBlock(lines, i, ind, rel);
    pushAll(out, res.nodes);
    i = res.end;
  }

  return { nodes: out, end: i };
}

function parseDetailsBody(
  lines: string[],
  start: number,
  end: number,
  parentIndent: number,
): PMNode[] {
  const childIndent = parentIndent + 1;
  const nestedContainers: Array<{ tagKey: string; closeTag: string }> = [];
  let fence: { marker: string; promoteBy: number } | undefined;
  const sourceLines = lines.slice(start, end);
  // By tag, whether each opener has its close. A scan from one opener passes a
  // same-tag opener inside it as a scan from that one would, so it answers for
  // that one too.
  const matched = new Map<string, Map<number, boolean>>();
  const hasMatchingClose = (from: number, tagKey: string): boolean => {
    let known = matched.get(tagKey);
    if (!known) matched.set(tagKey, (known = new Map()));
    if (!known.has(from)) {
      const closeTag = CONTAINER_CLOSE[tagKey];
      const openers = [from];
      let fenceMarker = "";
      for (let i = from + 1; i < sourceLines.length && openers.length; i++) {
        const candidate = sourceLines[i].slice(leadingTabs(sourceLines[i]));
        const fenceMatch = matchFenceOpen(candidate);
        if (fenceMarker) {
          if (
            fenceMatch &&
            !fenceMatch[2].trim() &&
            closesFence(fenceMatch, fenceMarker)
          ) {
            fenceMarker = "";
          }
          continue;
        }
        if (fenceMatch) {
          fenceMarker = fenceMatch[1];
          continue;
        }
        if (matchContainerOpen(candidate) === tagKey) openers.push(i);
        else if (candidate === closeTag) known.set(openers.pop()!, true);
      }
      for (const opener of openers) known.set(opener, false);
    }
    return known.get(from)!;
  };
  // Lines inside a container too deep to read need no more tabs: one more per
  // level would make each line as long as the nesting is deep.
  const nestedIndent = (depth: number) =>
    Math.min(childIndent + depth, MAX_CONTAINER_INDENT + 1);
  const bodyLines = sourceLines.map((line, lineIndex) => {
    const indent = leadingTabs(line);
    const dedented = line.slice(indent);
    if (fence) {
      const requiredIndent = nestedIndent(nestedContainers.length);
      const promoteBy =
        fence.promoteBy > 0
          ? fence.promoteBy
          : Math.max(0, requiredIndent - indent);
      const promoted = `${"\t".repeat(promoteBy)}${line}`;
      if (closesFence(dedented.match(FENCE_CLOSE), fence.marker))
        fence = undefined;
      return promoted;
    }
    if (nestedContainers[nestedContainers.length - 1]?.closeTag === dedented) {
      nestedContainers.pop();
    }
    const detailsSummary =
      nestedContainers[nestedContainers.length - 1]?.tagKey === "<details" &&
      /^<summary>[\s\S]*<\/summary>\s*$/.test(dedented);
    const requiredIndent = nestedIndent(
      nestedContainers.length - (detailsSummary ? 1 : 0),
    );
    const open = matchFenceOpen(dedented);
    if (open) {
      const promoteBy = Math.max(0, requiredIndent - indent);
      fence = { marker: open[1], promoteBy };
      return `${"\t".repeat(promoteBy)}${line}`;
    }
    if (!line.trim()) return line;
    const tagKey = matchContainerOpen(dedented);
    if (
      tagKey &&
      tagKey !== "<table" &&
      tagKey !== "<meeting-notes>" &&
      hasMatchingClose(lineIndex, tagKey)
    ) {
      nestedContainers.push({ tagKey, closeTag: CONTAINER_CLOSE[tagKey] });
    }
    if (indent >= requiredIndent) return line;
    return `${"\t".repeat(requiredIndent - indent)}${line}`;
  });
  return parseBlockSequence(bodyLines, 0, childIndent).nodes;
}

function endsWithUnescapedPipe(value: string): boolean {
  if (!value.endsWith("|")) return false;
  let backslashes = 0;
  for (let i = value.length - 2; i >= 0 && value[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 0;
}

// Where a pipe row's last backtick run of each length starts, read as the row
// is: a backslash takes the next character with it. A run opens code when a
// later run of its length closes it, and searching the rest of the row from
// every run is quadratic in a row of runs of many lengths.
function lastBacktickRuns(value: string): Map<number, number> {
  const last = new Map<number, number>();
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\") {
      i++;
      continue;
    }
    if (value[i] !== "`") continue;
    const run = delimiterRunLength(value, i, "`");
    last.set(run, i);
    i += run - 1;
  }
  return last;
}

export function splitGfmPipeRow(line: string): string[] | null {
  const value = line.trim();
  if (!value) return null;

  const cells: string[] = [];
  let cell = "";
  let codeFenceLength = 0;
  let sawSeparator = false;
  const lastRuns = lastBacktickRuns(value);

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && i + 1 < value.length) {
      cell += char + value[++i];
      continue;
    }
    if (char === "`") {
      let runLength = 1;
      while (value[i + runLength] === "`") runLength++;
      if (codeFenceLength === 0 && (lastRuns.get(runLength) ?? -1) > i)
        codeFenceLength = runLength;
      else if (codeFenceLength === runLength) codeFenceLength = 0;
      cell += "`".repeat(runLength);
      i += runLength - 1;
      continue;
    }
    if (char === "|" && codeFenceLength === 0) {
      cells.push(cell.trim());
      cell = "";
      sawSeparator = true;
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());

  if (!sawSeparator) return null;
  if (value.startsWith("|")) cells.shift();
  if (endsWithUnescapedPipe(value)) cells.pop();
  return cells;
}

function isGfmDelimiterCell(value: string): boolean {
  return /^-+$/.test(value.trim());
}

function isAlignedGfmDelimiterCell(value: string): boolean {
  return /^:?-+:?$/.test(value.trim()) && value.includes(":");
}

function isTableAlignment(
  value: unknown,
): value is "left" | "center" | "right" {
  return value === "left" || value === "center" || value === "right";
}

function parseGfmPipeTable(
  lines: string[],
  start: number,
  indent: number,
  rel: number,
): ParseResult | null {
  if (start + 1 >= lines.length) return null;
  if (leadingTabs(lines[start + 1]) !== indent) return null;

  const header = splitGfmPipeRow(lines[start].slice(indent));
  const delimiter = splitGfmPipeRow(lines[start + 1].slice(indent));
  if (
    !header ||
    !delimiter ||
    header.length === 0 ||
    header.length !== delimiter.length ||
    !delimiter.every(
      (cell) => isGfmDelimiterCell(cell) || isAlignedGfmDelimiterCell(cell),
    )
  ) {
    return null;
  }

  const rows = [header];
  let end = start + 2;
  while (end < lines.length) {
    if (lines[end].trim() === "" || leadingTabs(lines[end]) !== indent) break;
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(lines[end].slice(indent))) break;
    const row = splitGfmPipeRow(lines[end].slice(indent));
    if (!row) break;
    rows.push(row);
    end++;
  }

  // Not Math.max(...rows): a long table has more rows than a call can take
  // arguments.
  let columnCount = header.length;
  for (const row of rows) columnCount = Math.max(columnCount, row.length);
  const alignments = delimiter.map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    if (cell.startsWith(":")) return "left";
    return null;
  });
  const tableRows = rows.map((row, rowIndex) => ({
    type: "tableRow",
    attrs: { color: null },
    content: Array.from({ length: columnCount }, (_, index) => ({
      type: rowIndex === 0 ? "tableHeader" : "tableCell",
      attrs: { color: null, textAlign: alignments[index] ?? null },
      content: [{ type: "paragraph", content: parseInline(row[index] ?? "") }],
    })),
  }));
  const attrs: Record<string, unknown> = {
    headerRow: true,
    headerColumn: false,
    fitPageWidth: false,
    colMeta: null,
  };
  if (rel > 0) attrs.indent = rel;
  return {
    nodes: [{ type: "table", attrs, content: tableRows }],
    end,
  };
}

type ListKind = "bullet" | "ordered" | "task";
function listKindOf(dedent: string): ListKind | null {
  if (/^- \[[ xX]\]\s/.test(dedent)) return "task";
  if (/^[-*+] /.test(dedent)) return "bullet";
  if (/^\d+[.)] /.test(dedent)) return "ordered";
  return null;
}

/** Columns from a list marker to its item's text, as CommonMark counts them. */
function listItemContentOffset(item: string): number {
  const m = item.match(/^([-*+]|\d+[.)])( *)(.?)/);
  if (!m) return 0;
  const gap = m[2].length;
  return m[1].length + (gap > 4 || !m[3] ? 1 : gap);
}

const spacedLineIndexes = new WeakMap<string[], Int32Array>();

// For each line, the first line at or after it whose tabs are followed by a
// space: only those are rewritten, so a run with none ahead has nothing to do.
// A rewrite never makes a line spaced that was not, so the index computed for
// the array as given stays a safe bound while its lines are rewritten.
function spacedLinesFrom(lines: string[]): Int32Array {
  let next = spacedLineIndexes.get(lines);
  if (next) return next;
  next = new Int32Array(lines.length + 1);
  next[lines.length] = lines.length;
  for (let i = lines.length - 1; i >= 0; i--)
    next[i] = /^\t* /.test(lines[i]) ? i : next[i + 1];
  spacedLineIndexes.set(lines, next);
  return next;
}

const lineTabCounts = new WeakMap<string[], Int32Array>();

// Each line's leading tabs, kept in step with the rewrites below. Every list
// depth scans the lines nested under it, so measuring a line again at each
// depth makes a deeply nested page cubic.
function tabCountsOf(lines: string[]): Int32Array {
  let counts = lineTabCounts.get(lines);
  if (counts) return counts;
  counts = new Int32Array(lines.length);
  for (let i = 0; i < lines.length; i++) counts[i] = leadingTabs(lines[i]);
  lineTabCounts.set(lines, counts);
  return counts;
}

type FenceCloses = {
  // Each line's closing marker length, or 0.
  length: Int32Array;
  // The first closing line at or after each line.
  first: Int32Array;
  // After each closing line, the next one with a longer marker.
  longer: Int32Array;
};

// What each line's text says, read without its leading whitespace, which the
// rewrites below never change. Every list depth steps over the lines nested
// under it, and a blank line or a fence's body costs no indentation, so
// reading them again at each depth is quadratic.
type LineIndex = {
  // The first line at or after each line with text.
  filled: Int32Array;
  // Each line's opening fence marker, as `matchFenceOpen` reads it.
  fenceOpens: Array<string | null>;
  fenceCloses: Record<string, FenceCloses>;
};

const lineIndexes = new WeakMap<string[], LineIndex>();

function lineIndexOf(lines: string[]): LineIndex {
  let index = lineIndexes.get(lines);
  if (index) return index;
  const filled = new Int32Array(lines.length + 1);
  const fenceOpens: Array<string | null> = [];
  const fenceCloses: Record<string, FenceCloses> = {};
  for (const char of ["`", "~"]) {
    fenceCloses[char] = {
      length: new Int32Array(lines.length),
      first: new Int32Array(lines.length + 1),
      longer: new Int32Array(lines.length),
    };
  }
  for (let i = 0; i < lines.length; i++) {
    fenceOpens.push(matchFenceOpen(lines[i].trimStart())?.[1] ?? null);
    const close = lines[i].trim().match(FENCE_CLOSE);
    if (close) fenceCloses[close[1][0]].length[i] = close[1].length;
  }
  filled[lines.length] = lines.length;
  for (let i = lines.length - 1; i >= 0; i--)
    filled[i] = lines[i].trim() ? i : filled[i + 1];
  for (const { length, first, longer } of Object.values(fenceCloses)) {
    first[lines.length] = lines.length;
    const ahead: number[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      first[i] = length[i] ? i : first[i + 1];
      if (!length[i]) continue;
      while (ahead.length && length[ahead[ahead.length - 1]] <= length[i])
        ahead.pop();
      longer[i] = ahead.length ? ahead[ahead.length - 1] : lines.length;
      ahead.push(i);
    }
  }
  index = { filled, fenceOpens, fenceCloses };
  lineIndexes.set(lines, index);
  return index;
}

// The first line after `open` that closes a fence of `marker`, or the page's
// end. Each step reaches a longer marker, so the steps are fewer than the
// marker's length.
function fenceCloseAfter(
  index: LineIndex,
  open: number,
  marker: string,
): number {
  const { length, first, longer } = index.fenceCloses[marker[0]];
  let at = first[open + 1];
  while (at < length.length && length[at] < marker.length) at = longer[at];
  return at;
}

// The parse takes a few call frames per depth, and nesting by spaces would
// otherwise overflow the stack on pages main reads. Past this depth, which no
// page needs, space-indented lines read as main reads them, and the loss is
// reported.
const MAX_SPACE_NESTED_DEPTH = 256;

// Agents nest list items with spaces, and CommonMark puts a line inside the
// innermost item whose text column it reaches. The parser nests by tabs, so
// a list run's space-indented lines are rewritten as the tab-indented lines
// the editor writes. A line without a marker joins an item only after a blank
// line, since the editor never writes one and CommonMark would otherwise read
// it as more of the item's text. Lines are rewritten in place, and the
// returned originals must be put back once the run is parsed: copying the
// array for every run makes a long page of short lists quadratic.
function normalizeSpaceIndentedListRun(
  lines: string[],
  start: number,
  indent: number,
  kind: ListKind,
): Map<number, string> {
  const originals = new Map<number, string>();
  const write = (index: number, depth: number, text: string) => {
    if (!originals.has(index)) {
      if (originals.size === 0) containerCloseLayers(lines).push(new Map());
      originals.set(index, lines[index]);
    }
    lines[index] = "\t".repeat(depth) + text;
    tabCounts[index] = depth + leadingTabs(text);
  };
  const spaced = spacedLinesFrom(lines);
  if (spaced[start] === lines.length) return originals;
  const tabCounts = tabCountsOf(lines);
  const index = lineIndexOf(lines);
  const open: Array<{ content: number; depth: number }> = [];
  let blank = false;
  let continuing = false;
  for (let i = start; i < lines.length && spaced[i] < lines.length; i++) {
    if (index.filled[i] !== i) {
      blank = true;
      i = index.filled[i] - 1;
      continue;
    }
    const line = lines[i];
    const tabs = tabCounts[i];
    if (tabs < indent) break;
    const afterBlank = blank;
    blank = false;
    if (tabs > indent) {
      while (open.length && open[open.length - 1].depth >= tabs) open.pop();
      continuing = false;
      // A marker read without the line's leading whitespace is the one read
      // after its tabs only when nothing else comes before it.
      const fence =
        line[tabs] === "`" || line[tabs] === "~" ? index.fenceOpens[i] : null;
      if (fence) i = fenceCloseAfter(index, i, fence);
      continue;
    }
    const afterTabs = line.slice(tabs);
    let spaces = 0;
    while (afterTabs[spaces] === " ") spaces++;
    const text = afterTabs.slice(spaces);
    if (text[0] === "\t") break;
    const item = listKindOf(text) !== null;
    if (spaces === 0) {
      if (listKindOf(text) !== kind) break;
      open.length = 0;
      open.push({ content: listItemContentOffset(text), depth: indent });
      continuing = false;
      continue;
    }
    while (open.length && spaces < open[open.length - 1].content) open.pop();
    const parent = open[open.length - 1];
    if (!parent) {
      if (listKindOf(text) !== kind || spaces > 3) break;
      write(i, indent, text);
      open.push({
        content: spaces + listItemContentOffset(text),
        depth: indent,
      });
      continuing = false;
      continue;
    }
    const depth = parent.depth + 1;
    if (depth > MAX_SPACE_NESTED_DEPTH) {
      reportLoss("dropped-formatting", text);
      break;
    }
    if (item) {
      write(i, depth, text);
      open.push({ content: spaces + listItemContentOffset(text), depth });
      continuing = false;
      continue;
    }
    const fence = matchFenceOpen(text);
    if (fence) {
      // An unclosed fence runs to the page's end in the tab form, so one
      // whose item ends first reads as on main and takes nothing with it.
      if (
        fenceLeavesItem(
          lines,
          tabCounts,
          index,
          i,
          indent,
          parent.content,
          fence[1],
        )
      )
        break;
      write(i, depth, text);
      for (i++; i < lines.length; i++) {
        const tabs = tabCounts[i];
        const closes = closesFence(
          lines[i].slice(tabs).trim().match(FENCE_CLOSE),
          fence[1],
        );
        const body = lines[i].slice(Math.min(indent, tabs));
        let strip = 0;
        while (strip < spaces && body[strip] === " ") strip++;
        write(i, depth, body.slice(strip));
        if (closes) break;
      }
      continuing = false;
      continue;
    }
    if (text.startsWith(">")) {
      write(i, depth, text);
      continuing = false;
      continue;
    }
    if (!afterBlank && !continuing) break;
    write(i, depth, text);
    continuing = true;
  }
  return originals;
}

function fenceLeavesItem(
  lines: string[],
  tabCounts: Int32Array,
  index: LineIndex,
  open: number,
  indent: number,
  content: number,
  marker: string,
): boolean {
  const close = fenceCloseAfter(index, open, marker);
  for (let i = index.filled[open + 1]; i < close; i = index.filled[i + 1]) {
    const line = lines[i];
    const tabs = tabCounts[i];
    if (tabs < indent) return true;
    if (tabs > indent) continue;
    let spaces = 0;
    while (line[indent + spaces] === " ") spaces++;
    if (spaces < content) return true;
  }
  return false;
}

function parseList(
  lines: string[],
  start: number,
  indent: number,
  kind: ListKind,
): ParseResult {
  const originals = normalizeSpaceIndentedListRun(lines, start, indent, kind);
  const items: PMNode[] = [];
  let i = start;
  let orderedStart: number | null = null;

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === "") {
      i++;
      continue;
    }
    const ind = leadingTabs(raw);
    if (ind !== indent) break;
    const dedent = raw.slice(ind);
    if (listKindOf(dedent) !== kind) break;

    let itemText: string;
    let checked = false;
    if (kind === "task") {
      const m = dedent.match(/^- \[([ xX])\]\s(.*)$/);
      checked = m ? m[1].toLowerCase() === "x" : false;
      itemText = m ? m[2] : "";
    } else if (kind === "ordered") {
      const m = dedent.match(/^(\d+)[.)] (.*)$/);
      if (orderedStart === null && m) orderedStart = Number(m[1]);
      itemText = m ? m[2] : "";
    } else {
      itemText = dedent.replace(/^[-*+] /, "");
    }

    const { text, color } = splitBlockAttrs(itemText);
    const para: PMNode = { type: "paragraph", content: parseInline(text) };
    if (isColor(color)) para.attrs = { color };

    const childRes = parseBlockSequence(lines, i + 1, indent + 1);
    const itemContent: PMNode[] = [para, ...childRes.nodes];

    if (kind === "task") {
      items.push({
        type: "taskItem",
        attrs: { checked },
        content: itemContent,
      });
    } else {
      items.push({ type: "listItem", content: itemContent });
    }
    i = childRes.end;
  }
  // No try/finally: it grows this recursive frame, and a parse that throws
  // abandons its lines anyway.
  const tabCounts = tabCountsOf(lines);
  for (const [index, line] of originals) {
    lines[index] = line;
    tabCounts[index] = leadingTabs(line);
  }
  if (originals.size > 0) containerCloseLayers(lines).pop();

  if (kind === "task") {
    return { nodes: [{ type: "taskList", content: items }], end: i };
  }
  if (kind === "ordered") {
    const node: PMNode = { type: "orderedList", content: items };
    if (orderedStart && orderedStart !== 1)
      node.attrs = { start: orderedStart };
    return { nodes: [node], end: i };
  }
  return { nodes: [{ type: "bulletList", content: items }], end: i };
}

function parseSingleBlock(
  lines: string[],
  start: number,
  indent: number,
  rel: number,
): ParseResult {
  const raw = lines[start];
  const dedent = raw.slice(indent);
  const withIndentAttr = (node: PMNode): PMNode => {
    if (rel > 0) node.attrs = { ...(node.attrs || {}), indent: rel };
    return node;
  };

  const emptyBlock = dedent.match(/^<empty-block\s*\/?>/);
  if (emptyBlock) {
    const rest = dedent.slice(emptyBlock[0].length).trim();
    if (rest) reportLoss("dropped-source", rest);
    return { nodes: [withIndentAttr({ type: "paragraph" })], end: start + 1 };
  }

  if (/^(---+|\*\*\*+|___+)$/.test(dedent.trim())) {
    return {
      nodes: [withIndentAttr({ type: "horizontalRule" })],
      end: start + 1,
    };
  }

  const fenceOpenMatch = matchFenceOpen(dedent);
  if (fenceOpenMatch) {
    const marker = fenceOpenMatch[1];
    const lang = fenceOpenMatch[2].trim();
    const body: string[] = [];
    let i = start + 1;
    for (; i < lines.length; i++) {
      const l = lines[i];
      const ld = l.slice(Math.min(indent, leadingTabs(l)));
      if (
        closesFence(ld.trim().match(FENCE_CLOSE), marker) &&
        leadingTabs(l) >= indent
      )
        break;
      body.push(stripTabs(l, indent));
    }
    const code = body.join("\n");
    const node: PMNode = {
      type: "codeBlock",
      attrs: { language: lang || null },
      content: code ? [{ type: "text", text: code }] : [],
    };
    return { nodes: [withIndentAttr(node)], end: i + 1 };
  }

  if (dedent.trim() === "$$") {
    const body: string[] = [];
    let i = start + 1;
    for (; i < lines.length; i++) {
      if (
        lines[i].slice(indent).trim() === "$$" &&
        leadingTabs(lines[i]) >= indent
      )
        break;
      body.push(stripTabs(lines[i], indent));
    }
    const node: PMNode = {
      type: "notionBlockAtom",
      attrs: {
        tagName: "equation",
        attrsJson: "{}",
        label: body.join("\n"),
      },
    };
    return { nodes: [withIndentAttr(node)], end: i + 1 };
  }

  const headingMatch = dedent.match(/^(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const { text, toggle, color } = splitBlockAttrs(headingMatch[2], true);
    if (toggle) {
      const childRes = parseBlockSequence(lines, start + 1, indent + 1);
      const node: PMNode = {
        type: "notionToggle",
        attrs: {
          summary: unescapeTrailingBackslashRun(text),
          headingLevel: level,
          open: false,
          color: isColor(color) ? color : null,
          indent: 0,
        },
        content: childRes.nodes,
      };
      return { nodes: [withIndentAttr(node)], end: childRes.end };
    }
    const node: PMNode = {
      type: "heading",
      attrs: { level, ...(isColor(color) ? { color } : {}) },
      content: parseInline(text),
    };
    return { nodes: [withIndentAttr(node)], end: start + 1 };
  }

  if (/^> /.test(dedent) || dedent === ">") {
    const { text, color } = splitBlockAttrs(dedent.replace(/^>\s?/, ""));
    const textPara: PMNode = { type: "paragraph", content: parseInline(text) };
    const childRes = parseBlockSequence(lines, start + 1, indent + 1);
    const node: PMNode = {
      type: "blockquote",
      ...(isColor(color) ? { attrs: { color } } : {}),
      content: [textPara, ...childRes.nodes],
    };
    return { nodes: [withIndentAttr(node)], end: childRes.end };
  }

  const contentReferenceTag = matchContentReferenceOpen(dedent);
  if (contentReferenceTag) {
    return parseContentReference(
      lines,
      start,
      indent,
      rel,
      contentReferenceTag,
    );
  }

  const registryTag = matchRegistryBlockOpen(dedent);
  if (registryTag) {
    return parseRegistryBlock(lines, start, indent, rel, registryTag);
  }

  const localMdxComponentTag = matchLocalMdxComponentOpen(dedent);
  if (localMdxComponentTag) {
    return parseLocalMdxComponent(
      lines,
      start,
      indent,
      rel,
      localMdxComponentTag,
    );
  }

  const containerTag = matchContainerOpen(dedent);
  if (containerTag) {
    return parseContainer(lines, start, indent, rel, containerTag);
  }

  if (dedent.startsWith("![")) {
    const altCloseBracket = findMatchingBracketClose(dedent, 1);
    if (altCloseBracket !== -1 && dedent[altCloseBracket + 1] === "(") {
      const srcCloseParen = findMatchingParenClose(dedent, altCloseBracket + 1);
      if (srcCloseParen !== -1) {
        const alt = dedent.slice(2, altCloseBracket);
        const src = unescapeUrlParens(
          dedent.slice(altCloseBracket + 2, srcCloseParen),
        );
        const rest = dedent.slice(srcCloseParen + 1);
        const suffixMatch = rest.match(/^\s*(\{[^}]*\})?\s*$/);
        if (suffixMatch) {
          if (suffixMatch[1]) {
            readAttrs("image", suffixMatch[1].slice(1, -1), IMAGE_ATTRS);
          }
          const colorMatch = suffixMatch[1]?.match(/color="([^"]+)"/);
          const node: PMNode = {
            type: "image",
            attrs: {
              src,
              alt: unescapeInlineText(alt),
              ...(colorMatch && isColor(colorMatch[1])
                ? { color: colorMatch[1] }
                : {}),
            },
          };
          return { nodes: [withIndentAttr(node)], end: start + 1 };
        }
      }
    }
  }

  const tagLine = dedent.match(
    /^<([a-zA-Z_][\w-]*)([^>]*?)(\/?)>(?:([\s\S]*?)<\/\1>)?\s*$/,
  );
  if (tagLine) {
    const node = parseLeafTag(tagLine[1], tagLine[2], tagLine[4] ?? "");
    if (node) return { nodes: [withIndentAttr(node)], end: start + 1 };
  }

  const { text, color } = splitBlockAttrs(dedent);
  const node: PMNode = {
    type: "paragraph",
    content: parseInline(unescapeLeadingBlockMarker(text)),
  };
  if (isColor(color)) node.attrs = { color };
  return { nodes: [withIndentAttr(node)], end: start + 1 };
}

function stripTabs(line: string, count: number): string {
  let i = 0;
  while (i < count && line[i] === "\t") i++;
  return line.slice(i);
}

function matchRegistryBlockOpen(dedent: string): string | null {
  const m = dedent.match(/^<([A-Za-z_][\w-]*)(?:[\s/>]|$)/);
  if (!m) return null;
  const tag = m[1];
  return registryBlockSpecByTag(tag) ? tag : null;
}

function matchContentReferenceOpen(dedent: string): string | null {
  return /^<ContentReference(?:[\s/>]|$)/.test(dedent)
    ? "ContentReference"
    : null;
}

function matchLocalMdxComponentOpen(dedent: string): string | null {
  const m = dedent.match(/^<([A-Z][\w-]*)(?:[\s/>]|$)/);
  if (!m) return null;
  const tag = m[1];
  return registryBlockSpecByTag(tag) ? null : tag;
}

function scanOpenTagEnd(
  text: string,
): { end: number; selfClosing: boolean } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === ">" && depth <= 0) {
      const selfClosing = text[i - 1] === "/";
      return { end: i + 1, selfClosing };
    }
  }
  return null;
}

function parseRegistryBlock(
  lines: string[],
  start: number,
  indent: number,
  rel: number,
  tag: string,
): ParseResult {
  const withIndentAttr = (node: PMNode): PMNode => {
    if (rel > 0) node.attrs = { ...(node.attrs || {}), indent: rel };
    return node;
  };
  const closeTag = `</${tag}>`;

  const dedented = lines.map((l) => stripTabs(l, indent));

  let openEndLine = start;
  let selfClosing = false;
  {
    let joined = "";
    for (let i = start; i < lines.length; i++) {
      joined += (i === start ? "" : "\n") + dedented[i];
      const res = scanOpenTagEnd(joined);
      if (res) {
        openEndLine = i;
        selfClosing = res.selfClosing;
        break;
      }
      openEndLine = i;
    }
  }

  let end: number;
  if (selfClosing) {
    end = openEndLine + 1;
  } else {
    let depth = 1;
    let i = openEndLine + 1;
    for (; i < lines.length; i++) {
      const li = leadingTabs(lines[i]);
      const ld = lines[i].slice(li);
      if (li >= indent) {
        if (new RegExp(`^<${tag}(?:[\\s/>]|$)`).test(ld)) depth++;
        if (ld.trimEnd().endsWith(closeTag)) {
          depth--;
          if (depth === 0) break;
        }
      }
    }
    end = Math.min(i + 1, lines.length);
  }

  const rawLines = dedented.slice(start, end);
  const openAttrs = parseAttrs(
    dedented.slice(start, openEndLine + 1).join("\n"),
  );
  const spec = registryBlockSpecByTag(tag);
  const node: PMNode = {
    type: "registryBlock",
    attrs: {
      blockType: spec?.type ?? tag,
      blockId: openAttrs.id ?? "",
      title: openAttrs.title ?? null,
      summary: openAttrs.summary ?? null,
      __raw: rawLines.join("\n"),
    },
  };
  return { nodes: [withIndentAttr(node)], end };
}

function parseContentReference(
  lines: string[],
  start: number,
  indent: number,
  rel: number,
  _tag: string,
): ParseResult {
  const withIndentAttr = (node: PMNode): PMNode => {
    if (rel > 0) node.attrs = { ...(node.attrs || {}), indent: rel };
    return node;
  };
  const dedented = lines.map((l) => stripTabs(l, indent));

  let openEndLine = start;
  {
    let joined = "";
    for (let i = start; i < lines.length; i++) {
      joined += (i === start ? "" : "\n") + dedented[i];
      const res = scanOpenTagEnd(joined);
      if (res) {
        openEndLine = i;
        break;
      }
      openEndLine = i;
    }
  }

  const rawLines = dedented.slice(start, openEndLine + 1);
  const raw = rawLines.join("\n");
  const props = parseAttrs(raw);
  const node: PMNode = {
    type: "contentReference",
    attrs: {
      sourcePath:
        props.sourcePath ?? props.path ?? props.source ?? props.href ?? "",
      title: props.title ?? null,
      __raw: raw,
    },
  };
  return { nodes: [withIndentAttr(node)], end: openEndLine + 1 };
}

function parseLocalMdxComponent(
  lines: string[],
  start: number,
  indent: number,
  rel: number,
  tag: string,
): ParseResult {
  const withIndentAttr = (node: PMNode): PMNode => {
    if (rel > 0) node.attrs = { ...(node.attrs || {}), indent: rel };
    return node;
  };
  const closeTag = `</${tag}>`;
  const dedented = lines.map((l) => stripTabs(l, indent));

  let openEndLine = start;
  let selfClosing = false;
  {
    let joined = "";
    for (let i = start; i < lines.length; i++) {
      joined += (i === start ? "" : "\n") + dedented[i];
      const res = scanOpenTagEnd(joined);
      if (res) {
        openEndLine = i;
        selfClosing = res.selfClosing;
        break;
      }
      openEndLine = i;
    }
  }

  let end: number;
  if (selfClosing) {
    end = openEndLine + 1;
  } else {
    let depth = 1;
    let i = openEndLine + 1;
    for (; i < lines.length; i++) {
      const li = leadingTabs(lines[i]);
      const ld = lines[i].slice(li);
      if (li >= indent) {
        if (new RegExp(`^<${tag}(?:[\\s/>]|$)`).test(ld)) depth++;
        if (ld.trimEnd().endsWith(closeTag)) {
          depth--;
          if (depth === 0) break;
        }
      }
    }
    end = Math.min(i + 1, lines.length);
  }

  const rawLines = dedented.slice(start, end);
  const raw = rawLines.join("\n");
  const openingSource = dedented.slice(start, openEndLine + 1).join("\n");
  const props = parseAttrs(openingSource);
  const node: PMNode = {
    type: "localMdxComponent",
    attrs: {
      name: tag,
      propsJson: JSON.stringify(props),
      unsupportedProps: hasUnsupportedJsxProps(openingSource),
      children: selfClosing ? "" : extractLocalMdxComponentChildren(raw, tag),
      __raw: raw,
    },
  };
  return { nodes: [withIndentAttr(node)], end };
}

function extractLocalMdxComponentChildren(raw: string, tag: string): string {
  const open = scanOpenTagEnd(raw);
  if (!open || open.selfClosing) return "";
  const closeIndex = raw.lastIndexOf(`</${tag}>`);
  if (closeIndex < open.end) return "";
  return raw.slice(open.end, closeIndex).trim();
}

function matchContainerOpen(dedent: string): string | null {
  for (const key of Object.keys(CONTAINER_CLOSE)) {
    if (key.endsWith(">")) {
      if (dedent === key) return key;
    } else {
      if (
        dedent === key + ">" ||
        dedent.startsWith(key + " ") ||
        dedent.startsWith(key + ">")
      ) {
        return key;
      }
    }
  }
  return null;
}

const MAX_CONTAINER_INDENT = 32;

// Where each container opener's closing tag is, or -1 for none, by tag. A
// scan from one opener passes a same-tag opener at its indent as a scan from
// that one would, so it records that one's close too, and a page of unclosed
// containers is scanned once. A list run whose indents are rewritten reads
// from a set of its own, dropped when the run is put back.
type ContainerCloses = Map<string, Map<number, number>>;
const containerCloseIndexes = new WeakMap<string[], ContainerCloses[]>();

function containerCloseLayers(lines: string[]): ContainerCloses[] {
  let layers = containerCloseIndexes.get(lines);
  if (!layers) containerCloseIndexes.set(lines, (layers = [new Map()]));
  return layers;
}

function containerClosesOf(
  lines: string[],
  tagKey: string,
): Map<number, number> {
  const layers = containerCloseLayers(lines);
  const byTag = layers[layers.length - 1];
  let closes = byTag.get(tagKey);
  if (!closes) byTag.set(tagKey, (closes = new Map()));
  return closes;
}

function parseContainer(
  lines: string[],
  start: number,
  indent: number,
  rel: number,
  tagKey: string,
): ParseResult {
  const closeTag = CONTAINER_CLOSE[tagKey];
  const openLine = lines[start].slice(indent);
  const withIndentAttr = (node: PMNode): PMNode => {
    if (rel > 0) node.attrs = { ...(node.attrs || {}), indent: rel };
    return node;
  };

  if (tagKey === "<table") {
    return parseTable(lines, start, indent, withIndentAttr);
  }
  if (tagKey === "<meeting-notes>") {
    return parseRawContainer(
      lines,
      start,
      indent,
      closeTag,
      "meeting-notes",
      withIndentAttr,
    );
  }

  const openerAsText = (): ParseResult => {
    const { text, color } = splitBlockAttrs(openLine);
    const node: PMNode = { type: "paragraph", content: parseInline(text) };
    if (isColor(color)) node.attrs = { color };
    return { nodes: [withIndentAttr(node)], end: start + 1 };
  };
  // A container holds its children one tab in, so its indent bounds how many
  // containers it is inside. Each level reads its body again, a details body
  // with its whole subtree, so past this depth the opener reads as text,
  // without the scan for its close: openers at many indents would each scan
  // the rest of the nesting.
  if (indent > MAX_CONTAINER_INDENT) {
    reportLoss("dropped-formatting", openLine);
    return openerAsText();
  }
  const closes = containerClosesOf(lines, tagKey);
  if (!closes.has(start)) {
    const openers = [start];
    let fence: { indent: number; marker: string } | undefined;
    for (let i = start + 1; i < lines.length && openers.length > 0; i++) {
      const li = leadingTabs(lines[i]);
      const ld = lines[i].slice(li);
      if (fence) {
        if (closesFence(ld.match(FENCE_CLOSE), fence.marker)) {
          fence = undefined;
        }
        continue;
      }
      const openFence = matchFenceOpen(ld);
      if (openFence) {
        fence = { indent: li, marker: openFence[1] };
        continue;
      }
      if (li !== indent) continue;
      if (matchContainerOpen(ld) === tagKey && !ld.startsWith("</"))
        openers.push(i);
      else if (ld === closeTag) closes.set(openers.pop()!, i);
    }
    for (const opener of openers) closes.set(opener, -1);
  }
  const closeIdx = closes.get(start)!;
  if (closeIdx === -1) return openerAsText();
  const childStart = start + 1;

  if (tagKey === "<details") {
    const attrs = readContainerAttrs(
      "details",
      openLine.replace(/\sopen(?=\s|>|$)/, ""),
      DETAILS_ATTRS,
    );
    // HTML reads any value of `open` as open, and the editor writes it bare.
    if (attrs.open !== undefined && !["", "open", "true"].includes(attrs.open))
      reportLoss("dropped-attribute", `<details open="${attrs.open}">`);
    let summary = "";
    let bodyStart = childStart;
    const summaryLine = lines[childStart]?.slice(indent) ?? "";
    const sm = summaryLine.match(/^<summary>([\s\S]*?)<\/summary>\s*$/);
    if (sm) {
      summary = sm[1];
      bodyStart = childStart + 1;
    }
    const node: PMNode = {
      type: "notionToggle",
      attrs: {
        summary,
        headingLevel: null,
        open: attrs.open !== undefined || /(?:^|\s)open(?:\s|>)/.test(openLine),
        color: isColor(attrs.color) ? attrs.color : null,
        indent: 0,
      },
      content: parseDetailsBody(lines, bodyStart, closeIdx, indent),
    };
    return { nodes: [withIndentAttr(node)], end: closeIdx + 1 };
  }

  if (tagKey === "<callout") {
    const attrs = readContainerAttrs("callout", openLine, CALLOUT_ATTRS);
    const childRes = parseBlockSequence(lines, childStart, indent + 1);
    reportUnreadLines(lines, childRes.end, closeIdx);
    const node: PMNode = {
      type: "notionCallout",
      attrs: {
        icon: attrs.icon ?? "",
        color: isColor(attrs.color) ? attrs.color : null,
      },
      content: childRes.nodes,
    };
    return { nodes: [withIndentAttr(node)], end: closeIdx + 1 };
  }

  if (tagKey === "<columns>") {
    const childRes = parseBlockSequence(lines, childStart, indent + 1);
    reportUnreadLines(lines, childRes.end, closeIdx);
    const columns = childRes.nodes.filter((n) => {
      if (n.type === "notionColumn") return true;
      reportLoss(
        "dropped-source",
        docToNfm({ type: "doc", content: [n] }).slice(0, 200),
      );
      return false;
    });
    const node: PMNode = { type: "notionColumns", content: columns };
    return { nodes: [withIndentAttr(node)], end: closeIdx + 1 };
  }

  if (tagKey === "<column>") {
    const childRes = parseBlockSequence(lines, childStart, indent + 1);
    reportUnreadLines(lines, childRes.end, closeIdx);
    const node: PMNode = { type: "notionColumn", content: childRes.nodes };
    return { nodes: [withIndentAttr(node)], end: closeIdx + 1 };
  }

  if (tagKey === "<synced_block" || tagKey === "<synced_block_reference") {
    const attrs = readContainerAttrs(tagKey.slice(1), openLine, SYNCED_ATTRS);
    const childRes = parseBlockSequence(lines, childStart, indent + 1);
    reportUnreadLines(lines, childRes.end, closeIdx);
    const node: PMNode = {
      type: "notionSyncedBlock",
      attrs: {
        isReference: tagKey === "<synced_block_reference",
        url: attrs.url || null,
        notice: attrs.notice || null,
      },
      content: childRes.nodes,
    };
    return { nodes: [withIndentAttr(node)], end: closeIdx + 1 };
  }

  return parseRawContainer(
    lines,
    start,
    indent,
    closeTag,
    "unknown",
    withIndentAttr,
  );
}

// A container holds the lines indented under it; the parse skips a line that
// is not, up to the closing tag.
function reportUnreadLines(lines: string[], from: number, to: number): void {
  for (let i = from; i < to; i++)
    if (lines[i].trim()) reportLoss("dropped-source", lines[i].trim());
}

const DETAILS_ATTRS = new Set(["color", "open"]);
const CALLOUT_ATTRS = new Set(["icon", "color"]);
const SYNCED_ATTRS = new Set(["url", "notice"]);

function readContainerAttrs(
  tag: string,
  openLine: string,
  kept: ReadonlySet<string>,
): Record<string, string> {
  return readAttrs(tag, openLine.slice(tag.length + 1).replace(/>$/, ""), kept);
}

function parseRawContainer(
  lines: string[],
  start: number,
  indent: number,
  closeTag: string,
  tagName: string,
  withIndentAttr: (n: PMNode) => PMNode,
): ParseResult {
  // The first line after the opener that is the closing tag at its indent;
  // every same opener on the way closes there too.
  const closes = containerClosesOf(lines, closeTag);
  if (!closes.has(start)) {
    const close = TAB.repeat(indent) + closeTag;
    const open = TAB.repeat(indent) + "<" + closeTag.slice(2);
    const openers = [start];
    let at = start + 1;
    while (at < lines.length && lines[at] !== close) {
      if (lines[at] === open) openers.push(at);
      at++;
    }
    for (const opener of openers)
      closes.set(opener, at < lines.length ? at : -1);
  }
  const i = closes.get(start)!;
  if (i === -1) {
    const openLine = lines[start].slice(indent);
    const { text, color } = splitBlockAttrs(openLine);
    const node: PMNode = { type: "paragraph", content: parseInline(text) };
    if (isColor(color)) node.attrs = { color };
    return { nodes: [withIndentAttr(node)], end: start + 1 };
  }
  const rawLines = lines.slice(start, i + 1).map((l) => stripTabs(l, indent));
  const node: PMNode = {
    type: "notionBlockAtom",
    attrs: {
      tagName,
      attrsJson: "{}",
      label: tagName,
      __raw: rawLines.join("\n"),
    },
  };
  return { nodes: [withIndentAttr(node)], end: i + 1 };
}

// For each line of a table, indexed from its open tag, the first line at or
// after it that opens or closes a cell or starts or ends a row, or `close`: a
// table of unclosed cells would otherwise rescan the rest of itself from every
// one.
function cellClosesFrom(
  start: number,
  close: number,
  lineAt: (index: number) => string,
): Int32Array {
  const next = new Int32Array(close - start + 1);
  next[close - start] = close;
  for (let index = close - 1; index > start; index--) {
    const line = lineAt(index);
    next[index - start] =
      ROW_EDGE.test(line) || CELL_OPEN.test(line) || CELL_LINE_END.test(line)
        ? index
        : next[index - start + 1];
  }
  return next;
}

const tableCloseIndexes = new WeakMap<string[], Int32Array>();

// For each line, the first `</table>` line at or after it. A page of unclosed
// tables would otherwise search the rest of itself from every one.
function tableClosesFrom(lines: string[]): Int32Array {
  let next = tableCloseIndexes.get(lines);
  if (next) return next;
  next = new Int32Array(lines.length + 1);
  next[lines.length] = lines.length;
  for (let i = lines.length - 1; i >= 0; i--)
    next[i] = lines[i].trim() === "</table>" ? i : next[i + 1];
  tableCloseIndexes.set(lines, next);
  return next;
}

function parseTable(
  lines: string[],
  start: number,
  indent: number,
  withIndentAttr: (n: PMNode) => PMNode,
): ParseResult {
  const openLine = lines[start].slice(indent);
  const lineAt = (index: number) =>
    lines[index].slice(Math.min(indent, leadingTabs(lines[index]))).trim();

  // A line's tabs are all leading whitespace, so `lineAt` is its trimmed text.
  const close = tableClosesFrom(lines)[start + 1];
  if (close === lines.length) {
    const { text, color } = splitBlockAttrs(openLine);
    const node: PMNode = { type: "paragraph", content: parseInline(text) };
    if (isColor(color)) node.attrs = { color };
    return { nodes: [withIndentAttr(node)], end: start + 1 };
  }

  const openAttrSource = openLine.replace(/^<table/, "").replace(/>$/, "");
  const openAttrs = readAttrs("table", openAttrSource, TABLE_ATTRS);
  for (const [name, value] of Object.entries(openAttrs)) {
    if (TABLE_ATTRS.has(name) && value !== "true" && value !== "false")
      reportLoss("dropped-attribute", `<table ${name}="${value}">`);
  }
  const colMeta: Array<{ color?: string; width?: string }> = [];
  const rows: Array<{ color: string | null; cells: string[]; head: boolean }> =
    [];
  let group: string | null = null;
  // The editor has no footer rows, so a `<tfoot>` reads as body rows.
  const enterGroups = (source: string) => {
    for (const [tag, close, name] of source.matchAll(ROW_GROUP_TAG)) {
      group = close ? null : name;
      if (group === "tfoot") reportLoss("dropped-source", tag);
    }
  };
  const openRow = (attrSource: string | undefined) => {
    const rowAttrs = readAttrs("tr", attrSource ?? "", ROW_ATTRS);
    rows.push({
      color: isColor(rowAttrs.color) ? rowAttrs.color : null,
      cells: [],
      head: group === "thead",
    });
  };
  const addCells = (source: string) => {
    for (const part of splitTableCells(source)) {
      if (typeof part === "string") rows[rows.length - 1].cells.push(part);
      else {
        enterGroups(part.gap);
        openRow(part.rowAttrs);
      }
    }
  };
  let cellCloses: Int32Array | null = null;

  let i = start + 1;
  while (i < close) {
    const ld = lineAt(i++);
    if (!ld) continue;
    if (TABLE_WRAPPER_LINE.test(ld)) {
      enterGroups(ld);
      continue;
    }
    // Not /^<col(\s[^>]*?)?\s*\/?>$/: its lazy group retries the spaces
    // before `>` from each offset of a long run of them. The attributes read
    // the same with the spaces, but not with the slash.
    const colMatch = ld.match(/^<col(\s[^>]*)?\/?>$/);
    if (colMatch) {
      const attrSource = (colMatch[1] ?? "").replace(/\/$/, "");
      const a = readAttrs("col", attrSource, COL_ATTRS);
      colMeta.push({ color: a.color, width: a.width });
      continue;
    }
    const rowMatch = ld.match(/^<tr(\s[^>]*?)?>(.*)$/);
    if (!rowMatch) {
      reportLoss("dropped-source", ld);
      continue;
    }
    openRow(rowMatch[1]);
    // An agent may write a whole row on its line; the writer never does.
    let rest = rowMatch[2].trim();
    let rowClosed = rest.endsWith("</tr>");
    if (rowClosed) rest = rest.slice(0, -"</tr>".length).trim();
    if (rest) addCells(rest);
    while (!rowClosed && i < close) {
      let cd = lineAt(i++);
      if (cd === "</tr>") break;
      if (!cd) continue;
      // HTML reads a cell's line breaks as spaces.
      if (CELL_OPEN.test(cd) && !CELL_LINE_END.test(cd)) {
        cellCloses ??= cellClosesFrom(start, close, lineAt);
        const end = cellCloses[i - start];
        // A cell left open when its row ends or the next cell opens is
        // dropped, not read into what follows.
        if (
          end < close &&
          !ROW_EDGE.test(lineAt(end)) &&
          !CELL_OPEN.test(lineAt(end))
        ) {
          for (; i <= end; i++) cd += ` ${lineAt(i)}`;
          cd = trimJoinedCell(cd);
        }
      }
      rowClosed = /<\/t[dh]>\s*<\/tr>$/.test(cd);
      if (rowClosed) cd = cd.slice(0, -"</tr>".length).trimEnd();
      // The writer puts one cell on a line and escapes `<` outside code and
      // math, so a close tag outside those before the line's end is an
      // agent's `<td>a</td><td>b</td>`.
      addCells(cd);
    }
  }

  const parsedRows = rows.map((row) => ({
    color: row.color,
    cells: row.cells.flatMap((source) => {
      const cell = source.match(/^<(t[dh])(\s[^>]*?)?>([\s\S]*)<\/t[dh]>$/);
      if (!cell) {
        reportLoss("dropped-source", source);
        return [];
      }
      const attrs = readAttrs(cell[1], cell[2] ?? "", CELL_ATTRS);
      if (attrs.align !== undefined && !isTableAlignment(attrs.align))
        reportLoss("dropped-attribute", `<${cell[1]} align="${attrs.align}">`);
      return [
        {
          header: cell[1] === "th",
          attrs: {
            color: isColor(attrs.color) ? attrs.color : null,
            textAlign: isTableAlignment(attrs.align) ? attrs.align : null,
          },
          inline: cell[3],
        },
      ];
    }),
  }));

  // The writer spells header cells as attributes, never `<th>` or `<thead>`,
  // so an agent's `<th>` cells, or a `<thead>` around the first row, name the
  // header row or column when no attribute does.
  const allHeaders = (cells: Array<{ header: boolean }>) =>
    cells.length > 0 && cells.every((cell) => cell.header);
  const headerRow =
    openAttrs["header-row"] !== undefined
      ? openAttrs["header-row"] === "true"
      : parsedRows.length > 0 &&
        (rows[0].head || allHeaders(parsedRows[0].cells));
  // The editor's one header row is all a `<thead>` can become.
  if (rows.some((row, index) => row.head && !(index === 0 && headerRow)))
    reportLoss("dropped-source", "<thead>");
  const bodyRows = headerRow ? parsedRows.slice(1) : parsedRows;
  const headerColumn =
    openAttrs["header-column"] !== undefined
      ? openAttrs["header-column"] === "true"
      : bodyRows.length > 0 &&
        bodyRows.every((row) => allHeaders(row.cells.slice(0, 1)));
  const fitPageWidth = openAttrs["fit-page-width"] === "true";

  const node: PMNode = {
    type: "table",
    attrs: {
      headerRow,
      headerColumn,
      fitPageWidth,
      colMeta: colMeta.length ? colMeta : null,
    },
    content: parsedRows.map((row, rowIndex) => ({
      type: "tableRow",
      attrs: { color: row.color },
      content: row.cells.map((cell, cellIndex) => {
        const header =
          (headerRow && rowIndex === 0) || (headerColumn && cellIndex === 0);
        if (cell.header && !header) reportLoss("dropped-attribute", "<th>");
        return {
          type: header ? "tableHeader" : "tableCell",
          attrs: cell.attrs,
          content: [{ type: "paragraph", content: parseInline(cell.inline) }],
        };
      }),
    })),
  };
  return { nodes: [withIndentAttr(node)], end: close + 1 };
}

const TABLE_ATTRS = new Set(["header-row", "header-column", "fit-page-width"]);
const ROW_ATTRS = new Set(["color"]);
const CELL_ATTRS = new Set(["color", "align"]);
const COL_ATTRS = new Set(["color", "width"]);
const TABLE_WRAPPER_LINE = /^<\/?(?:colgroup|thead|tbody|tfoot)>$/;
const ROW_EDGE = /^<\/?tr[\s>]/;
const CELL_OPEN = /^<t[dh][\s>]/;
// A cell's line may also close its row; the writer never closes one there.
const CELL_LINE_END = /<\/t[dh]>(?:\s*<\/tr>)?$/;
const ROW_BREAK =
  /^(?:<\/tr>\s*)?(?:<\/?(?:thead|tbody|tfoot)>\s*)*<tr(\s[^>]*?)?>$/;
const ROW_GROUP_TAG = /<(\/?)(thead|tbody|tfoot)>/g;

// Drops the spaces just inside a joined cell's tags, which HTML ignores. By
// hand, since a pattern for the spaces before the close tag retries them from
// each offset of a long run.
function trimJoinedCell(cell: string): string {
  const open = /^<t[dh][^>]*>/.exec(cell);
  let text = cell;
  if (open) {
    let from = open[0].length;
    while (from < text.length && SPACE_CHAR.test(text[from])) from++;
    text = open[0] + text.slice(from);
  }
  const close = CELL_LINE_END.exec(text);
  if (!close) return text;
  let to = close.index;
  while (to > 0 && SPACE_CHAR.test(text[to - 1])) to--;
  return text.slice(0, to) + text.slice(close.index);
}

// A cell's source, or where the next row opens.
type TableLinePart = string | { rowAttrs: string; gap: string };

// Whether a cell's open tag sits between `from` and `to` outside code and
// math, where the writer escapes every `<`.
function opensCellBefore(
  s: string,
  from: number,
  to: number,
  codeRuns: CodeRuns,
): boolean {
  const first = s.indexOf("<t", from);
  if (first === -1 || first >= to) return false;
  for (let i = from; i < to; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    const skipTo = atomicSpanEnd(s, i, codeRuns);
    if (skipTo !== -1) {
      i = skipTo - 1;
      continue;
    }
    if (s[i] === "<" && /^<t[dh][\s>]/.test(s.slice(i, i + 4))) return true;
  }
  return false;
}

function splitTableCells(source: string): TableLinePart[] {
  const cells: TableLinePart[] = [];
  // An agent may start the next row between two cells or on a line of its
  // own, with or without closing this one; HTML closes it there.
  const readGap = (gap: string) => {
    const rowBreak = gap.match(ROW_BREAK);
    if (rowBreak) cells.push({ rowAttrs: rowBreak[1] ?? "", gap });
    else if (gap) reportLoss("dropped-source", gap);
  };
  // Found by hand, not by one regex: searching from every open tag for a `>`
  // or a close tag the row lacks rescans the rest of it from each one. A
  // close tag in code or math, or after a backslash, is the cell's text.
  const lastClose = {
    td: source.lastIndexOf("</td>"),
    th: source.lastIndexOf("</th>"),
  };
  const codeRuns = indexCodeRuns(source);
  const open = /<(t[dh])[\s>]/g;
  let nextGt = -1;
  let last = 0;
  for (let m; (m = open.exec(source)); ) {
    const tag = m[1] as "td" | "th";
    let contentFrom = m.index + 4;
    if (source[m.index + 3] !== ">") {
      if (nextGt < m.index + 3) {
        nextGt = source.indexOf(">", m.index + 3);
        // No later open tag can end either.
        if (nextGt < 0) break;
      }
      contentFrom = nextGt + 1;
    }
    const closeTag = `</${tag}>`;
    const close =
      lastClose[tag] < contentFrom
        ? -1
        : findToken(source, closeTag, contentFrom, codeRuns);
    if (close < 0) {
      // Later open tags of this kind count as unclosed too, so no search
      // runs to the end of the row twice.
      lastClose[tag] = -1;
      open.lastIndex = m.index + 1;
      continue;
    }
    const end = close + closeTag.length;
    readGap(source.slice(last, m.index).trim());
    // `<td>a <td>b</td>` reads as main reads it, as one cell holding the
    // second tag as text; HTML would read two cells.
    if (opensCellBefore(source, contentFrom, close, codeRuns))
      reportLoss("dropped-source", source.slice(m.index, end));
    cells.push(source.slice(m.index, end));
    last = open.lastIndex = end;
  }
  readGap(source.slice(last).trim());
  return cells;
}

const MEDIA_TAGS = new Set(["video", "audio"]);
const MEDIA_ATTRS = new Set(["src", "color"]);
const IMAGE_ATTRS = new Set(["color"]);
const BLOCK_ATOM_TAGS = new Set([
  "page",
  "database",
  "file",
  "pdf",
  "bookmark",
  "embed",
  "table_of_contents",
  "unknown",
]);

function parseLeafTag(
  tagName: string,
  rawAttrs: string,
  label: string,
): PMNode | null {
  if (MEDIA_TAGS.has(tagName)) {
    const attrs = readAttrs(tagName, rawAttrs, MEDIA_ATTRS);
    return {
      type: tagName,
      attrs: {
        src: attrs.src || null,
        title: label ? unescapeAttr(label) : null,
        ...(isColor(attrs.color) ? { color: attrs.color } : {}),
      },
    };
  }
  if (BLOCK_ATOM_TAGS.has(tagName)) {
    const attrs = readAttrs(tagName, rawAttrs);
    return {
      type: "notionBlockAtom",
      attrs: {
        tagName,
        attrsJson: JSON.stringify(attrs),
        label: label ? unescapeAttr(label) : "",
      },
    };
  }
  return null;
}

export function canonicalizeNfm(nfm: string | null | undefined): string {
  return docToNfm(nfmToDoc(nfm ?? ""));
}

/**
 * Canonical Markdown that keeps a trailing empty block. A Notion page can end
 * in an empty paragraph its author made, and its pulls, pushes and sync hashes
 * must not drop it.
 */
export function canonicalizeNotionNfm(nfm: string | null | undefined): string {
  return docToNfm(nfmToDoc(nfm ?? ""), { keepTrailingEmptyBlock: true });
}

/**
 * The document canonical Markdown writes. A trailing empty paragraph after
 * another kind of block is where the editor lets you type, and its save drops
 * it.
 */
export function canonicalNfmDoc(doc: PMDoc): PMDoc {
  const content = trimEditorTerminalFiller(doc.content);
  return content === doc.content ? doc : { ...doc, content };
}

function countLocalMdxNodes(
  node: PMNode,
  predicate: (node: PMNode) => boolean,
): number {
  let count = node.type === "localMdxComponent" && predicate(node) ? 1 : 0;
  for (const child of node.content ?? []) {
    count += countLocalMdxNodes(child, predicate);
  }
  return count;
}

function countGfmPipeTables(
  source: string,
  delimiterPredicate: (cells: string[]) => boolean,
): number {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const fencedCodeLines = fencedCodeLineMask(lines);
  let count = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    if (fencedCodeLines[i] || fencedCodeLines[i + 1]) continue;
    const indent = leadingTabs(lines[i]);
    if (leadingTabs(lines[i + 1]) !== indent) continue;
    const header = splitGfmPipeRow(lines[i].slice(indent));
    const delimiter = splitGfmPipeRow(lines[i + 1].slice(indent));
    if (
      header &&
      delimiter &&
      header.length > 0 &&
      header.length === delimiter.length &&
      delimiterPredicate(delimiter)
    ) {
      count++;
      i++;
    }
  }
  return count;
}

function fencedCodeLineMask(lines: string[]): boolean[] {
  const mask = lines.map(() => false);
  let fence: { indent: number; marker: string } | undefined;
  for (let index = 0; index < lines.length; index++) {
    const indent = leadingTabs(lines[index]);
    const dedented = lines[index].slice(indent);
    if (fence) {
      mask[index] = true;
      if (
        indent >= fence.indent &&
        closesFence(dedented.match(FENCE_CLOSE), fence.marker)
      ) {
        fence = undefined;
      }
      continue;
    }
    const open = matchFenceOpen(dedented);
    if (open) {
      mask[index] = true;
      fence = { indent, marker: open[1] };
    }
  }
  return mask;
}

export function inspectNfmFidelity(
  nfm: string | null | undefined,
): NfmFidelityReport {
  const source = nfm ?? "";
  try {
    const document = nfmToDoc(source);
    const normalized = canonicalizeNfm(source);
    const pipeTableCount = countGfmPipeTables(source, (cells) =>
      cells.every(
        (cell) => isGfmDelimiterCell(cell) || isAlignedGfmDelimiterCell(cell),
      ),
    );
    const unsupportedMdxCount = countLocalMdxNodes(
      document,
      (node) => node.attrs?.unsupportedProps === true,
    );

    const conversions: NfmFidelityReport["conversions"] = [];
    if (pipeTableCount > 0) {
      conversions.push({
        kind: "gfm-pipe-table-to-content-table",
        count: pipeTableCount,
      });
    }
    if (normalized !== source && conversions.length === 0) {
      conversions.push({ kind: "canonicalized-nfm", count: 1 });
    }

    const unresolved: NfmFidelityReport["unresolved"] = [];
    if (unsupportedMdxCount > 0) {
      unresolved.push({
        kind: "mdx-component-props-preserved-as-raw-source",
        count: unsupportedMdxCount,
      });
    }

    return {
      status:
        unresolved.length > 0
          ? "unresolved"
          : conversions.length > 0 || normalized !== source
            ? "transformed"
            : "preserved",
      normalizedChanged: normalized !== source,
      conversions,
      unresolved,
    };
  } catch (error) {
    return {
      status: "failed",
      normalizedChanged: false,
      conversions: [],
      unresolved: [],
      error: error instanceof Error ? error.message : "Unreadable content",
    };
  }
}

export function collapseExactRepeatedNfm(
  nfm: string,
  options: { requiredText: string },
): string {
  if (!options.requiredText || !nfm.includes(options.requiredText)) return nfm;

  const lines = nfm.split("\n");
  if (lines.length < 2 || lines.length % 2 !== 0) return nfm;

  const midpoint = lines.length / 2;
  for (let index = 0; index < midpoint; index += 1) {
    if (lines[index] !== lines[index + midpoint]) return nfm;
  }
  return lines.slice(0, midpoint).join("\n");
}
