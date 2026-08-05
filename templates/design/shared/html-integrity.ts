import { parse as parseJavaScript } from "acorn";
import { type DefaultTreeAdapterTypes, parse, type ParserError } from "parse5";

import { isStandaloneHttpUrl } from "./html-content.js";

/**
 * Stable error code shared by browser and server write paths. Keep this value
 * transport-safe: action errors may preserve either `code` or only `message`.
 */
export const DESIGN_HTML_INTEGRITY_ERROR_CODE = "DESIGN_HTML_INTEGRITY";

/**
 * Human-facing summary for the editor toast. `message` carries the located,
 * agent-facing detail instead — a person dragging on the canvas did not author
 * the markup, so a line and column are noise to them.
 */
export const DESIGN_HTML_INTEGRITY_SUMMARY =
  "The edit was not applied because it would make the design HTML invalid.";

export type DesignHtmlIntegrityIssue =
  | "document-boundary"
  | "document-root"
  | "document-body"
  | "document-head"
  | "raw-text-balance"
  | "managed-marker-orphaned"
  | "managed-marker-duplicated"
  | "attribute-unterminated"
  | "expression-invalid"
  | "script-invalid"
  | "element-unclosed"
  | "close-tag-orphaned"
  | "content-truncated"
  | "runtime-missing"
  | "url-backed-screen-replaced";

/**
 * Reporting the symptom instead of the cause sends the fix to the wrong line:
 * an unterminated quote in `<head>` swallows the root tags, which reads as a
 * missing `<html>` unless the quote itself is named.
 */
export interface DesignHtmlIntegrityIssueDetail {
  issue: DesignHtmlIntegrityIssue;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The offending source line, bounded for readability. */
  excerpt: string;
  tag?: string;
  attribute?: string;
  /** The parser's reason, for `expression-invalid`. */
  reason?: string;
  /** The tag that arrived where this element's close belonged, if any. */
  closedBy?: { tag: string; line: number };
}

export interface DesignHtmlIntegrityResult {
  valid: boolean;
  issue?: DesignHtmlIntegrityIssue;
  /** Present only when invalid; first entry corresponds to `issue`. */
  detail?: DesignHtmlIntegrityIssueDetail[];
  /** Present only when non-empty. Never blocks a write. */
  advisory?: DesignHtmlIntegrityIssueDetail[];
}

/** Cap cascades: one unclosed tag can leave a dozen ancestors unbalanced. */
const MAX_REPORTED_ISSUES = 3;

const DOCUMENT_SHAPE_MESSAGES: Partial<
  Record<DesignHtmlIntegrityIssue, string>
> = {
  "document-root":
    "the document must have exactly one <html> element with a matching </html>",
  "document-body":
    "the document must have exactly one <body> element with a matching </body>",
  "document-head":
    "the document must have at most one <head> element, with a matching </head> if present",
  "document-boundary":
    "the document's <html>/<body> tags are out of order, or content sits outside <html>",
  "raw-text-balance":
    "a <style>, <script>, <textarea>, or <title> element is missing its opening or closing tag",
  "managed-marker-orphaned":
    "an editor-managed <style>/<script> marker is no longer attached to its element — it was likely split by a partial edit",
  "managed-marker-duplicated":
    "an editor-managed <style>/<script> block appears more than once; there must be exactly one of each",
  "url-backed-screen-replaced":
    "this screen's content is its live route URL, and the write would replace it with document markup — that permanently unbinds the screen from the running app. Edit the app's own source instead",
};

