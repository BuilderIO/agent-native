import { parse as parseJavaScript } from "acorn";
import { type DefaultTreeAdapterTypes, parse, type ParserError } from "parse5";
import CssSyntaxError from "postcss/lib/css-syntax-error";
import CssInput from "postcss/lib/input";
import parseCss from "postcss/lib/parse";
// @ts-expect-error PostCSS exports its tokenizer without TypeScript declarations.
import tokenizeCss from "postcss/lib/tokenize";

import { isStandaloneHttpUrl } from "./html-content.js";

export const DESIGN_HTML_INTEGRITY_ERROR_CODE = "DESIGN_HTML_INTEGRITY";

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
  | "style-invalid"
  | "element-unclosed"
  | "close-tag-orphaned"
  | "content-truncated"
  | "runtime-missing"
  | "runtime-alpine-missing"
  | "runtime-cloak-missing"
  | "runtime-overlay-unhidden"
  | "url-backed-screen-replaced";

export interface DesignHtmlIntegrityIssueDetail {
  issue: DesignHtmlIntegrityIssue;
  line: number;
  column: number;
  excerpt: string;
  tag?: string;
  attribute?: string;
  reason?: string;
  closedBy?: { tag: string; line: number };
}

export interface DesignHtmlIntegrityResult {
  valid: boolean;
  issue?: DesignHtmlIntegrityIssue;
  detail?: DesignHtmlIntegrityIssueDetail[];
  advisory?: DesignHtmlIntegrityIssueDetail[];
}

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
  "runtime-cloak-missing":
    "this document uses x-cloak without the CSS rule that keeps Alpine-controlled content hidden before Alpine starts",
  "runtime-alpine-missing":
    "this document uses Alpine directives but does not load Alpine.js, so every repeat, binding and event stays inert",
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
    case "style-invalid":
      return `the inline <style> at ${at} is not valid CSS: ${detail.reason ?? "it does not parse"}. Repair the stylesheet before retrying the edit.`;
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
    case "runtime-alpine-missing":
      return (
        `the document uses ${detail.attribute ?? "Alpine directives"} on ` +
        `<${detail.tag ?? "element"}> at ${at}, but no <script src> contains ` +
        `"alpinejs". Every repeat, binding and event stays inert and renders ` +
        `nothing at all. Load Alpine.js — and if a script tag already looks ` +
        `present, check its src still carries the package name.`
      );
    case "runtime-overlay-unhidden":
      return (
        `<${detail.tag ?? "element"}> at ${at} covers the whole frame and is ` +
        `shown by Alpine (${detail.attribute ?? "x-show"}), but nothing hides ` +
        `it before Alpine starts. It paints over the design on first render. ` +
        `Add x-cloak plus [x-cloak] { display: none !important; }, or an ` +
        `inline style="display:none".`
      );
    case "runtime-cloak-missing":
      return (
        `the document uses x-cloak on <${detail.tag ?? "element"}> at ${at}, ` +
        `but no style block defines [x-cloak] { display: none !important; }. ` +
        `Alpine-controlled overlays can flash or cover the entire screen before ` +
        `Alpine starts. Add that exact hiding rule to the document.`
      );
    default:
      return `the document structure is invalid (${detail.issue}) at ${at}.`;
  }
}

export class DesignHtmlIntegrityError extends Error {
  readonly code = DESIGN_HTML_INTEGRITY_ERROR_CODE;
  readonly statusCode = 422;
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
      :
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
  { marker: "data-agent-native-group-runtime", tag: "script" },
  { marker: "data-agent-native-shader-runtime", tag: "script" },
] as const;

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

