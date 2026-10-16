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
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) attrs[m[1]] = unescapeAttr(m[2]);
  return attrs;
}
/** Attribute source `parseAttrs` skips: unquoted, single-quoted or bare. */
function unparsedAttrSource(raw: string): string {
  return raw
    .replace(/([a-zA-Z_:][\w:-]*)\s*=\s*"([^"]*)"/g, "")
    .replace(/\/\s*$/, "")
    .trim();
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
function oddTrailingBackslashes(s: string): boolean {
  return (s.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
}

function escapeTrailingBackslashRun(s: string): string {
  const run = s.match(/\\+$/)?.[0];
  if (!run) return s;
  return s.slice(0, -run.length) + run + run;
}

function unescapeTrailingBackslashRun(s: string): string {
  const run = s.match(/\\+$/)?.[0];
  if (!run) return s;
  return s.slice(0, -run.length) + "\\".repeat(run.length / 2);
}

function splitBlockAttrs(
  line: string,
  allowToggle = false,
): {
  text: string;
  toggle: boolean;
  color: string | null;
} {
  const m = line.match(/^(.*?)\s*\{([^{}]*)\}\s*$/);
  if (!m) return { text: line, toggle: false, color: null };
  const body = m[2];
  if (oddTrailingBackslashes(m[1]) || oddTrailingBackslashes(body)) {
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
  return { text: m[1], toggle, color };
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
          : name === "underline";
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
function findToken(s: string, token: string, from: number): number {
  const unclosedCodeRuns = new Set<number>();
  for (let i = from; i <= s.length - token.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    const skipTo = atomicSpanEnd(s, i, unclosedCodeRuns);
    if (skipTo !== -1) {
      i = skipTo - 1;
      continue;
    }
    if (s.startsWith(token, i)) return i;
  }
  return -1;
}

/**
 * Where the code span or math starting at `at` ends, or where an unclosed
 * backtick run ends; -1 when neither starts there. `unclosedCodeRuns` keeps a
 * scan linear by remembering run lengths with no closer left.
 */
function atomicSpanEnd(
  s: string,
  at: number,
  unclosedCodeRuns: Set<number>,
): number {
  if (s[at] === "$") return matchInlineMathAt(s, at)?.to ?? -1;
  if (s[at] !== "`") return -1;
  const run = delimiterRunLength(s, at, "`");
  const end = unclosedCodeRuns.has(run) ? -1 : codeSpanEnd(s, at, run);
  if (end !== -1) return end;
  unclosedCodeRuns.add(run);
  return at + run;
}

function codeSpanEnd(s: string, at: number, run: number): number {
  const delimiter = "`".repeat(run);
  for (let search = at + run; ; ) {
    const close = s.indexOf(delimiter, search);
    if (close === -1) return -1;
    const length = delimiterRunLength(s, close, "`");
    if (length === run) return close + run;
    search = close + length;
  }
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
): { from: number; to: number; run: number } | null {
  const run = delimiterRunLength(input, start, "_");
  if (run > 3) return null;
  const open = delimiterFlanking(input, start, start + run);
  if (!open.left || (open.right && !isFlankPunctuation(open.before)))
    return null;
  const from = start + run;
  if (misses[run] !== undefined && from >= misses[run]) return null;
  const unclosedCodeRuns = new Set<number>();
  for (let j = from; j < input.length; j++) {
    if (input[j] === "\\") {
      j++;
      continue;
    }
    const skipTo = atomicSpanEnd(input, j, unclosedCodeRuns);
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

function markKey(mark: PMMark): string {
  return `${mark.type}:${JSON.stringify(mark.attrs ?? null)}`;
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

function parseInline(input: string): PMNode[] {
  const out: PMNode[] = [];
  let buf = "";
  let i = 0;
  const underscoreMisses: number[] = [];
  const linkCloses = {
    brackets: new Map<number, number>(),
    parens: new Map<number, number>(),
  };
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
      const openRun = /^`+/.exec(input.slice(i))?.[0].length ?? 0;
      const delim = "`".repeat(openRun);
      let searchFrom = i + openRun;
      let close = -1;
      while (searchFrom <= input.length - openRun) {
        const idx = input.indexOf(delim, searchFrom);
        if (idx === -1) break;
        const runLen = /^`+/.exec(input.slice(idx))?.[0].length ?? 0;
        if (runLen === openRun) {
          close = idx;
          break;
        }
        searchFrom = idx + runLen;
      }
      if (close !== -1) {
        flush();
        let codeText = input
          .slice(i + openRun, close)
          .replace(/<br\/?>/g, "\n");
        if (
          codeText.startsWith(" ") &&
          codeText.endsWith(" ") &&
          codeText.trim().length > 0
        ) {
          codeText = codeText.slice(1, -1);
        }
        out.push(textNode(codeText, [{ type: "code" }]));
        i = close + openRun;
        continue;
      }
    }

    if (input.startsWith("<br/>", i) || input.startsWith("<br>", i)) {
      flush();
      out.push({ type: "hardBreak" });
      i += input.startsWith("<br/>", i) ? 5 : 4;
      continue;
    }

    if (input.startsWith("<span", i)) {
      const open = input.indexOf(">", i);
      const close = input.indexOf("</span>", open);
      if (open !== -1 && close !== -1) {
        flush();
        const rawAttrs = input.slice(i + 5, open);
        const inner = parseInline(input.slice(open + 1, close));
        mergeSpanMark(inner, parseAttrs(rawAttrs), rawAttrs);
        pushAll(out, inner);
        i = close + "</span>".length;
        continue;
      }
    }

    if (input.startsWith("<mention-", i)) {
      const selfClose = input.indexOf("/>", i);
      const open = input.indexOf(">", i);
      if (selfClose !== -1 && (open === -1 || selfClose <= open)) {
        flush();
        const tagMatch = input.slice(i).match(/^<(mention-[\w-]+)([^>]*?)\/>/);
        if (tagMatch) {
          out.push(makeInlineAtom(tagMatch[1], tagMatch[2], ""));
          i += tagMatch[0].length;
          continue;
        }
      }
      const tagMatch = input
        .slice(i)
        .match(/^<(mention-[\w-]+)([^>]*)>([\s\S]*?)<\/\1>/);
      if (tagMatch) {
        flush();
        out.push(makeInlineAtom(tagMatch[1], tagMatch[2], tagMatch[3]));
        i += tagMatch[0].length;
        continue;
      }
    }

    if (input.startsWith("***", i)) {
      const close = findToken(input, "***", i + 3);
      if (close > i + 3) {
        flush();
        const inner = parseInline(input.slice(i + 3, close));
        addMark(inner, { type: "bold" });
        addMark(inner, { type: "italic" });
        pushAll(out, inner);
        i = close + 3;
        continue;
      }
    }

    if (input.startsWith("**", i)) {
      const close = findToken(input, "**", i + 2);
      if (close > i + 2) {
        flush();
        const inner = parseInline(input.slice(i + 2, close));
        addMark(inner, { type: "bold" });
        pushAll(out, inner);
        i = close + 2;
        continue;
      }
    }

    if (input.startsWith("~~", i)) {
      const close = findToken(input, "~~", i + 2);
      if (close > i + 2) {
        flush();
        const inner = parseInline(input.slice(i + 2, close));
        addMark(inner, { type: "strike" });
        pushAll(out, inner);
        i = close + 2;
        continue;
      }
    }

    if (ch === "_") {
      const emphasis = matchUnderscoreEmphasis(input, i, underscoreMisses);
      if (emphasis) {
        flush();
        const inner = parseInline(input.slice(emphasis.from, emphasis.to));
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
      const close = findToken(input, "*", i + 1);
      if (close > i + 1) {
        flush();
        const inner = parseInline(input.slice(i + 1, close));
        addMark(inner, { type: "italic" });
        pushAll(out, inner);
        i = close + 1;
        continue;
      }
    }

    if (ch === "[") {
      const link = matchLink(input, i, linkCloses);
      if (link) {
        flush();
        const inner = parseInline(link.text);
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
// it would, so it records their closers too (-1 for none) in `closes`, and a
// line of unmatched openers is scanned once instead of once per opener.
function findMatchingBracketClose(
  s: string,
  start: number,
  closes = new Map<number, number>(),
): number {
  const known = closes.get(start);
  if (known !== undefined) return known;
  const openers: number[] = [];
  const unclosedCodeRuns = new Set<number>();
  for (let i = start; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    const skipTo = atomicSpanEnd(s, i, unclosedCodeRuns);
    if (skipTo !== -1) {
      i = skipTo - 1;
      continue;
    }
    if (s[i] === "[") openers.push(i);
    else if (s[i] === "]") {
      closes.set(openers.pop()!, i);
      if (openers.length === 0) return i;
    }
  }
  for (const opener of openers) closes.set(opener, -1);
  return -1;
}

function findMatchingParenClose(
  s: string,
  openParenIdx: number,
  closes = new Map<number, number>(),
): number {
  const known = closes.get(openParenIdx);
  if (known !== undefined) return known;
  const openers: number[] = [];
  for (let i = openParenIdx; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "(") openers.push(i);
    else if (s[i] === ")") {
      closes.set(openers.pop()!, i);
      if (openers.length === 0) return i;
    }
  }
  for (const opener of openers) closes.set(opener, -1);
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
  closes: { brackets: Map<number, number>; parens: Map<number, number> },
): { text: string; href: string; end: number } | null {
  const closeBracket = findMatchingBracketClose(s, start, closes.brackets);
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
      // with one takes a tilde fence.
      const marker = lang.includes("`") ? "~" : "`";
      const fence = marker.repeat(
        Math.max(3, longestRun(text, marker === "`" ? /`+/g : /~+/g) + 1),
      );
      return [indentStr(ind) + fence + lang, ...body, indentStr(ind) + fence];
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
  const hasMatchingClose = (from: number, tagKey: string): boolean => {
    const closeTag = CONTAINER_CLOSE[tagKey];
    let depth = 1;
    let fenceMarker = "";
    for (let i = from + 1; i < sourceLines.length; i++) {
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
      if (matchContainerOpen(candidate) === tagKey) depth++;
      if (candidate === closeTag && --depth === 0) return true;
    }
    return false;
  };
  const bodyLines = sourceLines.map((line, lineIndex) => {
    const indent = leadingTabs(line);
    const dedented = line.slice(indent);
    if (fence) {
      const requiredIndent = childIndent + nestedContainers.length;
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
    const requiredIndent =
      childIndent + nestedContainers.length - (detailsSummary ? 1 : 0);
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

function hasMatchingBacktickRun(
  value: string,
  start: number,
  expectedLength: number,
): boolean {
  for (let i = start; i < value.length; i++) {
    if (value[i] === "\\") {
      i++;
      continue;
    }
    if (value[i] !== "`") continue;
    let runLength = 1;
    while (value[i + runLength] === "`") runLength++;
    if (runLength === expectedLength) return true;
    i += runLength - 1;
  }
  return false;
}

export function splitGfmPipeRow(line: string): string[] | null {
  const value = line.trim();
  if (!value) return null;

  const cells: string[] = [];
  let cell = "";
  let codeFenceLength = 0;
  let sawSeparator = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && i + 1 < value.length) {
      cell += char + value[++i];
      continue;
    }
    if (char === "`") {
      let runLength = 1;
      while (value[i + runLength] === "`") runLength++;
      if (
        codeFenceLength === 0 &&
        hasMatchingBacktickRun(value, i + runLength, runLength)
      )
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
    if (!originals.has(index)) originals.set(index, lines[index]);
    lines[index] = "\t".repeat(depth) + text;
  };
  const spaced = spacedLinesFrom(lines);
  const open: Array<{ content: number; depth: number }> = [];
  let blank = false;
  let continuing = false;
  for (let i = start; i < lines.length && spaced[i] < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      blank = true;
      continue;
    }
    const tabs = leadingTabs(line);
    if (tabs < indent) break;
    const afterBlank = blank;
    blank = false;
    if (tabs > indent) {
      while (open.length && open[open.length - 1].depth >= tabs) open.pop();
      continuing = false;
      const fence = matchFenceOpen(line.slice(tabs));
      if (fence) {
        while (
          i + 1 < lines.length &&
          !closesFence(lines[i + 1].trim().match(FENCE_CLOSE), fence[1])
        )
          i++;
        i++;
      }
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
    if (item) {
      write(i, depth, text);
      open.push({ content: spaces + listItemContentOffset(text), depth });
      continuing = false;
      continue;
    }
    const fence = matchFenceOpen(text);
    if (fence) {
      write(i, depth, text);
      for (i++; i < lines.length; i++) {
        const body = lines[i].slice(Math.min(indent, leadingTabs(lines[i])));
        let strip = 0;
        while (strip < spaces && body[strip] === " ") strip++;
        write(i, depth, body.slice(strip));
        if (closesFence(body.trim().match(FENCE_CLOSE), fence[1])) break;
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
  for (const [index, line] of originals) lines[index] = line;

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

  let i = start + 1;
  const childStart = i;
  let depth = 1;
  let fence: { indent: number; marker: string } | undefined;
  for (; i < lines.length; i++) {
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
    if (
      li === indent &&
      matchContainerOpen(ld) === tagKey &&
      !ld.startsWith("</")
    ) {
      depth++;
    }
    if (li === indent && ld === closeTag) {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    const { text, color } = splitBlockAttrs(openLine);
    const node: PMNode = { type: "paragraph", content: parseInline(text) };
    if (isColor(color)) node.attrs = { color };
    return { nodes: [withIndentAttr(node)], end: start + 1 };
  }
  const closeIdx = i;

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
  let i = start + 1;
  let closed = false;
  for (; i < lines.length; i++) {
    if (
      lines[i].slice(indent) === closeTag &&
      leadingTabs(lines[i]) >= indent
    ) {
      closed = true;
      break;
    }
  }
  if (!closed) {
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
// after it that closes a cell or starts or ends a row, or `close`: a table of
// unclosed cells would otherwise rescan the rest of itself from every one.
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
      ROW_EDGE.test(line) || CELL_LINE_END.test(line)
        ? index
        : next[index - start + 1];
  }
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

  let close = start + 1;
  while (close < lines.length && lineAt(close) !== "</table>") close++;
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
  const rows: Array<{ color: string | null; cells: string[] }> = [];
  let cellCloses: Int32Array | null = null;

  let i = start + 1;
  while (i < close) {
    const ld = lineAt(i++);
    if (!ld || TABLE_WRAPPER_LINE.test(ld)) continue;
    const colMatch = ld.match(/^<col(\s[^>]*?)?\s*\/?>$/);
    if (colMatch) {
      const a = readAttrs("col", colMatch[1] ?? "", COL_ATTRS);
      colMeta.push({ color: a.color, width: a.width });
      continue;
    }
    const rowMatch = ld.match(/^<tr(\s[^>]*?)?>(.*)$/);
    if (!rowMatch) {
      reportLoss("dropped-source", ld);
      continue;
    }
    const rowAttrs = readAttrs("tr", rowMatch[1] ?? "", ROW_ATTRS);
    const cells: string[] = [];
    // An agent may write a whole row on its line; the writer never does.
    let rest = rowMatch[2].trim();
    let rowClosed = rest.endsWith("</tr>");
    if (rowClosed) rest = rest.slice(0, -"</tr>".length).trim();
    if (rest) pushAll(cells, splitTableCells(rest));
    while (!rowClosed && i < close) {
      let cd = lineAt(i++);
      if (cd === "</tr>") break;
      if (!cd) continue;
      // HTML reads a cell's line breaks as spaces.
      if (/^<t[dh][\s>]/.test(cd) && !CELL_LINE_END.test(cd)) {
        cellCloses ??= cellClosesFrom(start, close, lineAt);
        const end = cellCloses[i - start];
        // A cell left open at its row's end is dropped, not read into the
        // next row.
        if (end < close && !ROW_EDGE.test(lineAt(end))) {
          for (; i <= end; i++) cd += ` ${lineAt(i)}`;
          cd = cd
            .replace(/^(<t[dh][^>]*>)\s+/, "$1")
            .replace(/\s+(<\/t[dh]>)(?=(?:\s*<\/tr>)?$)/, "$1");
        }
      }
      rowClosed = /<\/t[dh]>\s*<\/tr>$/.test(cd);
      if (rowClosed) cd = cd.replace(/\s*<\/tr>$/, "");
      // The writer puts one cell on a line and escapes `<` outside code and
      // math, so a close tag outside those before the line's end is an
      // agent's `<td>a</td><td>b</td>`.
      pushAll(cells, splitTableCells(cd));
    }
    rows.push({
      color: isColor(rowAttrs.color) ? rowAttrs.color : null,
      cells,
    });
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

  // The writer spells header cells as attributes, never `<th>`, so an
  // agent's `<th>` cells name the header row or column when no attribute
  // does.
  const allHeaders = (cells: Array<{ header: boolean }>) =>
    cells.length > 0 && cells.every((cell) => cell.header);
  const headerRow =
    openAttrs["header-row"] !== undefined
      ? openAttrs["header-row"] === "true"
      : parsedRows.length > 0 && allHeaders(parsedRows[0].cells);
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
// A cell's line may also close its row; the writer never closes one there.
const CELL_LINE_END = /<\/t[dh]>(?:\s*<\/tr>)?$/;

function splitTableCells(source: string): string[] {
  const cells: string[] = [];
  // Found by hand, not by one regex: searching from every open tag for a `>`
  // or a close tag the row lacks rescans the rest of it from each one. A
  // close tag in code or math, or after a backslash, is the cell's text.
  const lastClose = {
    td: source.lastIndexOf("</td>"),
    th: source.lastIndexOf("</th>"),
  };
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
        : findToken(source, closeTag, contentFrom);
    if (close < 0) {
      // Later open tags of this kind count as unclosed too, so no search
      // runs to the end of the row twice.
      lastClose[tag] = -1;
      open.lastIndex = m.index + 1;
      continue;
    }
    const end = close + closeTag.length;
    const between = source.slice(last, m.index).trim();
    if (between) reportLoss("dropped-source", between);
    cells.push(source.slice(m.index, end));
    last = open.lastIndex = end;
  }
  const after = source.slice(last).trim();
  if (after) reportLoss("dropped-source", after);
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
