import {
  parse,
  parseFragment,
  serializeOuter,
  type DefaultTreeAdapterTypes as P5,
} from "parse5";

import { mermaidBlockPattern } from "./mermaid-blocks";
import { ALLOWED_TAGS, DROP_WITH_CHILDREN } from "./sanitize-slide-html";

/**
 * Save boundary for slide HTML.
 *
 * The editor canvas shows `render(stored)`: logo filters, `sanitizeSlideHtml`
 * (scoped `<style>`, dropped svg, rewritten style attributes) and
 * `prepareImportedFonts`, then autofit wrappers and editor ids. Serializing that
 * DOM back into storage is what flattened whole slides. Instead every rendered
 * element carries a stamp naming the stored element it came from, and a save
 * diffs the live DOM against a fresh render and splices only the difference
 * into the stored string. Bytes outside the changed elements are copied.
 */

export const SOURCE_STAMP_ATTR = "data-src-i";

export interface SlideSourceRange {
  tag: string;
  openStart: number;
  /** After the start tag's `>`. */
  openEnd: number;
  /** `null` when the end tag is implied or the element is void. */
  closeStart: number | null;
  closeEnd: number;
}

export interface StampedSlideSource {
  html: string;
  ranges: SlideSourceRange[];
}

/** What a canvas root was rendered from; registered by the renderer. */
export interface RenderedSlideSource {
  stored: string;
  ranges: SlideSourceRange[];
  /** The exact HTML the renderer mounted (stamped, sanitized). */
  base: string;
  nonce: string;
}

export class SlideSourceMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlideSourceMapError";
  }
}

/** Attributes the editor adds to live nodes; never content. */
const TRANSIENT_ATTRS = new Set([
  SOURCE_STAMP_ATTR,
  "data-builder-id",
  "data-slide-text-block",
  "contenteditable",
  "data-editing-block",
  "spellcheck",
]);
/** Renderer wrappers whose children belong to the wrapper's parent. */
const TRANSPARENT = "[data-fmd-autofit-content]";
const MERMAID_INDEX_ATTR = "data-mermaid-index";
/** The document parse puts these around the fragment; they are not content. */
const DOCUMENT_TAGS = new Set(["html", "head", "body"]);
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// ------------------------------------------------------------- locating ---

interface SourceElement {
  node: P5.Element;
  range: SlideSourceRange;
  /** Offset to insert a stamp at, or the existing stamp attribute to replace. */
  stamp: { at: number } | { start: number; end: number } | null;
}

interface LocatedSource {
  elements: SourceElement[];
  ordinalOf: Map<P5.Element, number>;
  head: P5.ChildNode[];
  body: P5.ChildNode[];
  /** By placeholder index: the stored block and its element ordinal. */
  mermaid: Array<{ source: string; ordinal: number | null }>;
  /**
   * Ordinals of formatting elements the parser also rebuilt elsewhere (an
   * unclosed `<b>` reopened in each later paragraph). Every copy carries the
   * one stamp, and only the first is the stored element.
   */
  reconstructed: Set<number>;
}

// Parse as the sanitizer's DOMParser does: scripting off, so `<noscript>`
// content is markup, not text.
const PARSE_OPTIONS = { scriptingEnabled: false } as const;

const isElement = (node: P5.Node): node is P5.Element =>
  "tagName" in node && typeof node.tagName === "string";
const isComment = (node: P5.Node): node is P5.CommentNode =>
  node.nodeName === "#comment";

/**
 * Parses the stored string the way the sanitizer does (a full document parse),
 * so the stamps land on the elements the browser builds. Ordinals are preorder
 * over elements that have a start tag in the source; parser-implied elements
 * (tbody, adoption-agency clones) get none.
 */
