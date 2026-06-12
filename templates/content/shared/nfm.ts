/**
 * Notion-Flavored Markdown (NFM) ⇄ ProseMirror JSON.
 *
 * This is the single, deterministic bridge between Notion's canonical
 * Notion-flavored Markdown (the exact bytes Notion's `/pages/{id}/markdown`
 * API emits and accepts, Notion-Version 2026-03-11) and the TipTap/ProseMirror
 * document used by the editor.
 *
 * Design goals (the whole reason this exists):
 *   1. Idempotency / no drift. `docToNfm(nfmToDoc(x)) === x` for every piece of
 *      canonical NFM `x`. A document authored in Notion, pulled, opened in the
 *      editor, and saved back with no edits produces byte-identical NFM — so
 *      pulling and pushing never mutates content.
 *   2. Lossless fidelity. Every Notion block/inline type round-trips, including
 *      quotes, toggle headings, block colors, tables (with header rows/columns
 *      and cell colors), equations, callouts, columns, synced blocks, mentions,
 *      and inline color/underline/background — matching the ground-truth spec at
 *      the `notion://docs/enhanced-markdown-spec` MCP resource.
 *   3. Shared. Pure functions with no editor/React/DOM dependency, usable by the
 *      server (pull canonicalization + content hashing) and the editor
 *      (`setContent(nfmToDoc(x))` / `docToNfm(editor.getJSON())`) alike.
 *
 * Canonical NFM form (what `docToNfm` emits):
 *   - One block per line; children indented one extra TAB. No blank separator
 *     lines (Notion strips them). Intentional blank blocks are `<empty-block/>`.
 *   - Block attributes as a trailing `{toggle="true" color="red"}` list.
 *   - Tables, toggles, callouts, columns, synced blocks, media, mentions use the
 *     HTML-ish tags from the spec. Tables are `<table>` HTML, never pipe tables.
 *   - Inline text backslash-escapes the spec's special characters outside code.
 *
 * Registry blocks (the dev-doc / OpenAPI library shared with plan) are encoded
 * INLINE as PascalCase MDX elements (`<Endpoint …/>`, `<Checklist …/>`). On READ
 * a registered tag becomes a `registryBlock` atom carrying the verbatim element
 * source in `__raw`; on WRITE it emits that `__raw` back (or re-serializes from
 * the editor's typed data). This module stays React-free — it only consults the
 * content registry's tag set (`@agent-native/core/blocks/server` config) to tell
 * a registered PascalCase block tag from a lowercase Notion container tag.
 *
 * Local-file content can also use repo-local MDX components. Unknown PascalCase
 * tags become `localMdxComponent` atoms that preserve their exact source while
 * exposing simple string props for the editor preview layer.
 */

import { isRegistryBlockTag, registryBlockSpecByTag } from "./nfm-registry.js";

// ── Shared PM JSON types ────────────────────────────────────────────
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

// ── Colors (from the NFM spec) ──────────────────────────────────────
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

// ── Inline escaping ─────────────────────────────────────────────────
// The spec escapes these characters OUTSIDE code: \ * ~ ` $ [ ] < > { } | ^
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

// ── Attribute helpers (for the HTML-ish tags) ───────────────────────
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

// Trailing `{toggle="true" color="red"}` attribute list on a block line.
function blockAttrSuffix(opts: {
  toggle?: boolean;
  color?: string | null;
}): string {
  const parts: string[] = [];
  if (opts.toggle) parts.push('toggle="true"');
  if (isColor(opts.color)) parts.push(`color="${opts.color}"`);
  return parts.length ? ` {${parts.join(" ")}}` : "";
}
// Strip + read a trailing `{...}` attribute list from a block line.
function splitBlockAttrs(line: string): {
  text: string;
  toggle: boolean;
  color: string | null;
} {
  const m = line.match(/^(.*?)\s*\{([^{}]*)\}\s*$/);
  if (!m) return { text: line, toggle: false, color: null };
  const body = m[2];
  const toggle = /\btoggle\s*=\s*"true"/.test(body);
  const colorMatch = body.match(/\bcolor\s*=\s*"([^"]+)"/);
  const color = colorMatch && isColor(colorMatch[1]) ? colorMatch[1] : null;
  // Only treat as an attribute list if it actually contained known attrs;
  // otherwise it was literal braces (which would have been escaped anyway).
  if (!toggle && !color) return { text: line, toggle: false, color: null };
  return { text: m[1], toggle, color };
}

