
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
    if (text[i] === "\\" && i + 1 < text.length && ESCAPABLE.has(text[i + 1])) {
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

function escapeLeadingBlockMarker(text: string): string {
  if (LEADING_BLOCK_MARKER.test(text) || DIVIDER_LOOKALIKE.test(text.trim())) {
    return "\\" + text;
  }
  return text;
}

function unescapeLeadingBlockMarker(text: string): string {
  if (
    text[0] === "\\" &&
    (LEADING_BLOCK_MARKER.test(text.slice(1)) ||
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

function splitBlockAttrs(line: string): {
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
  return { text: m[1], toggle, color };
}


function markOf(node: PMNode, type: string): PMMark | undefined {
  return node.marks?.find((m) => m.type === type);
}

function serializeInlineAtom(node: PMNode): string {
  const tagName = (node.attrs?.tagName as string) || "mention";
  const label = (node.attrs?.label as string) || "";
  let attrs: Record<string, string> = {};
  try {
    attrs = JSON.parse((node.attrs?.attrsJson as string) || "{}");
  } catch {
    attrs = {};
  }
  if (tagName === "math") {
    return "$" + (label || attrs.latex || "") + "$";
  }
  const attrEntries = Object.entries(attrs).filter(([k]) => k !== "latex");
  const attrStr = serializeAttrs(attrEntries);
  const selfClosing = !label.trim();
  if (selfClosing) return `<${tagName}${attrStr}/>`;
  return `<${tagName}${attrStr}>${escapeAttr(label)}</${tagName}>`;
}

function serializeInline(nodes: PMNode[] | undefined): string {
  if (!nodes || !nodes.length) return "";
  return nodes.map(serializeInlineNode).join("");
}

function serializeInlineTextNode(
  node: PMNode,
  collectOffsets: boolean,
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
    const isAllSpaces = /^ *$/.test(codeText);
    const longestRun = Math.max(
      0,
      ...(codeText.match(/`+/g) || []).map((r) => r.length),
    );
    const delim = "`".repeat(Math.max(1, longestRun + 1));
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
    out = escapeInlineText(raw);
    if (textOffsets) {
      let contentOffset = 0;
      textOffsets = [contentOffset];
      for (let index = 0; index < raw.length; index += 1) {
        contentOffset += escapeInlineText(raw[index]!).length;
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

export function serializeInlineTextNodeWithOffsets(node: PMNode): {
  source: string;
  textOffsets: number[];
} | null {
  const serialized = serializeInlineTextNode(node, true);
  return serialized?.textOffsets
    ? { source: serialized.source, textOffsets: serialized.textOffsets }
    : null;
}

export function serializeInlineNode(node: PMNode): string {
  if (node.type === "hardBreak") return "<br>";
  if (node.type === "notionInlineAtom") return serializeInlineAtom(node);
  const textNode = serializeInlineTextNode(node, false);
  if (textNode) return textNode.source;
  return node.text ? escapeInlineText(node.text) : "";
}


function textNode(text: string, marks: PMMark[]): PMNode {
  return marks.length ? { type: "text", text, marks } : { type: "text", text };
}

function addMark(nodes: PMNode[], mark: PMMark): void {
  for (const n of nodes) {
    if (n.type === "text") {
      n.marks = n.marks || [];
      if (!n.marks.some((m) => m.type === mark.type)) n.marks.push(mark);
    }
  }
}

function mergeSpanMark(nodes: PMNode[], attrs: Record<string, string>): void {
  const color = attrs.color;
  const isBg = color ? color.endsWith("_bg") : false;
  const explicitBackground = attrs.bg_color;
  const spanAttrs: Record<string, any> = {
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
  for (const n of nodes) {
    if (n.type === "text") {
      n.marks = n.marks || [];
      if (!n.marks.some((m) => m.type === "notionSpan")) {
        n.marks.push({ type: "notionSpan", attrs: spanAttrs });
      }
    }
  }
}

function findToken(s: string, token: string, from: number): number {
  for (let i = from; i <= s.length - token.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s.startsWith(token, i)) return i;
  }
  return -1;
}

function parseInline(input: string): PMNode[] {
  const out: PMNode[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) {
      out.push(textNode(buf, []));
      buf = "";
    }
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === "\\" && i + 1 < input.length && ESCAPABLE.has(input[i + 1])) {
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
        const attrs = parseAttrs(input.slice(i + 5, open));
        const inner = parseInline(input.slice(open + 1, close));
        mergeSpanMark(inner, attrs);
        out.push(...inner);
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
      if (close !== -1) {
        flush();
        const inner = parseInline(input.slice(i + 3, close));
        addMark(inner, { type: "bold" });
        addMark(inner, { type: "italic" });
        out.push(...inner);
        i = close + 3;
        continue;
      }
    }

    if (input.startsWith("**", i)) {
      const close = findToken(input, "**", i + 2);
      if (close !== -1) {
        flush();
        const inner = parseInline(input.slice(i + 2, close));
        addMark(inner, { type: "bold" });
        out.push(...inner);
        i = close + 2;
        continue;
      }
    }

    if (input.startsWith("~~", i)) {
      const close = findToken(input, "~~", i + 2);
      if (close !== -1) {
        flush();
        const inner = parseInline(input.slice(i + 2, close));
        addMark(inner, { type: "strike" });
        out.push(...inner);
        i = close + 2;
        continue;
      }
    }

    if (ch === "*") {
      const close = findToken(input, "*", i + 1);
      if (close !== -1) {
        flush();
        const inner = parseInline(input.slice(i + 1, close));
        addMark(inner, { type: "italic" });
        out.push(...inner);
        i = close + 1;
        continue;
      }
    }

    if (ch === "[") {
      const link = matchLink(input, i);
      if (link) {
        flush();
        const inner = parseInline(link.text);
        addMark(inner, { type: "link", attrs: { href: link.href } });
        out.push(...inner);
        i = link.end;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

function makeInlineAtom(
  tagName: string,
  rawAttrs: string,
  label: string,
): PMNode {
  const attrs = parseAttrs(rawAttrs);
  return {
    type: "notionInlineAtom",
    attrs: {
      tagName,
      attrsJson: JSON.stringify(attrs),
      label: unescapeAttr(label).trim(),
    },
  };
}

function findMatchingBracketClose(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "[") depth++;
    else if (s[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingParenClose(s: string, openParenIdx: number): number {
  let depth = 0;
  for (let i = openParenIdx; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
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
): { text: string; href: string; end: number } | null {
  const closeBracket = findMatchingBracketClose(s, start);
  if (closeBracket === -1 || s[closeBracket + 1] !== "(") return null;
  const closeParen = findMatchingParenClose(s, closeBracket + 1);
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
}

let activeSerializeContext: NfmSerializeContext | null = null;
let suppressTerminalFillerTrim = false;

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
  if (suppressTerminalFillerTrim) return blocks;
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
  const serializableBlocks = isTopLevel
    ? trimEditorTerminalFiller(blocks)
    : blocks;
  for (let i = 0; i < serializableBlocks.length; i++) {
    const block = serializableBlocks[i];
    if (block.type === "bulletList" || block.type === "orderedList") {
      out.push(...serializeList(block, indent));
    } else if (block.type === "taskList") {
      out.push(...serializeTaskList(block, indent));
    } else {
      out.push(...serializeBlock(block, indent));
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
      return [
        indentStr(ind) +
          escapeLeadingBlockMarker(inline) +
          blockAttrSuffix({ color: node.attrs?.color }),
      ];
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
      const longestRun = Math.max(
        0,
        ...(text.match(/`+/g) || []).map((r) => r.length),
      );
      const fence = "`".repeat(Math.max(3, longestRun + 1));
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
      out.push(...serializeBlocks(node.content || [], ind + 1));
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
  out.push(...serializeBlocks(children, ind + 1));
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
    out.push(...serializeBlocks(node.content || [], ind + 1));
    return out;
  }
  const attrStr = serializeAttrs([["color", isColor(color) ? color : null]]);
  const openAttr = node.attrs?.open === true ? " open" : "";
  out.push(indentStr(ind) + `<details${attrStr}${openAttr}>`);
  out.push(indentStr(ind) + `<summary>${summary}</summary>`);
  out.push(...serializeBlocks(node.content || [], ind + 1));
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
  out.push(...serializeBlocks(node.content || [], ind + 1));
  out.push(indentStr(ind) + "</callout>");
  return out;
}

function serializeColumns(node: PMNode, ind: number): string[] {
  const out = [indentStr(ind) + "<columns>"];
  out.push(...serializeBlocks(node.content || [], ind + 1));
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
  out.push(...serializeBlocks(node.content || [], ind + 1));
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
    out.push(...serializeBlocks(children, indent + 1));
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
    out.push(...serializeBlocks(children, indent + 1));
  }
  return out;
}

function serializeCellInline(cell: PMNode): string {
  const parts: string[] = [];
  for (const child of cell.content || []) {
    const part = serializeCellChildInline(child);
    if (part) parts.push(part);
  }
  return parts.join("<br>");
}

function serializeCellChildInline(node: PMNode): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return serializeInline(node.content);
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const items: string[] = [];
      for (const item of node.content || []) {
        const textPara = firstParagraph(item);
        const inline = textPara ? serializeInline(textPara.content) : "";
        if (inline) items.push(inline);
      }
      return items.join("<br>");
    }
    case "blockquote": {
      const parts: string[] = [];
      for (const child of node.content || []) {
        const part = serializeCellChildInline(child);
        if (part) parts.push(part);
      }
      return parts.join("<br>");
    }
    default:
      return serializeInline(node.content);
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

export function nfmToDoc(nfm: string | null | undefined): PMDoc {
  const lines = (nfm ?? "").replace(/\r\n?/g, "\n").split("\n");
  const { nodes } = parseBlockSequence(lines, 0, 0);
  return {
    type: "doc",
    content: nodes.length ? nodes : [{ type: "paragraph" }],
  };
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

    const listKind = listKindOf(dedent);
    if (listKind) {
      const res = parseList(lines, i, ind, listKind);
      out.push(res.nodes[0]);
      i = res.end;
      continue;
    }

    const res = parseSingleBlock(lines, i, ind, rel);
    if (res.nodes.length) out.push(...res.nodes);
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
  let fence: { length: number; promoteBy: number } | undefined;
  const sourceLines = lines.slice(start, end);
  const hasMatchingClose = (from: number, tagKey: string): boolean => {
    const closeTag = CONTAINER_CLOSE[tagKey];
    let depth = 1;
    let fenceLength = 0;
    for (let i = from + 1; i < sourceLines.length; i++) {
      const candidate = sourceLines[i].slice(leadingTabs(sourceLines[i]));
      const fenceMatch = candidate.match(/^(`{3,})(.*)$/);
      if (fenceLength) {
        if (
          fenceMatch &&
          !fenceMatch[2].trim() &&
          fenceMatch[1].length >= fenceLength
        ) {
          fenceLength = 0;
        }
        continue;
      }
      if (fenceMatch) {
        fenceLength = fenceMatch[1].length;
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
      const close = dedented.match(/^(`{3,})\s*$/);
      if (close && close[1].length >= fence.length) fence = undefined;
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
    const open = dedented.match(/^(`{3,})(.*)$/);
    if (open) {
      const promoteBy = Math.max(0, requiredIndent - indent);
      fence = { length: open[1].length, promoteBy };
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
  return /^-{3,}$/.test(value.trim());
}

function isAlignedGfmDelimiterCell(value: string): boolean {
  return /^:?-{3,}:?$/.test(value.trim()) && value.includes(":");
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

  const columnCount = Math.max(header.length, ...rows.map((row) => row.length));
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

function parseList(
  lines: string[],
  start: number,
  indent: number,
  kind: ListKind,
): ParseResult {
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

  if (/^<empty-block\s*\/?>/.test(dedent)) {
    return { nodes: [withIndentAttr({ type: "paragraph" })], end: start + 1 };
  }

  if (/^(---+|\*\*\*+|___+)$/.test(dedent.trim())) {
    return {
      nodes: [withIndentAttr({ type: "horizontalRule" })],
      end: start + 1,
    };
  }

  const fenceOpenMatch = dedent.match(/^(`{3,})(.*)$/);
  if (fenceOpenMatch) {
    const fenceLen = fenceOpenMatch[1].length;
    const lang = fenceOpenMatch[2].trim();
    const body: string[] = [];
    let i = start + 1;
    for (; i < lines.length; i++) {
      const l = lines[i];
      const ld = l.slice(Math.min(indent, leadingTabs(l)));
      const closeMatch = ld.trim().match(/^(`{3,})\s*$/);
      if (
        closeMatch &&
        closeMatch[1].length >= fenceLen &&
        leadingTabs(l) >= indent
      )
        break;
      body.push(stripTabs(l, indent));
    }
    const node: PMNode = {
      type: "codeBlock",
      attrs: { language: lang || null },
      content: body.length ? [{ type: "text", text: body.join("\n") }] : [],
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
    const { text, toggle, color } = splitBlockAttrs(headingMatch[2]);
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
  let fence: { indent: number; length: number } | undefined;
  for (; i < lines.length; i++) {
    const li = leadingTabs(lines[i]);
    const ld = lines[i].slice(li);
    if (fence) {
      const close = ld.match(/^(`{3,})\s*$/);
      if (close && close[1].length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    const openFence = ld.match(/^(`{3,})(.*)$/);
    if (openFence) {
      fence = { indent: li, length: openFence[1].length };
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
    const attrs = parseAttrs(openLine);
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
    const attrs = parseAttrs(openLine);
    const childRes = parseBlockSequence(lines, childStart, indent + 1);
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
    const columns = childRes.nodes.filter((n) => n.type === "notionColumn");
    const node: PMNode = { type: "notionColumns", content: columns };
    return { nodes: [withIndentAttr(node)], end: closeIdx + 1 };
  }

  if (tagKey === "<column>") {
    const childRes = parseBlockSequence(lines, childStart, indent + 1);
    const node: PMNode = { type: "notionColumn", content: childRes.nodes };
    return { nodes: [withIndentAttr(node)], end: closeIdx + 1 };
  }

  if (tagKey === "<synced_block" || tagKey === "<synced_block_reference") {
    const attrs = parseAttrs(openLine);
    const childRes = parseBlockSequence(lines, childStart, indent + 1);
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

function parseTable(
  lines: string[],
  start: number,
  indent: number,
  withIndentAttr: (n: PMNode) => PMNode,
): ParseResult {
  const openAttrs = parseAttrs(lines[start].slice(indent));
  const headerRow = openAttrs["header-row"] === "true";
  const headerColumn = openAttrs["header-column"] === "true";
  const fitPageWidth = openAttrs["fit-page-width"] === "true";

  let i = start + 1;
  const colMeta: Array<{ color?: string; width?: string }> = [];
  const rows: PMNode[] = [];
  let closed = false;

  for (; i < lines.length; i++) {
    const ld = lines[i].slice(Math.min(indent, leadingTabs(lines[i]))).trim();
    if (ld === "</table>") {
      i++;
      closed = true;
      break;
    }
    if (ld === "<colgroup>") continue;
    if (ld === "</colgroup>") continue;
    const colMatch = ld.match(/^<col([^>]*)\/?>$/);
    if (colMatch) {
      const a = parseAttrs(colMatch[1]);
      colMeta.push({ color: a.color, width: a.width });
      continue;
    }
    if (/^<tr/.test(ld)) {
      const rowAttrs = parseAttrs(ld);
      const cells: PMNode[] = [];
      for (i++; i < lines.length; i++) {
        const cd = lines[i]
          .slice(Math.min(indent, leadingTabs(lines[i])))
          .trim();
        if (cd === "</tr>") break;
        const cellMatch = cd.match(/^<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>$/);
        if (cellMatch) {
          const ca = parseAttrs(cellMatch[1]);
          const isHeader =
            (headerRow && rows.length === 0) ||
            (headerColumn && cells.length === 0);
          cells.push({
            type: isHeader ? "tableHeader" : "tableCell",
            attrs: {
              color: isColor(ca.color) ? ca.color : null,
              textAlign: isTableAlignment(ca.align) ? ca.align : null,
            },
            content: [
              { type: "paragraph", content: parseInline(cellMatch[2]) },
            ],
          });
        }
      }
      rows.push({
        type: "tableRow",
        attrs: { color: isColor(rowAttrs.color) ? rowAttrs.color : null },
        content: cells,
      });
    }
  }

  if (!closed) {
    const openLine = lines[start].slice(indent);
    const { text, color } = splitBlockAttrs(openLine);
    const node: PMNode = { type: "paragraph", content: parseInline(text) };
    if (isColor(color)) node.attrs = { color };
    return { nodes: [withIndentAttr(node)], end: start + 1 };
  }

  const node: PMNode = {
    type: "table",
    attrs: {
      headerRow,
      headerColumn,
      fitPageWidth,
      colMeta: colMeta.length ? colMeta : null,
    },
    content: rows,
  };
  return { nodes: [withIndentAttr(node)], end: i };
}

const MEDIA_TAGS = new Set(["video", "audio"]);
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
    const attrs = parseAttrs(rawAttrs);
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
    const attrs = parseAttrs(rawAttrs);
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
  const previous = suppressTerminalFillerTrim;
  suppressTerminalFillerTrim = true;
  try {
    return docToNfm(nfmToDoc(nfm ?? ""));
  } finally {
    suppressTerminalFillerTrim = previous;
  }
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
  let fence: { indent: number; length: number } | undefined;
  for (let index = 0; index < lines.length; index++) {
    const indent = leadingTabs(lines[index]);
    const dedented = lines[index].slice(indent);
    if (fence) {
      mask[index] = true;
      const close = dedented.match(/^(`{3,})\s*$/);
      if (indent >= fence.indent && close && close[1].length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    const open = dedented.match(/^(`{3,})(.*)$/);
    if (open) {
      mask[index] = true;
      fence = { indent, length: open[1].length };
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