function locateSource(stored: string): LocatedSource {
  const doc = parse(stored, { ...PARSE_OPTIONS, sourceCodeLocationInfo: true });
  const mermaid: LocatedSource["mermaid"] = [];
  const mermaidAt = new Map<number, number>();
  for (const match of stored.matchAll(mermaidBlockPattern())) {
    mermaidAt.set(match.index, mermaid.length);
    mermaid.push({ source: match[0], ordinal: null });
  }
  const elements: SourceElement[] = [];
  const ordinalOf = new Map<P5.Element, number>();
  const ordinalAt = new Map<number, number>();
  const reconstructed = new Set<number>();
  const head: P5.ChildNode[] = [];
  const body: P5.ChildNode[] = [];

  const visit = (parent: P5.ParentNode) => {
    for (const child of parent.childNodes) {
      if (!isElement(child)) continue;
      const loc = child.sourceCodeLocation;
      const start = loc?.startTag;
      if (!loc || !start || DOCUMENT_TAGS.has(child.tagName)) {
        visit(child);
        continue;
      }
      const original = ordinalAt.get(start.startOffset);
      if (original !== undefined) {
        // A rebuilt copy reports the original's start tag.
        reconstructed.add(original);
        visit(child);
        continue;
      }
      const ordinal = elements.length;
      ordinalOf.set(child, ordinal);
      ordinalAt.set(start.startOffset, ordinal);
      elements.push({
        node: child,
        range: {
          tag: child.tagName,
          openStart: start.startOffset,
          openEnd: start.endOffset,
          closeStart: loc.endTag?.startOffset ?? null,
          closeEnd: loc.endOffset,
        },
        stamp: stampPosition(stored, loc),
      });
      const block = mermaidAt.get(start.startOffset);
      if (block !== undefined) {
        // The block's content is diagram source handed to mermaid verbatim;
        // a stamp inside it would change the diagram.
        mermaid[block].ordinal = ordinal;
        continue;
      }
      if (child.tagName !== "template") visit(child);
    }
  };
  visit(doc);

  // Comments before the first tag or after `</body>` hang off the document
  // and `<html>`; they sit before or after the body's children.
  let afterBody = false;
  const levels = (nodes: P5.ChildNode[]) => {
    for (const node of nodes) {
      if (isComment(node)) (afterBody ? body : head).push(node);
      else if (!isElement(node)) continue;
      else if (node.tagName === "html") levels(node.childNodes);
      else if (node.tagName === "head") head.push(...node.childNodes);
      else if (node.tagName === "body") {
        body.push(...node.childNodes);
        afterBody = true;
      }
    }
  };
  levels(doc.childNodes);
  return { elements, ordinalOf, head, body, mermaid, reconstructed };
}

type ElementLocation = NonNullable<P5.Element["sourceCodeLocation"]>;

/**
 * Where a new attribute goes in a start tag: before the self-closing `/`,
 * unless that `/` ends an unquoted value (`src=a/`), where inserting before it
 * would change the value. `null` for a tag with no `>`.
 */
function attributeInsertionPoint(
  stored: string,
  loc: ElementLocation,
): number | null {
  const gt = loc.startTag!.endOffset - 1;
  if (stored[gt] !== ">") return null;
  const lastAttrEnd = Math.max(
    -1,
    ...Object.values(loc.attrs ?? {}).map((attr) => attr.endOffset),
  );
  return stored[gt - 1] === "/" && lastAttrEnd !== gt ? gt - 1 : gt;
}

function stampPosition(
  stored: string,
  loc: ElementLocation,
): SourceElement["stamp"] {
  const existing = loc.attrs?.[SOURCE_STAMP_ATTR];
  if (existing) return { start: existing.startOffset, end: existing.endOffset };
  const at = attributeInsertionPoint(stored, loc);
  return at === null ? null : { at };
}

/**
 * Inserts `data-src-i="<nonce>:<ordinal>"` into every located start tag. The
 * stamp goes at the end of the tag so the mermaid and logo regexes, which read
 * a tag's leading attributes, still match.
 */
export function stampSlideSource(
  stored: string,
  nonce: string,
): StampedSlideSource {
  const located = locateSource(stored);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  located.elements.forEach(({ stamp }, ordinal) => {
    if (!stamp) return;
    const attr = `${SOURCE_STAMP_ATTR}="${nonce}:${ordinal}"`;
    if ("at" in stamp) {
      edits.push({ start: stamp.at, end: stamp.at, text: ` ${attr}` });
    } else {
      edits.push({ start: stamp.start, end: stamp.end, text: attr });
    }
  });
  edits.sort((a, b) => a.start - b.start);
  let html = "";
  let copied = 0;
  for (const edit of edits) {
    html += stored.slice(copied, edit.start) + edit.text;
    copied = edit.end;
  }
  return {
    html: html + stored.slice(copied),
    ranges: located.elements.map((element) => element.range),
  };
}

// ---------------------------------------------------------------- merge ---

type Kid = Element | string;

const escapeText = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;");
const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/ /g, "&nbsp;");

function attrMap(el: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const attr of Array.from(el.attributes)) {
    if (!TRANSIENT_ATTRS.has(attr.name)) map.set(attr.name, attr.value);
  }
  return map;
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  return (el as HTMLElement).style ?? null;
}