// ════════════════════════════════════════════════════════════════════
// INLINE: serialize
// ════════════════════════════════════════════════════════════════════

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
    return "$`" + (label || attrs.latex || "") + "`$";
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

function serializeInlineNode(node: PMNode): string {
  if (node.type === "hardBreak") return "<br>";
  if (node.type === "notionInlineAtom") return serializeInlineAtom(node);
  if (node.type !== "text") {
    // Unknown inline node — best-effort textContent.
    return node.text ? escapeInlineText(node.text) : "";
  }

  const raw = node.text ?? "";
  const code = markOf(node, "code");
  let out: string;
  if (code) {
    out = "`" + raw.replace(/\n/g, "<br>") + "`";
  } else {
    out = escapeInlineText(raw);
  }

  const bold = markOf(node, "bold");
  const italic = markOf(node, "italic");
  if (bold && italic) {
    out = "***" + out + "***";
  } else {
    if (markOf(node, "strike")) out = "~~" + out + "~~";
    if (italic) out = "*" + out + "*";
    if (bold) out = "**" + out + "**";
  }
  if (!(bold && italic) && markOf(node, "strike") && (bold || italic)) {
    // strike already applied above; nothing to do
  }
  // strike for the bold+italic branch
  if (bold && italic && markOf(node, "strike")) {
    out = "~~" + out + "~~";
  }

  const span = markOf(node, "notionSpan");
  if (span) {
    const a = span.attrs || {};
    const attrStr = serializeAttrs([
      ["color", a.color || a.bgColor || null],
      [
        "underline",
        a.underline === "true" || a.underline === true ? "true" : null,
      ],
    ]);
    if (attrStr) out = `<span${attrStr}>${out}</span>`;
  }

  const link = markOf(node, "link");
  if (link?.attrs?.href) {
    out = `[${out}](${link.attrs.href})`;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// INLINE: parse
// ════════════════════════════════════════════════════════════════════

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
  const spanAttrs: Record<string, any> = {
    color: color && !isBg ? color : null,
    bgColor: color && isBg ? color : null,
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

// Find the index of the next unescaped occurrence of `token` starting at `from`.
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

    // Escape
    if (ch === "\\" && i + 1 < input.length && ESCAPABLE.has(input[i + 1])) {
      buf += input[i + 1];
      i += 2;
      continue;
    }

    // Inline math $`...`$
    if (ch === "$" && input[i + 1] === "`") {
      const close = input.indexOf("`$", i + 2);
      if (close !== -1) {
        flush();
        const latex = input.slice(i + 2, close);
        out.push({
          type: "notionInlineAtom",
          attrs: { tagName: "math", attrsJson: "{}", label: latex },
        });
        i = close + 2;
        continue;
      }
    }

    // Inline code `...`
    if (ch === "`") {
      const close = input.indexOf("`", i + 1);
      if (close !== -1) {
        flush();
        const codeText = input.slice(i + 1, close).replace(/<br\/?>/g, "\n");
        out.push(textNode(codeText, [{ type: "code" }]));
        i = close + 1;
        continue;
      }
    }

    // Hard break
    if (input.startsWith("<br/>", i) || input.startsWith("<br>", i)) {
      flush();
      out.push({ type: "hardBreak" });
      i += input.startsWith("<br/>", i) ? 5 : 4;
      continue;
    }

    // <span ...>...</span>
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

    // Inline mention / atom tags: <mention-*...> or <mention-*.../>
    if (input.startsWith("<mention-", i)) {
      const selfClose = input.indexOf("/>", i);
      const open = input.indexOf(">", i);
      // self-closing form <mention-date .../>
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

    // Bold+italic ***...***
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

    // Bold **...**
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

    // Strike ~~...~~
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

    // Italic *...*
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

    // Link [text](url)
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
      label: label.trim(),
    },
  };
}

function matchLink(
  s: string,
  start: number,
): { text: string; href: string; end: number } | null {
  // Find matching unescaped ] then immediately ( ... )
  let depth = 0;
  let i = start;
  let closeBracket = -1;
  for (; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "[") depth++;
    else if (s[i] === "]") {
      depth--;
      if (depth === 0) {
        closeBracket = i;
        break;
      }
    }
  }
  if (closeBracket === -1 || s[closeBracket + 1] !== "(") return null;
  const closeParen = s.indexOf(")", closeBracket + 2);
  if (closeParen === -1) return null;
  return {
    text: s.slice(start + 1, closeBracket),
    href: s.slice(closeBracket + 2, closeParen),
    end: closeParen + 1,
  };
}