const USES_TAILWIND_UTILITIES =
  /\bclass\s*=\s*["'][^"']*(?:\b(?:flex|grid|hidden|absolute|relative|sticky)\b|\b(?:p|m|px|py|mx|my|pt|pb|pl|pr|gap|w|h|text|bg|border|rounded|shadow|items|justify|font|leading|tracking|space-x|space-y|min-h|max-w|opacity|ring|z)-[a-z0-9[\]./-]+)/i;

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



type Parse5Node = DefaultTreeAdapterTypes.Node;
type Parse5Element = DefaultTreeAdapterTypes.Element;
type SourceRange = { start: number; end: number };
type SourceOffsets = { startOffset: number; endOffset: number };

interface ParsedDocument {
  source: string;
  document: DefaultTreeAdapterTypes.Document;
  errors: ParserError[];
  rawTextBodies: SourceRange[];
  comments: SourceRange[];
  attributeRanges: SourceRange[];
  matchedEndTags: Set<number>;
  elements: Parse5Element[];
  textNodes: DefaultTreeAdapterTypes.TextNode[];
  parents: Map<Parse5Node, Parse5Element>;
}

function isElement(node: Parse5Node): node is Parse5Element {
  return typeof (node as Parse5Element).tagName === "string";
}

interface ElementSpan extends SourceOffsets {
  startTag?: SourceOffsets;
  endTag?: SourceOffsets;
  attrs?: Record<string, SourceOffsets>;
}

function locationOf(element: Parse5Element | undefined): ElementSpan | null {
  if (!element) return null;
  return (element.sourceCodeLocation as ElementSpan | null) ?? null;
}

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

function collectUnclosedElements(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  const issues: DesignHtmlIntegrityIssueDetail[] = [];
  for (const element of parsed.elements) {
    const location = element.sourceCodeLocation;
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

const ALPINE_STATEMENT_SHAPED = /^\s*(?:if\s*\(|let\s|const\s|var\s)/;
const ASSIGNED_PREFIX = "__an_probe = ";

interface ExpressionDefect {
  offset: number;
  reason: string;
}

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

export function scriptGrammar(type: string): "script" | "module" | null {
  const normalized = type.trim().toLowerCase();
  if (normalized === "") return "script";
  if (normalized === "module") return "module";
  const base = normalized.split(";")[0]!.trim();
  return EXECUTABLE_SCRIPT_TYPES.has(base) ? "script" : null;
}

function findScriptDefect(
  source: string,
  sourceType: "script" | "module",
): ExpressionDefect | null {
  try {
    parseJavaScript(source, {
      ecmaVersion: "latest",
      sourceType,
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

type CssToken = [type: string, value: string, start?: number, end?: number];

interface CssTokenizer {
  endOfFile(): boolean;
  nextToken(): CssToken | undefined;
}

function ignoreTopLevelHtmlCommentTokens(css: string): string {
  const input = new CssInput(css, { map: false });
  const scanner = (tokenizeCss as (input: CssInput) => CssTokenizer)(input);
  const source = input.css;
  const tokens: CssToken[] = [];
  while (!scanner.endOfFile()) {
    const token = scanner.nextToken();
    if (!token) break;
    tokens.push(token);
  }

  const ignored: Array<[start: number, end: number]> = [];
  let atRule = false;
  let braces = 0;
  let brackets = 0;
  let betweenRules = true;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token[0] === "space" || token[0] === "comment") continue;

    if (braces === 0 && brackets === 0 && betweenRules) {
      if (token[0] === "word" && token[2] !== undefined) {
        let cursor = token[2];
        while (
          source.startsWith("<!--", cursor) ||
          source.startsWith("-->", cursor)
        ) {
          const length = source.startsWith("<!--", cursor) ? 4 : 3;
          ignored.push([cursor, cursor + length]);
          cursor += length;
        }
        if (cursor > token[2]) {
          let resumeIndex = index;
          while (resumeIndex + 1 < tokens.length) {
            const next = tokens[resumeIndex + 1]!;
            if (next[2] === undefined || next[2] >= cursor) break;
            resumeIndex += 1;
          }
          const resume = tokens[resumeIndex]!;
          const resumeEnd =
            resume[2] === undefined
              ? undefined
              : (resume[3] ?? resume[2] + resume[1].length - 1);
          if (
            resume[2] !== undefined &&
            resume[2] < cursor &&
            resumeEnd !== undefined &&
            resumeEnd >= cursor
          ) {
            betweenRules = false;
            atRule = false;
          }
          index = resumeIndex;
          continue;
        }
      }
      betweenRules = false;
      atRule = token[0] === "at-word";
    }

    if (token[0] === "[") brackets += 1;
    else if (token[0] === "]") brackets = Math.max(0, brackets - 1);
    else if (token[0] === "{" && brackets === 0) braces += 1;
    else if (token[0] === "}" && brackets === 0 && braces > 0) {
      braces -= 1;
      if (braces === 0) {
        betweenRules = true;
        atRule = false;
      }
    } else if (token[0] === ";" && braces === 0 && brackets === 0 && atRule) {
      betweenRules = true;
      atRule = false;
    }
  }

  if (ignored.length === 0) return css;
  const offset = input.hasBOM ? 1 : 0;
  const characters = css.split("");
  for (const [start, end] of ignored) {
    for (let index = start + offset; index < end + offset; index += 1) {
      characters[index] = " ";
    }
  }
  return characters.join("");
}

function collectStyleBodyIssues(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  const issues: DesignHtmlIntegrityIssueDetail[] = [];
  for (const element of parsed.elements) {
    if (element.tagName !== "style") continue;
    const type = attributeOf(element, "type")?.trim().toLowerCase();
    if (type && type !== "text/css" && type !== "text/tailwindcss") continue;
    const body = element.childNodes.find((node) => node.nodeName === "#text");
    if (!body) continue;
    const location = body.sourceCodeLocation;
    const text = location
      ? parsed.source.slice(location.startOffset, location.endOffset)
      : (body as DefaultTreeAdapterTypes.TextNode).value;
    try {
      parseCss(ignoreTopLevelHtmlCommentTokens(text), { map: false });
    } catch (error) {
      if (!(error instanceof CssSyntaxError)) throw error;
      const start = location?.startOffset ?? 0;
      issues.push({
        issue: "style-invalid",
        ...locate(start + (error.input?.offset ?? 0)),
        tag: "style",
        reason: error.reason,
      });
    }
  }
  return issues;
}

function collectStructuralIssues(
  value: string,
  parsed = parseDocument(value),
): DesignHtmlIntegrityIssueDetail[] {
  const locate = createLocator(value);
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
    ...collectStyleBodyIssues(parsed, locate),
  ]
    .sort((left, right) =>
      left.line === right.line
        ? left.column - right.column
        : left.line - right.line,
    )
    .slice(0, MAX_REPORTED_ISSUES);
}


const ROOT_TAG_PATTERN = /<\s*(\/?)\s*(html|head|body)\b/gi;

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

const X_CLOAK_RULE =
  /\[x-cloak\][^{}]*\{[^}]*(?:display\s*:\s*none|visibility\s*:\s*hidden|@apply[^;}]*\bhidden\b)/i;
const ALPINE_RUNTIME = /\balpinejs\b/i;
const INLINE_PRE_HIDE = /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i;

type RuntimeOwner = "document" | "host";

const EMPTY_X_DATA = /^\s*(?:\{\s*\})?\s*$/;

function bindsAnything(name: string): boolean {
  return (
    (name.startsWith("x-") && name !== "x-data") ||
    name.startsWith(":") ||
    name.startsWith("@")
  );
}

/**
 * True when the document declares a scope that holds nothing and binds
 * nothing — `<body x-data="{}">` on an otherwise plain page. Loading Alpine
 * would change how it renders in no way at all.
 */
function declaresNoAlpineBehaviour(
  declared: DefaultTreeAdapterTypes.Element,
  parsed: ParsedDocument,
): boolean {
  const value =
    declared.attrs.find(
      (attribute) => attribute.name.toLowerCase() === "x-data",
    )?.value ?? "";
  if (!EMPTY_X_DATA.test(value)) return false;
  return !parsed.elements.some((element) =>
    element.attrs.some((attribute) =>
      bindsAnything(attribute.name.toLowerCase()),
    ),
  );
}

function collectInteractiveRuntimeIssues(
  parsed: ParsedDocument,
  locate: Locator,
  runtimeOwner: RuntimeOwner,
): DesignHtmlIntegrityIssueDetail[] {
  const ownerOf = (name: string) =>
    parsed.elements.find((element) =>
      element.attrs.some((attribute) => attribute.name.toLowerCase() === name),
    );
  const declared = runtimeOwner === "document" ? ownerOf("x-data") : undefined;
  const scoped =
    declared && !declaresNoAlpineBehaviour(declared, parsed)
      ? declared
      : undefined;
  const cloaked = ownerOf("x-cloak");
  if (!scoped && !cloaked) return [];

  const anchorAt = (
    element: DefaultTreeAdapterTypes.Element,
    attributeName: string,
  ): Omit<DesignHtmlIntegrityIssueDetail, "issue"> => {
    const at = locate(
      locationOf(element)?.attrs?.[attributeName]?.startOffset ??
        locationOf(element)?.startOffset ??
        0,
    );
    return {
      line: at.line,
      column: at.column,
      excerpt: at.excerpt,
      tag: element.tagName,
      attribute: attributeName,
    };
  };

  const hasAlpineRuntime = parsed.elements.some(
    (element) =>
      element.tagName === "script" &&
      ALPINE_RUNTIME.test(attributeOf(element, "src") ?? ""),
  );

  const hasUnreadableStylesheet = parsed.elements.some(
    (element) =>
      element.tagName === "link" &&
      /\bstylesheet\b/i.test(attributeOf(element, "rel") ?? "") &&
      (attributeOf(element, "href") ?? "").trim().length > 0,
  );

  const hasCloakRule =
    hasUnreadableStylesheet ||
    INLINE_PRE_HIDE.test(
      (cloaked ? attributeOf(cloaked, "style") : "") ?? "",
    ) ||
    parsed.elements.some((element) => {
      if (element.tagName !== "style") return false;
      const css = childrenOf(element)
        .filter((node) => node.nodeName === "#text")
        .map((node) => (node as DefaultTreeAdapterTypes.TextNode).value)
        .join("\n");
      return X_CLOAK_RULE.test(css);
    });

  const runtimeAnchor = scoped ?? cloaked;
  return [
    ...(hasAlpineRuntime || !runtimeAnchor
      ? []
      : [
          {
            issue: "runtime-alpine-missing" as const,
            ...anchorAt(runtimeAnchor, scoped ? "x-data" : "x-cloak"),
          },
        ]),
    ...(hasCloakRule || !cloaked
      ? []
      : [
          {
            issue: "runtime-cloak-missing" as const,
            ...anchorAt(cloaked, "x-cloak"),
          },
        ]),
  ];
}

function coversViewport(className: string): boolean {
  const classes = new Set(className.split(/\s+/));
  const positioned = classes.has("fixed") || classes.has("absolute");
  const fullBleed =
    classes.has("inset-0") ||
    (classes.has("w-screen") && classes.has("h-screen"));
  return positioned && fullBleed;
}

function collectOverlayAdvisory(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  for (const element of parsed.elements) {
    const names = new Set(
      element.attrs.map((attribute) => attribute.name.toLowerCase()),
    );
    if (names.has("x-cloak") || !names.has("x-show")) continue;
    if (!coversViewport(attributeOf(element, "class") ?? "")) continue;
    if (INLINE_PRE_HIDE.test(attributeOf(element, "style") ?? "")) continue;

    return [
      {
        issue: "runtime-overlay-unhidden",
        ...locate(locationOf(element)?.startOffset ?? 0),
        tag: element.tagName,
        attribute: "x-show",
      },
    ];
  }
  return [];
}

/**
 * Reported, never enforced: legitimate fragments and token-only screens carry no
 * runtime of their own, so blocking here would reject valid work.
 */
function collectAdvisoryIssues(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
  return [
    ...collectOverlayAdvisory(parsed, locate),
    ...collectTailwindRuntimeAdvisory(parsed, locate),
  ];
}

function collectTailwindRuntimeAdvisory(
  parsed: ParsedDocument,
  locate: Locator,
): DesignHtmlIntegrityIssueDetail[] {
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

export function inspectDesignHtmlDocumentIntegrity(
  value: string,
): DesignHtmlIntegrityResult {
  const parsed = parseDocument(value);
  const locate = createLocator(value);

  const structural = collectStructuralIssues(value, parsed);
  if (structural.length > 0) {
    return { valid: false, issue: structural[0]!.issue, detail: structural };
  }

  if (!isDocumentHtml(value, parsed)) return { valid: true };

  const shape = collectDocumentShapeIssue(parsed);
  if (shape) return { valid: false, issue: shape };

  const marker = collectManagedMarkerIssue(parsed);
  if (marker) return { valid: false, issue: marker };

  const interactiveRuntime = collectInteractiveRuntimeIssues(
    parsed,
    locate,
    "document",
  );
  if (interactiveRuntime.length > 0) {
    return {
      valid: false,
      issue: interactiveRuntime[0]!.issue,
      detail: interactiveRuntime,
    };
  }

  const advisory = collectAdvisoryIssues(parsed, locate);
  return advisory.length > 0 ? { valid: true, advisory } : { valid: true };
}

const RUNTIME_ISSUES: ReadonlySet<DesignHtmlIntegrityIssue> = new Set([
  "runtime-alpine-missing",
  "runtime-cloak-missing",
]);

function introducedRuntimeIssues(
  next: DesignHtmlIntegrityIssueDetail[],
  previousContent: string,
  runtimeOwner: RuntimeOwner,
): DesignHtmlIntegrityIssueDetail[] {
  if (next.length === 0 || !previousContent.trim()) return next;
  const inherited = new Set(
    collectInteractiveRuntimeIssues(
      parseDocument(previousContent),
      createLocator(previousContent),
      runtimeOwner,
    ).map((entry) => entry.issue),
  );
  return next.filter((entry) => !inherited.has(entry.issue));
}

export function assertDesignHtmlEditIntegrity(args: {
  previousContent: string;
  nextContent: string;
  fileType: string;
  filename?: string;
}): void {
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
  if (!previousIsDocument && !nextIsDocument) {
    const structural = collectStructuralIssues(args.nextContent);
    if (structural.length > 0) {
      throw new DesignHtmlIntegrityError(structural[0]!.issue, {
        filename: args.filename,
        detail: structural,
      });
    }
    const interactiveRuntime = introducedRuntimeIssues(
      collectInteractiveRuntimeIssues(
        parseDocument(args.nextContent),
        createLocator(args.nextContent),
        "host",
      ),
      args.previousContent,
      "host",
    );
    if (interactiveRuntime.length > 0) {
      throw new DesignHtmlIntegrityError(interactiveRuntime[0]!.issue, {
        filename: args.filename,
        detail: interactiveRuntime,
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
    if (result.issue && RUNTIME_ISSUES.has(result.issue)) {
      const introduced = introducedRuntimeIssues(
        result.detail ?? [],
        args.previousContent,
        "document",
      );
      if (introduced.length === 0) return;
      throw new DesignHtmlIntegrityError(introduced[0]!.issue, {
        filename: args.filename,
        detail: introduced,
      });
    }
    throw new DesignHtmlIntegrityError(result.issue ?? "document-root", {
      filename: args.filename,
      detail: result.detail,
    });
  }
}

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
  const interactiveRuntime = collectInteractiveRuntimeIssues(
    parseDocument(args.content),
    createLocator(args.content),
    "host",
  );
  if (interactiveRuntime.length > 0) {
    throw new DesignHtmlIntegrityError(interactiveRuntime[0]!.issue, {
      filename: args.filename,
      detail: interactiveRuntime,
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