/** Per-longhand base→live change; `null` means the property was removed. */
function styleDelta(base: Element, live: Element): Map<string, string | null> {
  const delta = new Map<string, string | null>();
  const bs = styleOf(base);
  const ls = styleOf(live);
  if (!bs || !ls) return delta;
  const props = new Set<string>();
  for (let i = 0; i < bs.length; i++) props.add(bs[i]);
  for (let i = 0; i < ls.length; i++) props.add(ls[i]);
  // A shorthand holding `var()` reads back only as itself, with every
  // longhand empty, so it is compared by its declared name.
  for (const el of [base, live]) {
    for (const { name } of splitDeclarations(el.getAttribute("style") ?? "")) {
      if (
        `${bs.getPropertyValue(name)}${ls.getPropertyValue(name)}`.includes(
          "var(",
        )
      )
        props.add(name);
    }
  }
  for (const prop of props) {
    const before = bs.getPropertyValue(prop) + bs.getPropertyPriority(prop);
    const after = ls.getPropertyValue(prop) + ls.getPropertyPriority(prop);
    if (before === after) continue;
    const value = ls.getPropertyValue(prop);
    delta.set(
      prop,
      value
        ? `${value}${ls.getPropertyPriority(prop) ? " !important" : ""}`
        : null,
    );
  }
  return delta;
}

function sameAttrs(a: Element, b: Element): boolean {
  const x = attrMap(a);
  const y = attrMap(b);
  if (x.size !== y.size) return false;
  for (const [name, value] of x) {
    const other = y.get(name);
    if (other === undefined) return false;
    if (other === value) continue;
    // Touching `el.style` reserializes the attribute without changing it.
    if (name === "style" && styleDelta(b, a).size === 0) continue;
    return false;
  }
  return true;
}

/** Declarations of a style attribute, split outside quotes and parentheses. */
function splitDeclarations(
  style: string,
): Array<{ name: string; raw: string }> {
  const out: Array<{ name: string; raw: string }> = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const push = (end: number) => {
    const raw = style.slice(start, end);
    const colon = raw.indexOf(":");
    const name = colon > 0 ? raw.slice(0, colon).trim() : "";
    if (raw.trim())
      out.push({
        name: name.startsWith("--") ? name : name.toLowerCase(),
        raw,
      });
    start = end + 1;
  };
  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) push(i);
  }
  push(style.length);
  return out;
}

/**
 * The stored style text with the user's per-property change applied. Untouched
 * declarations keep their stored bytes, so renderer rewrites (sanitized
 * formatting, font renames, the logo filter) never reach storage.
 */
function mergeStyle(
  stored: string | undefined,
  base: Element,
  live: Element,
  scratch: CSSStyleDeclaration,
): string | null {
  const delta = styleDelta(base, live);
  if (delta.size === 0) return stored ?? null;
  const kept: string[] = [];
  for (const decl of splitDeclarations(stored ?? "")) {
    if (delta.has(decl.name)) continue;
    scratch.cssText = decl.raw;
    const covered = [...delta].filter(
      ([prop]) => scratch.getPropertyValue(prop) !== "",
    );
    const mustDrop = covered.some(
      ([prop, value]) =>
        value === null ||
        (scratch.getPropertyPriority(prop) === "important" &&
          !value.endsWith("!important")),
    );
    if (!mustDrop) {
      kept.push(decl.raw.trim());
      continue;
    }
    // A shorthand that also set a removed longhand: keep what it set for the
    // properties the user did not touch.
    const liveStyle = styleOf(live);
    for (let i = 0; i < scratch.length; i++) {
      const longhand = scratch[i];
      if (delta.has(longhand) || !liveStyle) continue;
      const value = liveStyle.getPropertyValue(longhand);
      if (!value) continue;
      const important = liveStyle.getPropertyPriority(longhand);
      kept.push(`${longhand}: ${value}${important ? " !important" : ""}`);
    }
  }
  for (const [prop, value] of delta) {
    if (value !== null) kept.push(`${prop}: ${value}`);
  }
  return kept.length ? kept.join("; ") : null;
}

function textOf(node: P5.Node): string {
  if (node.nodeName === "#text") return (node as P5.TextNode).value;
  if (!("childNodes" in node)) return "";
  return (node as P5.ParentNode).childNodes.map(textOf).join("");
}

/**
 * Elements under `node` that its own source slice (from `from`) produces: a
 * formatting element rebuilt from a start tag before the slice is not one.
 */