// ════════════════════════════════════════════════════════════════════
// BLOCK: serialize (docToNfm)
// ════════════════════════════════════════════════════════════════════

const TAB = "\t";
function indentStr(n: number): string {
  return TAB.repeat(Math.max(0, n));
}

/**
 * Optional serialize-side context for registry blocks. When the editor has live
 * typed `data` for a `registryBlock` node (from the side-map), it supplies
 * `serializeRegistryBlock(blockId)` so an EDITED block re-serializes from its
 * current data. An UNTOUCHED block (server pull, content hashing, or any
 * block the context can't resolve) falls back to the node's preserved `__raw`,
 * keeping the round-trip byte-exact with no registry/React dependency.
 *
 * It is held in a module-scoped guard for the duration of the synchronous
 * `docToNfm` call rather than threaded through every serialize helper — JS is
 * single-threaded and `docToNfm` is synchronous and non-reentrant, so the guard
 * is set on entry and always cleared in `finally`.
 */
export interface NfmSerializeContext {
  /**
   * Re-serialize a registry block to its exact MDX string from the editor's
   * current typed `data`, or return `undefined`/`null` to fall back to `__raw`.
   */
  serializeRegistryBlock?: (
    blockId: string,
    node: PMNode,
  ) => string | undefined | null;
}

let activeSerializeContext: NfmSerializeContext | null = null;

export function docToNfm(
  doc: PMDoc | PMNode | null | undefined,
  context?: NfmSerializeContext,
): string {
  const content = (doc?.content as PMNode[]) || [];
  const previous = activeSerializeContext;
  activeSerializeContext = context ?? null;
  try {
    const lines = serializeBlocks(content, 0);
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

function serializeBlocks(blocks: PMNode[], indent: number): string[] {
  const out: string[] = [];
  const serializableBlocks = trimEditorTerminalFiller(blocks);
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
        indentStr(ind) + inline + blockAttrSuffix({ color: node.attrs?.color }),
      ];
    }
    case "heading": {
      const level = Math.min(4, Math.max(1, Number(node.attrs?.level) || 1));
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
      return [indentStr(ind) + "```" + lang, ...body, indentStr(ind) + "```"];
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
    case "localMdxComponent":
      return serializeRawSourceBlock(node, ind);
    default: {
      // Unknown block: preserve its raw text if present so nothing is lost.
      const raw = serializeRawSourceBlock(node, ind);
      if (raw.length > 0) return raw;
      const inline = serializeInline(node.content);
      return inline ? [indentStr(ind) + inline] : [];
    }
  }
}