export function describeDesignHtmlIntegrityIssue(
  detail: DesignHtmlIntegrityIssueDetail,
): string {
  const at = `line ${detail.line} col ${detail.column}`;
  switch (detail.issue) {
    case "expression-invalid":
      return (
        `the ${detail.attribute ? `\`${detail.attribute}\`` : "Alpine"} expression on ` +
        `<${detail.tag ?? "element"}> at ${at} is not valid JavaScript: ` +
        `${detail.reason ?? "it does not parse"}. The HTML attribute itself is ` +
        `well-formed, so the document parses and the element renders — but Alpine ` +
        `compiles this value and throws, which aborts every binding on the component.`
      );
    case "script-invalid":
      return (
        `the inline <script> at ${at} is not valid JavaScript: ` +
        `${detail.reason ?? "it does not parse"}. The document still parses and ` +
        `the page still renders, so nothing visibly fails — the script simply ` +
        `never runs, and everything it was going to wire up stays dead.`
      );
    case "attribute-unterminated":
      return (
        `the ${detail.attribute ? `\`${detail.attribute}\`` : "attribute"} value on ` +
        `<${detail.tag ?? "element"}> at ${at} is never closed. The HTML parser absorbs ` +
        `everything after it into that attribute — including any markup, <style>, or ` +
        `<script> that follows — so the rest of the document silently stops applying. ` +
        `Close the quote.`
      );
    case "element-unclosed":
      return detail.closedBy
        ? `<${detail.tag}> opened at ${at} is never closed; the next closing tag is ` +
            `</${detail.closedBy.tag}> on line ${detail.closedBy.line}, which belongs to an ` +
            `ancestor. Everything between them gets nested inside <${detail.tag}>. ` +
            `Add the missing </${detail.tag}>.`
        : `<${detail.tag}> opened at ${at} is never closed before the document ends. ` +
            `Add the missing </${detail.tag}>.`;
    case "close-tag-orphaned":
      return (
        `</${detail.tag}> at ${at} closes an element that was never opened. ` +
        `Remove the stray closing tag, or add the matching <${detail.tag}>.`
      );
    case "content-truncated":
      return (
        `the content ends mid-markup at ${at} — the final tag or comment is never ` +
        `terminated. This is the signature of a payload that was cut off in transit; ` +
        `re-send this file complete.`
      );
    case "runtime-missing":
      return (
        `no Tailwind runtime is reachable from this document (expected a ` +
        `<script src="…@tailwindcss/browser@4"> or a <style type="text/tailwindcss">). ` +
        `Utility classes will not apply and the design renders unstyled.`
      );
    default:
      return `the document structure is invalid (${detail.issue}) at ${at}.`;
  }
}

export class DesignHtmlIntegrityError extends Error {
  readonly code = DESIGN_HTML_INTEGRITY_ERROR_CODE;
  readonly status = 422;
  readonly issue: DesignHtmlIntegrityIssue;
  readonly detail?: DesignHtmlIntegrityIssueDetail[];

  constructor(
    issue: DesignHtmlIntegrityIssue,
    options: {
      filename?: string;
      detail?: DesignHtmlIntegrityIssueDetail[];
    } = {},
  ) {
    const where = options.filename ? `${options.filename}: ` : "";
    const explained = options.detail?.length
      ? options.detail
          .map(
            (entry) =>
              `${describeDesignHtmlIntegrityIssue(entry)}\n\n  ${entry.line} | ${entry.excerpt}`,
          )
          .join("\n\n")
      : // Whole-document properties have no single offending character, but must
        // still name which property failed.
        `${DOCUMENT_SHAPE_MESSAGES[issue] ?? "the design HTML is invalid"}. The write was not applied.`;
    super(`${DESIGN_HTML_INTEGRITY_ERROR_CODE}: ${where}${explained}`);
    this.name = "DesignHtmlIntegrityError";
    this.issue = issue;
    this.detail = options.detail;
  }
}

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

const MANAGED_RAW_TEXT_MARKERS = [
  { marker: "data-agent-native-breakpoints", tag: "style" },
  { marker: "data-agent-native-state-breakpoints", tag: "style" },
  { marker: "data-agent-native-states", tag: "style" },
  { marker: "data-agent-native-motion", tag: "style" },
  { marker: "data-agent-native-shader-runtime", tag: "script" },
] as const;

/** Closing tag is forbidden, so the tree never records an end tag for these. */
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

/**
 * Closing tag optional per HTML5, so a missing end tag is legal authoring. The
 * parser decides which element an implied close terminates; this set only
 * decides what not to report.
 */
const OPTIONAL_CLOSE_TAGS = new Set([
  "body",
  "caption",
  "colgroup",
  "dd",
  "dt",
  "head",
  "html",
  "li",
  "optgroup",
  "option",
  "p",
  "rb",
  "rp",
  "rt",
  "rtc",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
]);

const MAX_EXCERPT_CHARS = 120;

/**
 * Deliberately conservative: a miss costs one unreported advisory, a false hit
 * costs trust in every advisory after it.
 */
const USES_TAILWIND_UTILITIES =
  /\bclass\s*=\s*["'][^"']*(?:\b(?:flex|grid|hidden|absolute|relative|sticky)\b|\b(?:p|m|px|py|mx|my|pt|pb|pl|pr|gap|w|h|text|bg|border|rounded|shadow|items|justify|font|leading|tracking|space-x|space-y|min-h|max-w|opacity|ring|z)-[a-z0-9[\]./-]+)/i;

/**
 * Parse errors that mean the source was cut off or mis-delimited. The rest of
 * what the spec reports is recoverable authoring the browser accepts, and
 * `missing-doctype` fires on legitimate fragments and on real screens.
 */
/**
 * Ordered by cause, not by offset: every one of these is reported at EOF, and an
 * unterminated tag absorbs the rest of the document — including the closer of
 * whatever raw-text element it sits in. Reporting the imbalance instead sends
 * the fix to a `</script>` that is present and correct.
 */
const FATAL_PARSE_ERRORS = [
  "eof-in-tag",
  "eof-in-comment",
  "eof-in-cdata",
  "eof-in-script-html-comment-like-text",
  "eof-in-element-that-can-contain-only-text",
  "eof-before-tag-name",
];

type Locator = (index: number) => {
  line: number;
  column: number;
  excerpt: string;
};

/**
 * Indexed once, lazily, then binary searched. Scanning to the offset per call
 * made validation quadratic on VALID documents, not just malformed ones — a
 * 117KB screen cost ~700ms on every save.
 */
function createLocator(value: string): Locator {
  let starts: number[] | null = null;
  return (index) => {
    if (!starts) {
      starts = [0];
      for (let cursor = 0; cursor < value.length; cursor += 1) {
        if (value[cursor] === "\n") starts.push(cursor + 1);
      }
    }
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= index) low = mid;
      else high = mid - 1;
    }
    const lineStart = starts[low]!;
    let lineEnd = value.indexOf("\n", lineStart);
    if (lineEnd === -1) lineEnd = value.length;
    const raw = value.slice(lineStart, lineEnd).trim();
    return {
      line: low + 1,
      column: index - lineStart + 1,
      excerpt:
        raw.length > MAX_EXCERPT_CHARS
          ? `${raw.slice(0, MAX_EXCERPT_CHARS)}…`
          : raw,
    };
  };
}

// ---------------------------------------------------------------------------
// Parse layer
// ---------------------------------------------------------------------------

// One parse and one walk feed every check below, so no two can disagree about
// whether a `<body>` inside a `<title>` was markup.

type Parse5Node = DefaultTreeAdapterTypes.Node;
type Parse5Element = DefaultTreeAdapterTypes.Element;
type SourceRange = { start: number; end: number };
type SourceOffsets = { startOffset: number; endOffset: number };

interface ParsedDocument {
  source: string;
  document: DefaultTreeAdapterTypes.Document;
  errors: ParserError[];
  /** Source extents to exclude when looking for markup tokens in the source. */
  rawTextBodies: SourceRange[];
  comments: SourceRange[];
  attributeRanges: SourceRange[];
  /** Start offsets of the end tags the parser matched to an element. */
  matchedEndTags: Set<number>;
  elements: Parse5Element[];
  textNodes: DefaultTreeAdapterTypes.TextNode[];
  parents: Map<Parse5Node, Parse5Element>;
}

function isElement(node: Parse5Node): node is Parse5Element {
  return typeof (node as Parse5Element).tagName === "string";
}

/** Only elements carry tag spans; the tree types every node's location as one union. */
interface ElementSpan extends SourceOffsets {
  startTag?: SourceOffsets;
  endTag?: SourceOffsets;
  attrs?: Record<string, SourceOffsets>;
}

function locationOf(element: Parse5Element | undefined): ElementSpan | null {
  if (!element) return null;
  return (element.sourceCodeLocation as ElementSpan | null) ?? null;
}

/**
 * A `<template>`'s children hang off `content`, not `childNodes`. Missing them
 * leaves every element inside an `x-for`/`x-if` template unvisited, so its close
 * tag looks like it belongs to nothing.
 */
function childrenOf(node: Parse5Node): Parse5Node[] {
  const element = node as {
    childNodes?: Parse5Node[];
    content?: { childNodes?: Parse5Node[] };
  };
  return [
    ...(element.childNodes ?? []),
    ...(element.content?.childNodes ?? []),
  ];
}

function parseDocument(source: string): ParsedDocument {
  const errors: ParserError[] = [];
  const document = parse(source, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => errors.push(error),
  });

  const rawTextBodies: SourceRange[] = [];
  const comments: SourceRange[] = [];
  const attributeRanges: SourceRange[] = [];
  const matchedEndTags = new Set<number>();
  const elements: Parse5Element[] = [];
  const textNodes: DefaultTreeAdapterTypes.TextNode[] = [];
  const parents = new Map<Parse5Node, Parse5Element>();

  const stack: Parse5Node[] = [document];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const location = node.sourceCodeLocation;
    if (node.nodeName === "#comment" && location) {
      comments.push({ start: location.startOffset, end: location.endOffset });
    }
    if (node.nodeName === "#text") {
      textNodes.push(node as DefaultTreeAdapterTypes.TextNode);
    }
    if (isElement(node)) {
      elements.push(node);
      const elementAt = locationOf(node);
      for (const attribute of Object.values(elementAt?.attrs ?? {})) {
        attributeRanges.push({
          start: attribute.startOffset,
          end: attribute.endOffset,
        });
      }
      if (elementAt?.endTag) matchedEndTags.add(elementAt.endTag.startOffset);
      if (RAW_TEXT_TAGS.has(node.tagName) && elementAt?.startTag) {
        rawTextBodies.push({
          start: elementAt.startTag.endOffset,
          end: elementAt.endTag?.startOffset ?? elementAt.endOffset,
        });
      }
    }
    for (const child of childrenOf(node)) {
      if (isElement(node)) parents.set(child, node);
      stack.push(child);
    }
  }

  return {
    source,
    document,
    errors,
    rawTextBodies: rawTextBodies.sort(byStart),
    comments: comments.sort(byStart),
    attributeRanges: attributeRanges.sort(byStart),
    matchedEndTags,
    elements,
    textNodes,
    parents,
  };
}

/**
 * Binary search over sorted, non-overlapping ranges. This is called once per
 * markup token, so a linear scan here is what turns a document carrying many
 * <style>/<script> blocks quadratic.
 */
function fallsInside(index: number, ranges: SourceRange[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid]!;
    if (index < range.start) high = mid - 1;
    else if (index >= range.end) low = mid + 1;
    else return true;
  }
  return false;
}

function byStart(left: SourceRange, right: SourceRange): number {
  return left.start - right.start;
}

function findElements(
  parsed: ParsedDocument,
  tagName: string,
): Parse5Element[] {
  return parsed.elements.filter((element) => element.tagName === tagName);
}

function attributeOf(element: Parse5Element, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

/**
 * `eof-in-tag` covers a tag cut off mid-name and one whose quote was never
 * closed, and the fix differs: telling an author to close a quote that is
 * already closed sends them to the wrong character. Only runs on input the
 * parser has already rejected.
 */
function findUnterminatedTag(parsed: ParsedDocument): {
  start: number;
  tag?: string;
  quote: boolean;
  attribute?: string;
} | null {
  const value = parsed.source;
  let cursor = 0;
  while (cursor < value.length) {
    const open = value.indexOf("<", cursor);
    if (open === -1) return null;
    if (
      fallsInside(open, parsed.rawTextBodies) ||
      fallsInside(open, parsed.comments)
    ) {
      cursor = open + 1;
      continue;
    }
    if (value.startsWith("<!--", open)) {
      const end = value.indexOf("-->", open + 4);
      cursor = end === -1 ? value.length : end + 3;
      continue;
    }
    if (!/^<\s*\/?\s*[a-zA-Z!]/.test(value.slice(open, open + 8))) {
      cursor = open + 1;
      continue;
    }

    let quote: '"' | "'" | null = null;
    let word = "";
    let pending: string | undefined;
    let quoted: string | undefined;
    let terminated = false;
    let scan = open;
    for (; scan < value.length; scan += 1) {
      const character = value[scan]!;
      if (quote) {
        if (character === quote) {
          quote = null;
          quoted = undefined;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        quoted = pending;
        continue;
      }
      if (character === ">") {
        terminated = true;
        break;
      }
      if (character === "=") {
        if (word) pending = word;
        word = "";
        continue;
      }
      if (character === "<" || character === "/" || /\s/.test(character)) {
        word = "";
        continue;
      }
      word += character;
    }
    if (!terminated) {
      return {
        start: open,
        tag: tagNameAtOffset(value, open),
        quote: quote !== null,
        attribute: quote !== null ? quoted : undefined,
      };
    }
    cursor = scan + 1;
  }
  return null;
}

function stripBoundaryNoise(value: string): string {
  return value
    .replace(/^﻿/, "")
    .replace(/<!--(?:[\s\S]*?)-->/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Structural checks
// ---------------------------------------------------------------------------

function collectParseErrorIssues(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  const fatal = FATAL_PARSE_ERRORS.flatMap((code) =>
    parsed.errors.filter((error) => error.code === code),
  )[0];
  if (!fatal) return [];

  if (fatal.code === "eof-in-element-that-can-contain-only-text") {
    const unterminated = parsed.elements.find(
      (element) =>
        RAW_TEXT_TAGS.has(element.tagName) &&
        element.sourceCodeLocation &&
        !element.sourceCodeLocation.endTag,
    );
    const anchor = unterminated?.sourceCodeLocation?.startOffset ?? 0;
    return [
      {
        issue: "raw-text-balance",
        ...locate(anchor),
        ...(unterminated ? { tag: unterminated.tagName } : {}),
      },
    ];
  }

  return [{ issue: "content-truncated", ...locate(fatal.startOffset) }];
}

function tagNameAtOffset(value: string, offset: number): string | undefined {
  return /^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/
    .exec(value.slice(offset, offset + 64))?.[1]
    ?.toLowerCase();
}

const END_TAG_PATTERN = /<\s*\/\s*([a-zA-Z][a-zA-Z0-9:-]*)\s*>/g;

/**
 * The one structural fact the tree cannot supply: the parser drops an end tag
 * that closes nothing without reporting it. Every exclusion range still comes
 * from the tree rather than a second hand-rolled tokenizer.
 */
function collectOrphanEndTags(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  const issues: DesignHtmlIntegrityIssueDetail[] = [];
  END_TAG_PATTERN.lastIndex = 0;
  let match = END_TAG_PATTERN.exec(parsed.source);
  while (match) {
    const offset = match.index;
    const tag = match[1]!.toLowerCase();
    if (
      !parsed.matchedEndTags.has(offset) &&
      !OPTIONAL_CLOSE_TAGS.has(tag) &&
      !VOID_TAGS.has(tag) &&
      !fallsInside(offset, parsed.rawTextBodies) &&
      !fallsInside(offset, parsed.comments) &&
      !fallsInside(offset, parsed.attributeRanges)
    ) {
      issues.push({ issue: "close-tag-orphaned", ...locate(offset), tag });
    }
    match = END_TAG_PATTERN.exec(parsed.source);
  }
  return issues;
}

/**
 * An element the parser closed for you carries no end-tag location. The nearest
 * ancestor that does have one names the tag that arrived where this element's
 * close belonged.
 */
function collectUnclosedElements(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  const issues: DesignHtmlIntegrityIssueDetail[] = [];
  for (const element of parsed.elements) {
    const location = element.sourceCodeLocation;
    // A missing location means the parser invented the element; the document
    // shape checks own that case, not this one.
    if (!location || location.endTag) continue;
    const tag = element.tagName;
    if (VOID_TAGS.has(tag) || OPTIONAL_CLOSE_TAGS.has(tag)) continue;
    const startTag = location.startTag;
    if (
      startTag &&
      /\/\s*>$/.test(
        parsed.source.slice(startTag.startOffset, startTag.endOffset),
      )
    ) {
      continue;
    }

    let ancestor = parsed.parents.get(element);
    let closedBy: { tag: string; line: number } | undefined;
    let carriedByImpliedClose = false;
    while (ancestor) {
      const ancestorEnd = ancestor.sourceCodeLocation?.endTag;
      if (ancestorEnd) {
        closedBy = {
          tag: ancestor.tagName,
          line: locate(ancestorEnd.startOffset).line,
        };
        break;
      }
      // The ancestor's own close was legally omitted, which closes this element
      // with it — `<li><span>one<li>` leaves no defect for the span. The
      // ancestor must be authored: the parser invents <body> for every fragment,
      // and accepting that as the carrier excuses every unclosed element there.
      if (
        ancestor.sourceCodeLocation &&
        OPTIONAL_CLOSE_TAGS.has(ancestor.tagName)
      ) {
        carriedByImpliedClose = true;
        break;
      }
      ancestor = parsed.parents.get(ancestor);
    }
    if (carriedByImpliedClose) continue;
    issues.push({
      issue: "element-unclosed",
      ...locate(location.startOffset),
      tag,
      ...(closedBy ? { closedBy } : {}),
    });
  }
  return issues;
}

/**
 * Alpine compiles these attribute values as JavaScript. Nothing else may join
 * this set on a hunch: `x-for` holds `item in items`, `x-transition:enter` holds
 * a class list, and `x-ref`/`x-teleport` hold a name and a selector — reading
 * any of those as an expression reports working markup as broken.
 */
const ALPINE_EXPRESSION_DIRECTIVES = new Set([
  "x-bind",
  "x-data",
  "x-effect",
  "x-html",
  "x-id",
  "x-if",
  "x-init",
  "x-modelable",
  "x-model",
  "x-show",
  "x-text",
]);

/**
 * Runs for every attribute in the document, so `class`/`style`/`href` must fall
 * out before anything allocates.
 */
function isAlpineExpressionAttribute(name: string): boolean {
  const first = name[0];
  if (first === ":" || first === "@") return name.length > 1;
  if (name.length < 3 || (first !== "x" && first !== "X") || name[1] !== "-") {
    return false;
  }
  const lower = name.toLowerCase();
  if (lower.startsWith("x-on:") || lower.startsWith("x-bind:")) return true;
  let end = 2;
  while (end < lower.length && lower[end] !== "." && lower[end] !== ":") {
    end += 1;
  }
  return ALPINE_EXPRESSION_DIRECTIVES.has(lower.slice(0, end));
}

/** The shapes Alpine wraps in an async IIFE instead of assigning. */
const ALPINE_STATEMENT_SHAPED = /^\s*(?:if\s*\(|let\s|const\s|var\s)/;
const ASSIGNED_PREFIX = "__an_probe = ";

interface ExpressionDefect {
  /** Offset within the expression where the parser gave up. */
  offset: number;
  reason: string;
}

/**
 * Parses the source Alpine generates, not the raw value: the assignment keeps
 * `{ open: false }` an object literal rather than a block, and rejects trailing
 * garbage that `parseExpressionAt` stops short of. Not `new Function` — this runs
 * on the browser write path, where a CSP may forbid it.
 */
function findExpressionDefect(expression: string): ExpressionDefect | null {
  if (!expression.trim()) return null;
  const wrapped = ALPINE_STATEMENT_SHAPED.test(expression);
  const source = wrapped
    ? `(async()=>{ ${expression} })()`
    : `${ASSIGNED_PREFIX}${expression}`;
  try {
    parseJavaScript(source, {
      ecmaVersion: "latest",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
    return null;
  } catch (error) {
    const failure = error as { message?: unknown; pos?: unknown };
    const prefix = wrapped ? "(async()=>{ ".length : ASSIGNED_PREFIX.length;
    return {
      offset:
        typeof failure.pos === "number"
          ? Math.min(Math.max(failure.pos - prefix, 0), expression.length)
          : 0,
      reason:
        typeof failure.message === "string"
          ? failure.message.replace(/\s*\(\d+:\d+\)\s*$/, "")
          : "the expression is not valid JavaScript",
    };
  }
}

/**
 * The attribute location spans `name="value"`, and acorn's offset is relative to
 * the value, so the name and opening quote have to be skipped or every reported
 * column lands early.
 */
function attributeValueStart(
  parsed: ParsedDocument,
  location: SourceRange,
): number {
  const source = parsed.source.slice(location.start, location.end);
  const equals = source.indexOf("=");
  if (equals === -1) return location.start;
  let cursor = equals + 1;
  while (cursor < source.length && /\s/.test(source[cursor]!)) cursor += 1;
  const quote = source[cursor];
  return location.start + cursor + (quote === '"' || quote === "'" ? 1 : 0);
}

function collectExpressionIssues(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  const issues: DesignHtmlIntegrityIssueDetail[] = [];
  for (const element of parsed.elements) {
    for (const attribute of element.attrs) {
      if (!isAlpineExpressionAttribute(attribute.name)) continue;
      // The tree hands back the decoded value, which is what Alpine compiles.
      const defect = findExpressionDefect(attribute.value);
      if (!defect) continue;
      const location = element.sourceCodeLocation?.attrs?.[attribute.name];
      const valueStart = location
        ? attributeValueStart(parsed, {
            start: location.startOffset,
            end: location.endOffset,
          })
        : (element.sourceCodeLocation?.startOffset ?? 0);
      issues.push({
        issue: "expression-invalid",
        ...locate(valueStart + defect.offset),
        tag: element.tagName,
        attribute: attribute.name,
        reason: defect.reason,
      });
    }
  }
  return issues;
}

/**
 * The JavaScript MIME types a browser will execute, per the HTML spec. Anything
 * else — `importmap`, `application/json`, an `x-template`, a bespoke
 * `application/vnd.*` block — is inert data the browser never parses, so parsing
 * it here reports working markup as broken.
 */
const EXECUTABLE_SCRIPT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

/** `null` when the browser treats the element as data rather than code. */
function scriptGrammar(type: string): "script" | "module" | null {
  const normalized = type.trim().toLowerCase();
  if (normalized === "") return "script";
  if (normalized === "module") return "module";
  const base = normalized.split(";")[0]!.trim();
  return EXECUTABLE_SCRIPT_TYPES.has(base) ? "script" : null;
}

/**
 * Parsed with the grammar the browser will actually use. Retrying a classic
 * script as a module accepts `import` and top-level `await` in an element the
 * browser rejects outright.
 */
function findScriptDefect(
  source: string,
  sourceType: "script" | "module",
): ExpressionDefect | null {
  try {
    parseJavaScript(source, {
      ecmaVersion: "latest",
      sourceType,
      // A <script> body is a Program, not a function body: a browser rejects a
      // top-level `return` with "Illegal return statement" and never runs the
      // element. Alpine expressions are the opposite case — Alpine compiles them
      // inside a function — which is why the expression parser allows it.
      allowReturnOutsideFunction: false,
      allowAwaitOutsideFunction: sourceType === "module",
      allowHashBang: true,
    });
    return null;
  } catch (error) {
    const failure = error as { message?: unknown; pos?: unknown };
    return {
      offset: typeof failure.pos === "number" ? failure.pos : 0,
      reason:
        typeof failure.message === "string"
          ? failure.message.replace(/\s*\(\d+:\d+\)\s*$/, "")
          : "the script is not valid JavaScript",
    };
  }
}

/**
 * A truncated string in an inline <script> is the same defect as one in an
 * Alpine attribute and just as invisible: the document parses, the element
 * renders, and the script silently never runs.
 */
function collectScriptBodyIssues(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  const issues: DesignHtmlIntegrityIssueDetail[] = [];
  for (const element of parsed.elements) {
    if (element.tagName !== "script") continue;
    if (element.attrs.some((attribute) => attribute.name === "src")) continue;
    const grammar = scriptGrammar(attributeOf(element, "type") ?? "");
    if (!grammar) continue;
    const body = element.childNodes.find((node) => node.nodeName === "#text");
    if (!body) continue;
    const text = (body as DefaultTreeAdapterTypes.TextNode).value;
    if (!text.trim()) continue;
    const defect = findScriptDefect(text, grammar);
    if (!defect) continue;
    const start =
      body.sourceCodeLocation?.startOffset ??
      locationOf(element)?.startOffset ??
      0;
    issues.push({
      issue: "script-invalid",
      ...locate(start + defect.offset),
      tag: "script",
      reason: defect.reason,
    });
  }
  return issues;
}

/**
 * Runs on fragments as well as documents — an unterminated quote is as
 * destructive in a `<template>` snippet as in a full page.
 */
function collectStructuralIssues(
  value: string,
  parsed = parseDocument(value),
): DesignHtmlIntegrityIssueDetail[] {
  const locate = createLocator(value);
  // Reported alone: everything after an unterminated tag is invented structure.
  // Cannot be driven off the parser's errors — a runaway attribute quote
  // swallows markup until a later quote resyncs the tokenizer, which then
  // finishes the document without complaining.
  const unterminated = findUnterminatedTag(parsed);
  if (unterminated) {
    return [
      {
        issue: unterminated.quote
          ? "attribute-unterminated"
          : "content-truncated",
        ...locate(unterminated.start),
        ...(unterminated.tag ? { tag: unterminated.tag } : {}),
        ...(unterminated.attribute
          ? { attribute: unterminated.attribute }
          : {}),
      },
    ];
  }
  const truncation = collectParseErrorIssues(parsed, locate);
  if (truncation.length > 0) return truncation;

  return [
    ...collectUnclosedElements(parsed, locate),
    ...collectOrphanEndTags(parsed, locate),
    ...collectExpressionIssues(parsed, locate),
    ...collectScriptBodyIssues(parsed, locate),
  ]
    .sort((left, right) =>
      left.line === right.line
        ? left.column - right.column
        : left.line - right.line,
    )
    .slice(0, MAX_REPORTED_ISSUES);
}

// ---------------------------------------------------------------------------
// Document shape
// ---------------------------------------------------------------------------

const ROOT_TAG_PATTERN = /<\s*(\/?)\s*(html|head|body)\b/gi;

/**
 * The parser merges a second `<html>` into the first and reports nothing, so two
 * full documents concatenated by a bad write are invisible in the tree.
 */
function countRootTags(
  parsed: ParsedDocument,
): Record<"html" | "head" | "body", { open: number; close: number }> {
  const counts = {
    html: { open: 0, close: 0 },
    head: { open: 0, close: 0 },
    body: { open: 0, close: 0 },
  };
  ROOT_TAG_PATTERN.lastIndex = 0;
  let match = ROOT_TAG_PATTERN.exec(parsed.source);
  while (match) {
    const offset = match.index;
    if (
      !fallsInside(offset, parsed.rawTextBodies) &&
      !fallsInside(offset, parsed.comments) &&
      !fallsInside(offset, parsed.attributeRanges)
    ) {
      const tag = match[2]!.toLowerCase() as "html" | "head" | "body";
      if (match[1] === "/") counts[tag].close += 1;
      else counts[tag].open += 1;
    }
    match = ROOT_TAG_PATTERN.exec(parsed.source);
  }
  return counts;
}

/** An authored root, as opposed to one the parser supplied for a fragment. */
function authoredRoot(
  parsed: ParsedDocument,
  tagName: "html" | "head" | "body",
): Parse5Element | undefined {
  return findElements(parsed, tagName).find(
    (element) =>
      element.sourceCodeLocation !== null &&
      element.sourceCodeLocation !== undefined,
  );
}

function hasDoctype(parsed: ParsedDocument): boolean {
  return childrenOf(parsed.document).some(
    (node) => node.nodeName === "#documentType" && node.sourceCodeLocation,
  );
}

function isDocumentHtml(value: string, parsed = parseDocument(value)): boolean {
  return hasDoctype(parsed) || authoredRoot(parsed, "html") !== undefined;
}

function collectDocumentShapeIssue(
  parsed: ParsedDocument,
): DesignHtmlIntegrityIssue | null {
  const counts = countRootTags(parsed);
  if (counts.html.open !== 1 || counts.html.close !== 1) return "document-root";
  if (counts.body.open !== 1 || counts.body.close !== 1) return "document-body";
  if (counts.head.open !== counts.head.close || counts.head.open > 1) {
    return "document-head";
  }

  const htmlAt = locationOf(authoredRoot(parsed, "html"));
  const htmlEnd = htmlAt?.endTag;
  if (!htmlAt || !htmlEnd) return "document-root";
  const bodyAt = locationOf(authoredRoot(parsed, "body"));
  const bodyEnd = bodyAt?.endTag;
  if (!bodyAt || !bodyEnd) return "document-body";

  if (
    bodyAt.startOffset <= htmlAt.startOffset ||
    bodyEnd.startOffset >= htmlEnd.startOffset
  ) {
    return "document-boundary";
  }

  const prefix = stripBoundaryNoise(
    parsed.source.slice(0, htmlAt.startOffset),
  ).replace(/<!doctype\s+html\b[^>]*>/i, "");
  const suffix = stripBoundaryNoise(parsed.source.slice(htmlEnd.endOffset));
  if (prefix.trim() || suffix.trim()) return "document-boundary";

  return null;
}

/**
 * A marker that lost its element is not missing — it is sitting in the document
 * as text, which is exactly how a partial edit leaves it.
 */
function collectManagedMarkerIssue(
  parsed: ParsedDocument,
): DesignHtmlIntegrityIssue | null {
  for (const { marker, tag } of MANAGED_RAW_TEXT_MARKERS) {
    const attached = parsed.elements.filter(
      (element) =>
        element.tagName === tag &&
        element.attrs.some((attribute) => attribute.name === marker),
    ).length;
    const loose = parsed.textNodes.some(
      (node) =>
        node.value.includes(marker) &&
        !RAW_TEXT_TAGS.has(parsed.parents.get(node)?.tagName ?? ""),
    );
    if (loose) return "managed-marker-orphaned";
    if (attached > 1) return "managed-marker-duplicated";
  }
  return null;
}

/**
 * Reported, never enforced: legitimate fragments and token-only screens carry no
 * runtime of their own, so blocking here would reject valid work.
 */
function collectAdvisoryIssues(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  // Only documents that actually depend on utility classes can be broken by a
  // missing runtime. A screen styled entirely through its own CSS needs no
  // Tailwind, and flagging it would train authors to ignore this warning.
  if (!USES_TAILWIND_UTILITIES.test(parsed.source)) return [];
  const hasRuntime = parsed.elements.some((element) => {
    if (element.tagName === "script") {
      return /tailwind/i.test(attributeOf(element, "src") ?? "");
    }
    if (element.tagName === "link") {
      return /tailwind/i.test(attributeOf(element, "href") ?? "");
    }
    if (element.tagName === "style") {
      return (
        (attributeOf(element, "type") ?? "").toLowerCase() ===
        "text/tailwindcss"
      );
    }
    return false;
  });
  if (hasRuntime) return [];
  const head = authoredRoot(parsed, "head");
  return [
    {
      issue: "runtime-missing",
      ...locate(head?.sourceCodeLocation?.startOffset ?? 0),
    },
  ];
}

/**
 * Validate one complete Design HTML document. The HTML5 parser is the tokenizer,
 * but never the verdict: it repairs the missing roots and unbalanced elements
 * this guard exists to catch, so the checks read its tree and its parse errors
 * rather than trusting that it produced a document.
 */
export function inspectDesignHtmlDocumentIntegrity(
  value: string,
): DesignHtmlIntegrityResult {
  const parsed = parseDocument(value);
  const locate = createLocator(value);

  // Structure first. An unterminated quote swallows the root tags, so a
  // shape-first order would report `document-root` — sending the fix to an
  // `<html>` tag that is present and correct instead of to the quote.
  const structural = collectStructuralIssues(value, parsed);
  if (structural.length > 0) {
    return { valid: false, issue: structural[0]!.issue, detail: structural };
  }

  if (!isDocumentHtml(value, parsed)) return { valid: true };

  const shape = collectDocumentShapeIssue(parsed);
  if (shape) return { valid: false, issue: shape };

  const marker = collectManagedMarkerIssue(parsed);
  if (marker) return { valid: false, issue: marker };

  const advisory = collectAdvisoryIssues(parsed, locate);
  return advisory.length > 0 ? { valid: true, advisory } : { valid: true };
}

/**
 * Fail closed only for document edits. Standalone Alpine fragments remain
 * supported. Existing malformed documents can still be repaired: a candidate
 * is accepted when it is valid, but an edit may never introduce or preserve a
 * malformed complete-document candidate.
 */
export function assertDesignHtmlEditIntegrity(args: {
  previousContent: string;
  nextContent: string;
  fileType: string;
  filename?: string;
}): void {
  // Checked before the fileType gate and before any document-shape reasoning:
  // a URL-backed screen's stored content is a route, not markup, so none of
  // the rules below can see the damage. Concatenating a serialized subtree
  // onto the route still parses as a URL to `new URL()` and still balances as
  // a fragment, so every other pass here says "valid" while the screen's live
  // binding is destroyed for good. Re-pointing the route (URL -> URL) stays
  // allowed; only URL -> markup is the one-way door.
  if (
    isStandaloneHttpUrl(args.previousContent) &&
    !isStandaloneHttpUrl(args.nextContent)
  ) {
    throw new DesignHtmlIntegrityError("url-backed-screen-replaced", {
      filename: args.filename,
    });
  }
  if (args.fileType.toLowerCase() !== "html") return;
  const previousIsDocument = isDocumentHtml(args.previousContent);
  const nextIsDocument = isDocumentHtml(args.nextContent);
  // Fragments still get the structural pass; only the document-shape checks
  // below need a document to apply to.
  if (!previousIsDocument && !nextIsDocument) {
    const structural = collectStructuralIssues(args.nextContent);
    if (structural.length > 0) {
      throw new DesignHtmlIntegrityError(structural[0]!.issue, {
        filename: args.filename,
        detail: structural,
      });
    }
    return;
  }
  if (previousIsDocument && !nextIsDocument) {
    throw new DesignHtmlIntegrityError("document-root", {
      filename: args.filename,
    });
  }
  const result = inspectDesignHtmlDocumentIntegrity(args.nextContent);
  if (!result.valid) {
    throw new DesignHtmlIntegrityError(result.issue ?? "document-root", {
      filename: args.filename,
      detail: result.detail,
    });
  }
}

/**
 * Creation counterpart to the edit transition above. Every creation path must
 * run this, or a design's first save is the one write with no gate at all.
 *
 * Returns advisory issues for the caller to surface; throws on anything
 * blocking.
 */
/**
 * Well-formedness only — no document-shape rules. For markup that is not
 * required to be a complete screen, such as a variant sketch, where `<html>` and
 * `<body>` are legitimately implied. Unbalanced tags are defects at any level of
 * completeness; a missing skeleton is not.
 */
export function assertDesignHtmlWellFormed(args: {
  content: string;
  filename?: string;
}): void {
  if (!args.content.trim()) return;
  const structural = collectStructuralIssues(args.content);
  if (structural.length > 0) {
    throw new DesignHtmlIntegrityError(structural[0]!.issue, {
      filename: args.filename,
      detail: structural,
    });
  }
}

export function assertDesignHtmlCreateIntegrity(args: {
  content: string;
  fileType: string;
  filename?: string;
}): DesignHtmlIntegrityIssueDetail[] {
  if ((args.fileType || "html").toLowerCase() !== "html") return [];
  if (!args.content.trim()) return [];
  const result = inspectDesignHtmlDocumentIntegrity(args.content);
  if (!result.valid) {
    throw new DesignHtmlIntegrityError(result.issue ?? "document-root", {
      filename: args.filename,
      detail: result.detail,
    });
  }
  return result.advisory ?? [];
}

export function isDesignHtmlIntegrityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === DESIGN_HTML_INTEGRITY_ERROR_CODE ||
    (typeof candidate.message === "string" &&
      candidate.message.includes(DESIGN_HTML_INTEGRITY_ERROR_CODE))
  );
}