function elementCount(node: P5.ParentNode, from: number): number {
  let n = 0;
  for (const child of node.childNodes) {
    if (!isElement(child)) continue;
    const start = child.sourceCodeLocation?.startTag?.startOffset;
    n +=
      (start !== undefined && start < from ? 0 : 1) + elementCount(child, from);
  }
  return n;
}

export interface MergeRenderedEditsInput {
  stored: string;
  ranges: SlideSourceRange[];
  base: string;
  /** A root the caller owns (a clone of the canvas): the merge mutates it. */
  live: Element;
  nonce: string;
  /** Applied to both the base and the live root before they are compared. */
  prepare?: (root: ParentNode) => void;
}

/**
 * The stored string with the live DOM's changes, relative to `base`, spliced
 * in. No change returns `stored` itself.
 *
 * - Unchanged elements are copied as their exact stored source slice.
 * - A changed element keeps its stored start tag; changed attributes are
 *   spliced into it, and a style change is applied per declaration.
 * - Its children are walked over the stored bytes when only children changed
 *   or were deleted; otherwise they are rebuilt, and stored-only nodes
 *   (`<style>`, svg, comments) are put back after their previous sibling.
 * - A stamped element whose source slice does not parse back to itself
 *   (misnested markup) is written canonically, for that subtree only.
 * - Unstamped or foreign-stamped elements are new content, written from the
 *   live DOM.
 */
export function mergeRenderedEdits(input: MergeRenderedEditsInput): {
  html: string;
  changed: boolean;
} {
  const html = sourceMerge(input).mergeRoot();
  return { html, changed: html !== input.stored };
}

/**
 * Replays an edit of `stored` (`edited`, its merged result) onto `next`, a
 * newer version of the slide someone else wrote. The edit moves as the
 * smallest stored element around it that `next` still holds exactly once.
 * Null when `next` changed that element too: both cannot be kept.
 */
export function rebaseSlideEdit(
  stored: string,
  ranges: readonly SlideSourceRange[],
  edited: string,
  next: string,
): string | null {
  if (edited === stored) return next;
  if (next === stored) return edited;
  const shorter = Math.min(stored.length, edited.length);
  let start = 0;
  while (start < shorter && stored[start] === edited[start]) start += 1;
  let tail = 0;
  while (
    tail < shorter - start &&
    stored[stored.length - 1 - tail] === edited[edited.length - 1 - tail]
  ) {
    tail += 1;
  }
  const end = stored.length - tail;
  const growth = edited.length - stored.length;
  const enclosing = ranges
    .filter((range) => range.openStart <= start && range.closeEnd >= end)
    .sort((a, b) => a.closeEnd - a.openStart - (b.closeEnd - b.openStart));
  for (const range of enclosing) {
    const before = stored.slice(range.openStart, range.closeEnd);
    const at = next.indexOf(before);
    if (at < 0) return null;
    if (next.indexOf(before, at + 1) >= 0) continue;
    return (
      next.slice(0, at) +
      edited.slice(range.openStart, range.closeEnd + growth) +
      next.slice(at + before.length)
    );
  }
  return null;
}

/**
 * The stored-form HTML of one live element (or a detached copy of one): its
 * stored source with its own changes applied, free of stamps and of anything
 * the renderer added. Clipboard copies use this, so a pasted logo does not
 * carry the rendered logo filter back into storage.
 */
export function storedFormOf(
  source: RenderedSlideSource,
  element: Element,
): string {
  return sourceMerge({ ...source, live: element }).emit(element);
}