function serializeChildrenAfterFirst(node: PMNode, indent: number): string[] {
  const children = (node.content || []).slice(1);
  return serializeBlocks(children, indent);
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
  // Children (blocks after the text paragraph) are nested one tab deeper.
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
        escapeInlineText(summary) +
        blockAttrSuffix({ toggle: true, color }),
    );
    out.push(...serializeBlocks(node.content || [], ind + 1));
    return out;
  }
  const attrStr = serializeAttrs([["color", isColor(color) ? color : null]]);
  out.push(indentStr(ind) + `<details${attrStr}>`);
  out.push(indentStr(ind) + `<summary>${escapeInlineText(summary)}</summary>`);
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
  return [indentStr(ind) + `![${escapeInlineText(alt)}](${src})${suffix}`];
}

function serializeMedia(node: PMNode, ind: number): string[] {
  const tag = node.type; // video | audio
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

/**
 * Serialize a `registryBlock` atom node back to its inline MDX element lines.
 *
 * Order of precedence:
 *   1. An EDITED block: the active serialize context resolves the node by its
 *      `blockId` to a fresh MDX string re-serialized from the editor's typed
 *      `data` (via core `serializeSpecBlock`).
 *   2. An UNTOUCHED block: emit the node's preserved `__raw` verbatim — the
 *      exact bytes captured on parse. This is the default path for server pull,
 *      content hashing, and any block the context can't (or chooses not to)
 *      re-serialize, so the round-trip stays byte-exact with no React/registry.
 *
 * Either way the resulting MDX is split on newlines and each line is indented to
 * the block's structural depth, exactly like every other block.
 */
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
      // Cells hold inline rich text only; flatten the single paragraph.
      const para =
        cell.content?.find((c) => c.type === "paragraph") || cell.content?.[0];
      const inline = para ? serializeInline(para.content) : "";
      const cellAttrStr = serializeAttrs([["color", cellColor]]);
      out.push(indentStr(ind) + `<td${cellAttrStr}>${inline}</td>`);
    }
    out.push(indentStr(ind) + "</tr>");
  }
  out.push(indentStr(ind) + "</table>");
  return out;
}

// ════════════════════════════════════════════════════════════════════
// BLOCK: parse (nfmToDoc)
// ════════════════════════════════════════════════════════════════════

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

    // Lists group consecutive items.
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

    // Children: deeper-indented blocks belong to this item.
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

  // Empty block
  if (/^<empty-block\s*\/?>/.test(dedent)) {
    return { nodes: [withIndentAttr({ type: "paragraph" })], end: start + 1 };
  }

  // Divider
  if (/^(---+|\*\*\*+|___+)$/.test(dedent.trim())) {
    return {
      nodes: [withIndentAttr({ type: "horizontalRule" })],
      end: start + 1,
    };
  }

  // Code fence
  if (/^```/.test(dedent)) {
    const lang = dedent.slice(3).trim();
    const body: string[] = [];
    let i = start + 1;
    for (; i < lines.length; i++) {
      const l = lines[i];
      const ld = l.slice(Math.min(indent, leadingTabs(l)));
      if (/^```\s*$/.test(ld.trim()) && leadingTabs(l) >= indent) break;
      // Strip exactly `indent` leading tabs (structural), keep the rest literal.
      body.push(stripTabs(l, indent));
    }
    const node: PMNode = {
      type: "codeBlock",
      attrs: { language: lang || null },
      content: body.length ? [{ type: "text", text: body.join("\n") }] : [],
    };
    return { nodes: [withIndentAttr(node)], end: i + 1 };
  }

  // Block equation $$ ... $$
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

  // Heading (possibly a toggle heading)
  const headingMatch = dedent.match(/^(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const level = Math.min(4, headingMatch[1].length);
    const { text, toggle, color } = splitBlockAttrs(headingMatch[2]);
    if (toggle) {
      const childRes = parseBlockSequence(lines, start + 1, indent + 1);
      const node: PMNode = {
        type: "notionToggle",
        attrs: {
          summary: unescapeInlineText(text),
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

  // Quote
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

  // Registry block (PascalCase MDX element: <Endpoint .../>, <Checklist .../>,
  // <DataModel …>…</DataModel>, …). These are the dev-doc / OpenAPI library
  // blocks shared with plan, encoded inline. They are recognized by the content
  // registry's tag set; lowercase Notion container tags never match. The
  // verbatim element source is preserved as `__raw` so an untouched block
  // round-trips byte-exact without the registry/React; the editor hydrates typed
  // `data` from `__raw` separately via `parseRegistryBlockData`.
  const registryTag = matchRegistryBlockOpen(dedent);
  if (registryTag) {
    return parseRegistryBlock(lines, start, indent, rel, registryTag);
  }

  // Repo-local MDX component (PascalCase element not owned by the shared block
  // registry). It remains source-of-truth MDX on disk, but can render through
  // the local `components/*` preview bridge in the editor.
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

  // Container tags
  const containerTag = matchContainerOpen(dedent);
  if (containerTag) {
    return parseContainer(lines, start, indent, rel, containerTag);
  }

  // Image ![alt](src)
  const imageMatch = dedent.match(
    /^!\[([^\]]*)\]\(([^)]*)\)\s*(\{[^}]*\})?\s*$/,
  );
  if (imageMatch) {
    const colorMatch = imageMatch[3]?.match(/color="([^"]+)"/);
    const node: PMNode = {
      type: "image",
      attrs: {
        src: imageMatch[2],
        alt: unescapeInlineText(imageMatch[1]),
        ...(colorMatch && isColor(colorMatch[1])
          ? { color: colorMatch[1] }
          : {}),
      },
    };
    return { nodes: [withIndentAttr(node)], end: start + 1 };
  }

  // Self-contained media / atom tags on one line: <video.../>, <page ...>..</page>, <x .../>
  const tagLine = dedent.match(
    /^<([a-zA-Z_][\w-]*)([^>]*?)(\/?)>(?:([\s\S]*?)<\/\1>)?\s*$/,
  );
  if (tagLine) {
    const node = parseLeafTag(tagLine[1], tagLine[2], tagLine[4] ?? "");
    if (node) return { nodes: [withIndentAttr(node)], end: start + 1 };
  }

  // Plain paragraph
  const { text, color } = splitBlockAttrs(dedent);
  const node: PMNode = { type: "paragraph", content: parseInline(text) };
  if (isColor(color)) node.attrs = { color };
  return { nodes: [withIndentAttr(node)], end: start + 1 };
}

function stripTabs(line: string, count: number): string {
  let i = 0;
  while (i < count && line[i] === "\t") i++;
  return line.slice(i);
}

/**
 * Match a REGISTERED registry-block open tag at the start of a dedented line and
 * return its tag name, or `null`. Only registry tags (`registryBlockSpecByTag`)
 * match, so lowercase Notion container/atom tags (`callout`, `details`, `table`,
 * `page`, `column`) and unknown tags fall through to their existing handling
 * untouched. This only inspects the FIRST line — the full element extent (which
 * may span multiple lines, e.g. `<Checklist items={[\n…\n]} />`) is resolved by
 * `parseRegistryBlock`'s scanner.
 */
function matchRegistryBlockOpen(dedent: string): string | null {
  const m = dedent.match(/^<([A-Za-z_][\w-]*)(?:[\s/>]|$)/);
  if (!m) return null;
  const tag = m[1];
  return registryBlockSpecByTag(tag) ? tag : null;
}

function matchLocalMdxComponentOpen(dedent: string): string | null {
  const m = dedent.match(/^<([A-Z][\w-]*)(?:[\s/>]|$)/);
  if (!m) return null;
  const tag = m[1];
  return registryBlockSpecByTag(tag) ? null : tag;
}

/**
 * Find the index (relative to the joined `text`) just past the opening tag's
 * terminating `>` — i.e. the first top-level `>` that is not inside a quoted
 * string or a `{…}`/`[…]` attribute expression. Returns the index of the char
 * after `>` and whether the tag self-closed (`/>`), or `null` if no terminator
 * is found in `text`.
 */