function sourceMerge(input: MergeRenderedEditsInput) {
  const { stored, nonce, live } = input;
  const located = locateSource(stored);
  if (located.elements.length !== input.ranges.length) {
    throw new SlideSourceMapError(
      `source map is stale: ${input.ranges.length} ranges for ${located.elements.length} stored elements`,
    );
  }
  const ranges = located.elements.map((element) => element.range);
  // Parsed in a template's inert document so base images never load.
  const template = live.ownerDocument.createElement("template");
  template.innerHTML = input.base;
  const baseRoot = template.content;
  const inert = baseRoot.ownerDocument;
  input.prepare?.(baseRoot);
  input.prepare?.(live);

  const stampOf = (el: Element): number | null => {
    const value = el.getAttribute(SOURCE_STAMP_ATTR);
    if (!value) return null;
    const colon = value.lastIndexOf(":");
    if (value.slice(0, colon) !== nonce) return null;
    const ordinal = Number(value.slice(colon + 1));
    return Number.isInteger(ordinal) && ordinal >= 0 && ordinal < ranges.length
      ? ordinal
      : null;
  };
  // The renderer swaps each mermaid block for a placeholder the diagram
  // component replaces; both stand for the stored block's element.
  for (const root of [baseRoot, live]) {
    for (const el of Array.from(
      root.querySelectorAll(`[${MERMAID_INDEX_ATTR}]`),
    )) {
      const block =
        located.mermaid[Number(el.getAttribute(MERMAID_INDEX_ATTR))];
      if (block?.ordinal != null) {
        el.setAttribute(SOURCE_STAMP_ATTR, `${nonce}:${block.ordinal}`);
      }
    }
  }
  const baseBy = new Map<number, Element>();
  for (const el of Array.from(
    baseRoot.querySelectorAll(`[${SOURCE_STAMP_ATTR}]`),
  )) {
    const ordinal = stampOf(el);
    if (ordinal !== null && !baseBy.has(ordinal)) baseBy.set(ordinal, el);
  }
  // The parser's later copies of a reconstructed element: the stored markup
  // reopens them, so only their children are content.
  const rebuilt = new Set<Element>();
  for (const root of [baseRoot, live]) {
    const first = new Set<number>();
    for (const el of Array.from(
      root.querySelectorAll(`[${SOURCE_STAMP_ATTR}]`),
    )) {
      const ordinal = stampOf(el);
      if (ordinal === null || !located.reconstructed.has(ordinal)) continue;
      if (first.has(ordinal)) rebuilt.add(el);
      else first.add(ordinal);
    }
  }
  const scratch = inert.createElement("div").style;
  // The parser adds <tbody>/<colgroup> to a stored <table> that omits them;
  // they have no source, so writing them would change the stored bytes.
  const isImplied = (el: Element) =>
    (el.tagName === "TBODY" || el.tagName === "COLGROUP") &&
    stampOf(el) === null &&
    el.parentElement?.tagName === "TABLE" &&
    stampOf(el.parentElement) !== null;

  const kids = (node: ParentNode): Kid[] => {
    const out: Kid[] = [];
    const push = (child: Node) => {
      if (child.nodeType === 1) {
        const el = child as Element;
        if (el.matches(TRANSPARENT) || rebuilt.has(el) || isImplied(el)) {
          el.childNodes.forEach(push);
          return;
        }
        // The rendered <style> is the scoped copy; the stored one is
        // written from its source bytes.
        if (el.tagName === "STYLE" && stampOf(el) === null) return;
        out.push(el);
      } else if (child.nodeType === 3) {
        const text = (child as Text).data;
        if (!text) return;
        const last = out[out.length - 1];
        if (typeof last === "string") out[out.length - 1] = last + text;
        else out.push(text);
      }
    };
    node.childNodes.forEach(push);
    return out;
  };

  const isOpaque = (el: Element) => el.hasAttribute(MERMAID_INDEX_ATTR);
  const sameMemo = new Map<Element, { other: Element; same: boolean }>();
  const sameKids = (a: ParentNode, b: ParentNode): boolean => {
    const x = kids(a);
    const y = kids(b);
    return x.length === y.length && x.every((kid, i) => sameKid(kid, y[i]));
  };
  /** `a` is live, `b` is base. */
  const sameKid = (a: Kid, b: Kid): boolean => {
    if (typeof a === "string" || typeof b === "string") return a === b;
    const memo = sameMemo.get(a);
    if (memo?.other === b) return memo.same;
    const same =
      a.tagName === b.tagName &&
      stampOf(a) === stampOf(b) &&
      (isOpaque(a) && isOpaque(b)
        ? a.getAttribute(MERMAID_INDEX_ATTR) ===
          b.getAttribute(MERMAID_INDEX_ATTR)
        : sameAttrs(a, b) && sameKids(a, b));
    sameMemo.set(a, { other: b, same });
    return same;
  };

  const trustMemo = new Map<number, boolean>();
  /** The source slice parses back to exactly this element. */
  const isTrusted = (ordinal: number): boolean => {
    const cached = trustMemo.get(ordinal);
    if (cached !== undefined) return cached;
    const { node, range } = located.elements[ordinal];
    const nodes = parseFragment(
      stored.slice(range.openStart, range.closeEnd),
      PARSE_OPTIONS,
    ).childNodes;
    const only = nodes[0];
    const trusted =
      nodes.length === 1 &&
      isElement(only) &&
      only.tagName === node.tagName &&
      textOf(only) === textOf(node) &&
      elementCount(only, 0) === elementCount(node, range.openStart);
    trustMemo.set(ordinal, trusted);
    return trusted;
  };
  const sourceOf = (ordinal: number): string => {
    const { node, range } = located.elements[ordinal];
    return isTrusted(ordinal)
      ? stored.slice(range.openStart, range.closeEnd)
      : serializeOuter(node);
  };

  /**
   * A stored parent's children as the renderer sees them: unwrapped tags
   * contribute their children, parser-implied elements are transparent.
   */
  const renderLevel = (nodes: P5.ChildNode[], inHead: boolean) => {
    const out: P5.ChildNode[] = [];
    const walk = (list: P5.ChildNode[]) => {
      for (const node of list) {
        if (isComment(node)) out.push(node);
        if (!isElement(node)) continue;
        const ordinal = located.ordinalOf.get(node);
        const tag = node.tagName;
        const unwrapped =
          ordinal === undefined ||
          (!inHead &&
            !ALLOWED_TAGS.has(tag) &&
            !DROP_WITH_CHILDREN.has(tag) &&
            tag !== "template");
        if (unwrapped) walk(node.childNodes);
        else out.push(node);
      }
    };
    walk(nodes);
    return out;
  };
  const ROOT = null;
  const storedChildren = (parent: P5.Element | typeof ROOT) =>
    parent === ROOT
      ? [
          ...renderLevel(located.head, true),
          ...renderLevel(located.body, false),
        ]
      : renderLevel(
          parent.tagName === "template"
            ? (parent as P5.Template).content.childNodes
            : parent.childNodes,
          false,
        );

  const seen = new Set<number>();

  const openTag = (tag: string, attrs: Iterable<[string, string]>) => {
    let out = `<${tag}`;
    for (const [name, value] of attrs) out += ` ${name}="${escapeAttr(value)}"`;
    return `${out}>`;
  };

  /** Stored start tag with the base→live attribute change spliced in. */
  const mergedOpenTag = (
    ordinal: number,
    base: Element,
    live: Element,
    tag: string,
    splice: boolean,
  ): string => {
    const { node, range } = located.elements[ordinal];
    const storedAttrs = new Map(node.attrs.map((a) => [a.name, a.value]));
    const baseAttrs = attrMap(base);
    const liveAttrs = attrMap(live);
    const changes = new Map<string, string | null>();
    for (const name of new Set([...baseAttrs.keys(), ...liveAttrs.keys()])) {
      const before = baseAttrs.get(name);
      const after = liveAttrs.get(name);
      if (before === after) continue;
      if (name === "style") {
        const merged = mergeStyle(
          storedAttrs.get("style"),
          base,
          live,
          scratch,
        );
        if (merged !== (storedAttrs.get("style") ?? null))
          changes.set(name, merged);
        continue;
      }
      changes.set(name, after ?? null);
    }
    if (!splice) {
      for (const [name, value] of changes) {
        if (value === null) storedAttrs.delete(name);
        else storedAttrs.set(name, value);
      }
      storedAttrs.delete(SOURCE_STAMP_ATTR);
      return openTag(tag, storedAttrs);
    }
    const loc = node.sourceCodeLocation!;
    const locations = loc.attrs ?? {};
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const tail = attributeInsertionPoint(stored, loc) ?? range.openEnd - 1;
    for (const [name, value] of changes) {
      const at = locations[name];
      const text = value === null ? "" : `${name}="${escapeAttr(value)}"`;
      if (at) {
        let start = at.startOffset;
        if (value === null) {
          while (start > range.openStart && /\s/.test(stored[start - 1]))
            start--;
        }
        edits.push({ start, end: at.endOffset, text });
      } else if (value !== null) {
        edits.push({ start: tail, end: tail, text: ` ${text}` });
      }
    }
    edits.sort((a, b) => b.start - a.start);
    let tagSource = stored.slice(range.openStart, range.openEnd);
    for (const edit of edits) {
      tagSource =
        tagSource.slice(0, edit.start - range.openStart) +
        edit.text +
        tagSource.slice(edit.end - range.openStart);
    }
    return tagSource;
  };

  const storedOnlyAfter = (parent: P5.Element | typeof ROOT, ok: Kid[]) => {
    const lead: string[] = [];
    const after = new Map<number, string[]>();
    let anchor = -1;
    for (const node of storedChildren(parent)) {
      let html: string;
      if (isComment(node)) {
        const loc = node.sourceCodeLocation;
        html = loc
          ? stored.slice(loc.startOffset, loc.endOffset)
          : `<!--${node.data}-->`;
      } else {
        const ordinal = located.ordinalOf.get(node as P5.Element)!;
        if (baseBy.has(ordinal)) {
          const at = ok.findIndex(
            (kid) => typeof kid !== "string" && stampOf(kid) === ordinal,
          );
          if (at >= 0) anchor = at;
          continue;
        }
        html = sourceOf(ordinal);
      }
      if (anchor < 0) lead.push(html);
      else after.set(anchor, [...(after.get(anchor) ?? []), html]);
    }
    return { lead, after };
  };

  const emitKids = (
    ok: Kid[],
    parent: P5.Element | typeof ROOT | undefined,
  ) => {
    const anchors =
      parent === undefined
        ? { lead: [] as string[], after: new Map<number, string[]>() }
        : storedOnlyAfter(parent, ok);
    let out = anchors.lead.join("");
    ok.forEach((kid, i) => {
      out += emit(kid) + (anchors.after.get(i) ?? []).join("");
    });
    return out;
  };

  /**
   * Children written over the stored bytes: valid when the live children are
   * the base children minus deleted ones with the text between them intact,
   * and every stored child the renderer shows is one of those base children,
   * in source order.
   */
  const bySource = (
    ok: Kid[],
    bk: Kid[],
    parent: P5.Element | typeof ROOT,
    from: number,
    to: number,
  ): string | null => {
    const baseEls = bk.filter((kid): kid is Element => typeof kid !== "string");
    const shown = storedChildren(parent)
      .filter(isElement)
      .map((node) => located.ordinalOf.get(node)!)
      .filter((ordinal) => baseBy.has(ordinal));
    if (
      shown.length !== baseEls.length ||
      shown.some((ordinal, i) => ordinal !== stampOf(baseEls[i]))
    ) {
      return null;
    }
    // Match each live element to the next base element with its stamp; the
    // base elements skipped over were deleted.
    const kept = new Map<Element, Element>();
    const liveText = [""];
    const baseText = [""];
    let b = 0;
    for (const kid of ok) {
      if (typeof kid === "string") {
        liveText[liveText.length - 1] += kid;
        continue;
      }
      const ordinal = stampOf(kid);
      for (; b < bk.length; b++) {
        const candidate = bk[b];
        if (typeof candidate === "string") {
          baseText[baseText.length - 1] += candidate;
        } else if (stampOf(candidate) === ordinal) {
          break;
        }
      }
      if (b === bk.length || ordinal === null) return null;
      kept.set(bk[b] as Element, kid);
      b++;
      liveText.push("");
      baseText.push("");
    }
    for (; b < bk.length; b++) {
      const rest = bk[b];
      if (typeof rest === "string") baseText[baseText.length - 1] += rest;
    }
    if (liveText.some((text, i) => text !== baseText[i])) return null;

    let out = "";
    let cursor = from;
    for (const el of baseEls) {
      const ordinal = stampOf(el)!;
      const range = ranges[ordinal];
      if (
        !isTrusted(ordinal) ||
        range.openStart < cursor ||
        range.closeEnd > to
      )
        return null;
      out += stored.slice(cursor, range.openStart);
      const keptKid = kept.get(el);
      if (keptKid) out += emit(keptKid);
      cursor = range.closeEnd;
    }
    return out + stored.slice(cursor, to);
  };

  const emit = (kid: Kid): string => {
    if (typeof kid === "string") return escapeText(kid);
    const tag = kid.tagName.toLowerCase();
    const ordinal = stampOf(kid);
    const base = ordinal === null ? undefined : baseBy.get(ordinal);
    if (ordinal === null || !base) {
      if (isOpaque(kid)) {
        const block =
          located.mermaid[Number(kid.getAttribute(MERMAID_INDEX_ATTR))];
        if (block) return block.source;
      }
      return (
        openTag(tag, attrMap(kid)) +
        (VOID_TAGS.has(tag) ? "" : `${emitKids(kids(kid), undefined)}</${tag}>`)
      );
    }
    const first = !seen.has(ordinal);
    seen.add(ordinal);
    // A second live copy of one stored element (a split that cloned it) gets
    // its own tag; copying the stored slice again would duplicate what the
    // slice holds beyond the live children, such as svg and comments.
    if (isOpaque(kid) || (first && sameKid(kid, base)))
      return sourceOf(ordinal);
    const range = ranges[ordinal];
    const trusted = isTrusted(ordinal);
    const sameTag = kid.tagName === base.tagName;
    const open =
      trusted && sameTag && sameAttrs(kid, base)
        ? stored.slice(range.openStart, range.openEnd)
        : mergedOpenTag(ordinal, base, kid, tag, trusted && sameTag);
    if (VOID_TAGS.has(tag)) return open;
    // An implied end stays implied: closing an unclosed `<b>` explicitly
    // would stop the parser reopening it in the paragraphs after it.
    const close =
      trusted && sameTag
        ? range.closeStart === null
          ? ""
          : stored.slice(range.closeStart, range.closeEnd)
        : `</${tag}>`;
    const node = located.elements[ordinal].node;
    const ok = kids(kid);
    if (first && trusted && sameTag) {
      const inner = bySource(
        ok,
        kids(base),
        node,
        range.openEnd,
        range.closeStart ?? range.closeEnd,
      );
      if (inner !== null) return open + inner + close;
    }
    return open + emitKids(ok, first ? node : undefined) + close;
  };

  const mergeRoot = (): string =>
    sameKids(live, baseRoot)
      ? stored
      : (bySource(kids(live), kids(baseRoot), ROOT, 0, stored.length) ??
        emitKids(kids(live), ROOT));
  return { mergeRoot, emit };
}