function scanOpenTagEnd(
  text: string,
): { end: number; selfClosing: boolean } | null {
  let depth = 0; // {} / [] nesting from attribute expressions
  let quote: string | null = null; // active "…" or '…' string
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

/**
 * Parse a registry block into a `registryBlock` atom node, capturing the
 * verbatim element source as `__raw` (with the structural `indent` tabs
 * stripped, so the serializer re-applies indentation like every other block).
 *
 * Handles every shape core's `serializeSpecBlock` emits:
 *   - single-line self-closing            `<Endpoint … />`
 *   - multi-line self-closing attr expr   `<Checklist items={[⏎ … ⏎]} />`
 *   - prose children                       `<Endpoint …>⏎⏎{body}⏎⏎</Endpoint>`
 * It scans the opening tag character-by-character (quote- and brace-aware) to
 * find its terminating `>`, then either stops (self-closing) or scans forward
 * for the matching `</Tag>`.
 *
 * Identity attrs (`blockType`, `blockId`, `title`, `summary`) are read off the
 * opening tag for the side-map/render layer; the typed `data` is NOT parsed here
 * (that is the editor's `parseRegistryBlockData`), keeping this hot path free of
 * the remark toolchain.
 */
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

  // Dedent every candidate line by the structural indent so `__raw` is
  // indent-relative (the serializer re-applies the indent). The opening tag may
  // span several lines, so join from `start` and scan for its terminating `>`.
  const dedented = lines.map((l) => stripTabs(l, indent));

  // Walk forward to find the last line of the opening tag.
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
    // Children-bearing element: scan for the matching close tag, tracking nested
    // same-tag opens for safety.
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
      // Exact tag with no attributes: <columns>, <column>, <meeting-notes>.
      if (dedent === key) return key;
    } else {
      // Tag that may carry attributes: <details ...>, <callout ...>, <table ...>.
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

  // Tables and meeting-notes are parsed as flat tag lines (not tab-indented children).
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

  // Find close line at the same indent.
  let i = start + 1;
  const childStart = i;
  let depth = 1;
  for (; i < lines.length; i++) {
    const li = leadingTabs(lines[i]);
    const ld = lines[i].slice(li);
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
  const closeIdx = i;
  const innerEnd = closeIdx;

  // <details> with a <summary> on the next line.
  if (tagKey === "<details") {
    const attrs = parseAttrs(openLine);
    let summary = "";
    let bodyStart = childStart;
    const summaryLine = lines[childStart]?.slice(indent) ?? "";
    const sm = summaryLine.match(/^<summary>([\s\S]*?)<\/summary>\s*$/);
    if (sm) {
      summary = unescapeInlineText(sm[1]);
      bodyStart = childStart + 1;
    }
    const childRes = parseBlockSequence(lines, bodyStart, indent + 1);
    const node: PMNode = {
      type: "notionToggle",
      attrs: {
        summary,
        headingLevel: null,
        open: false,
        color: isColor(attrs.color) ? attrs.color : null,
        indent: 0,
      },
      content: childRes.nodes,
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

  // Fallback: preserve raw.
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
  for (; i < lines.length; i++) {
    if (lines[i].slice(indent) === closeTag && leadingTabs(lines[i]) >= indent)
      break;
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

  for (; i < lines.length; i++) {
    const ld = lines[i].slice(Math.min(indent, leadingTabs(lines[i]))).trim();
    if (ld === "</table>") {
      i++;
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
      // consume cells until </tr>
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
            attrs: { color: isColor(ca.color) ? ca.color : null },
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

// ════════════════════════════════════════════════════════════════════
// Public helpers
// ════════════════════════════════════════════════════════════════════

/** Canonicalize NFM into the exact stable form (Notion's emission form). */
export function canonicalizeNfm(nfm: string | null | undefined): string {
  return docToNfm(nfmToDoc(nfm ?? ""));
}