// --------------------------------------------------------------- guard ---

/** The scoped stylesheet's selectors, which the renderer writes into `<style>`. */
export const SCOPED_STYLE_SELECTOR_MARKER = "scoped-style-selector";
const SCOPED_SELECTOR = /\[data-slide-content-scope\s*=/g;

/**
 * Markers only the renderer or the editor puts into slide HTML: the scoped
 * stylesheet's selectors, source stamps and editor attributes. A write that
 * adds one stored rendered markup; the growth check lets content that already
 * carries them (older flattened decks) keep saving. Author-writable styling,
 * such as a logo filter or a hidden element, is not a marker: a copy of stored
 * content legitimately carries it. Markers are read from parsed attributes and
 * `<style>` text, so text that names one is not a marker and a quoted `>` in
 * an earlier attribute cannot hide one.
 */
const MARKER_ATTRS = [
  "data-slide-content-scope",
  SOURCE_STAMP_ATTR,
  "data-builder-id",
  "data-editing-block",
  "data-slide-text-block",
  "contenteditable",
  "data-fmd-autofit-content",
];
const MARKER_CLASSES: Array<[string, RegExp]> = [
  ["ProseMirror", /(?:^|\s)ProseMirror(?:\s|$)/],
  ["slide-rich-editor", /(?:^|\s)slide-rich-editor/],
];
const MARKER_ORDER = [
  SCOPED_STYLE_SELECTOR_MARKER,
  ...MARKER_ATTRS,
  ...MARKER_CLASSES.map(([name]) => name),
];

function countRenderArtifacts(html: string): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (name: string, n = 1) =>
    n > 0 && counts.set(name, (counts.get(name) ?? 0) + n);
  const walk = (parent: P5.ParentNode) => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue;
      for (const { name, value } of node.attrs) {
        // Older editors stored contenteditable="false" on text elements, so
        // only an editable value marks the live editing surface.
        if (name === "contenteditable" && value.toLowerCase() === "false")
          continue;
        if (MARKER_ATTRS.includes(name)) add(name);
        if (name !== "class") continue;
        for (const [marker, pattern] of MARKER_CLASSES) {
          if (pattern.test(value)) add(marker);
        }
      }
      if (node.tagName === "style") {
        add(
          SCOPED_STYLE_SELECTOR_MARKER,
          textOf(node).match(SCOPED_SELECTOR)?.length ?? 0,
        );
      }
      walk(node.tagName === "template" ? (node as P5.Template).content : node);
    }
  };
  walk(parseFragment(html, PARSE_OPTIONS));
  return counts;
}

/**
 * Names of the render/editor markers `next` has more of than `prev`. The
 * client checks its own saves and the actions check agent and old-client
 * writes with the same list.
 */
export function renderArtifactGrowth(prev: string, next: string): string[] {
  const before = countRenderArtifacts(prev);
  const after = countRenderArtifacts(next);
  return MARKER_ORDER.filter(
    (name) => (after.get(name) ?? 0) > (before.get(name) ?? 0),
  );
}

/** Removes source stamps from HTML that leaves the canvas. */
export function stripSourceStamps(root: Element | DocumentFragment): void {
  if (root instanceof Element) root.removeAttribute(SOURCE_STAMP_ATTR);
  for (const el of Array.from(
    root.querySelectorAll(`[${SOURCE_STAMP_ATTR}]`),
  )) {
    el.removeAttribute(SOURCE_STAMP_ATTR);
  }
}
