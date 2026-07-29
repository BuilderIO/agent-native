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

/**
 * Bodies are text, not markup — mis-tokenizing these turns a `'</div>'` string
 * inside Alpine JavaScript into a phantom structural error. Both passes must
 * agree on this set: when only one treated `<title>`/`<textarea>` as raw text,
 * literal `<body>` text inside a title reached the root-tag count as real markup.
 */
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);
type RawTextTag = "script" | "style" | "textarea" | "title";

const MANAGED_RAW_TEXT_MARKERS = [
  { marker: "data-agent-native-breakpoints", tag: "style" },
  { marker: "data-agent-native-state-breakpoints", tag: "style" },
  { marker: "data-agent-native-states", tag: "style" },
  { marker: "data-agent-native-motion", tag: "style" },
  { marker: "data-agent-native-shader-runtime", tag: "script" },
] as const;

interface RawTextScan {
  severity: number;
  bodyRanges: Array<{ start: number; end: number }>;
}

function matchFallsInsideRanges(
  index: number,
  ranges: RawTextScan["bodyRanges"],
): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function countMatchesOutsideRanges(
  value: string,
  pattern: RegExp,
  ranges: RawTextScan["bodyRanges"],
  requireMarkupStart = false,
): number {
  return Array.from(value.matchAll(pattern)).filter((match) => {
    // Root-tag-shaped strings inside quoted Alpine attributes and comments
    // are data, not document structure. Counting them here made an otherwise
    // valid document look like it had duplicate <html>/<body>/<head> roots.
    // Every caller of this helper is counting a markup token, so require the
    // tokenizer to agree that the candidate starts outside those contexts.
    return (
      match.index !== undefined &&
      !matchFallsInsideRanges(match.index, ranges) &&
      (!requireMarkupStart ||
        matchStartsMarkupToken(value, match.index, ranges))
    );
  }).length;
}

function firstMatchOutsideRanges(
  value: string,
  pattern: RegExp,
  ranges: RawTextScan["bodyRanges"],
): { index: number; text: string } | null {
  const match = Array.from(value.matchAll(pattern)).find(
    (candidate) =>
      candidate.index !== undefined &&
      !matchFallsInsideRanges(candidate.index, ranges) &&
      matchStartsMarkupToken(value, candidate.index, ranges),
  );
  return match?.index === undefined
    ? null
    : { index: match.index, text: match[0] };
}

function matchStartsMarkupToken(
  value: string,
  index: number,
  rawTextBodyRanges: RawTextScan["bodyRanges"],
): boolean {
  if (matchFallsInsideRanges(index, rawTextBodyRanges)) return false;

  // A bare regex also finds tag-shaped strings in Alpine attributes and HTML
  // comments, for example `x-data="{ sample: '>' + '<html></html>' }"`.
  // Walk the markup tokenizer state up to the candidate so a `>` inside a
  // quoted attribute cannot fool a last-delimiter heuristic into treating the
  // following string as a real root tag.
  let inTag = false;
  let quote: '"' | "'" | null = null;
  let rawRangeIndex = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    while (
      rawRangeIndex < rawTextBodyRanges.length &&
      cursor >= rawTextBodyRanges[rawRangeIndex]!.end
    ) {
      rawRangeIndex += 1;
    }
    const rawRange = rawTextBodyRanges[rawRangeIndex];
    if (!inTag && rawRange) {
      if (cursor >= rawRange.start && cursor < rawRange.end) {
        if (index < rawRange.end) return false;
        cursor = rawRange.end - 1;
        continue;
      }
    }

    if (!inTag && value.startsWith("<!--", cursor)) {
      const commentEnd = value.indexOf("-->", cursor + 4);
      if (commentEnd === -1 || index < commentEnd + 3) return false;
      cursor = commentEnd + 2;
      continue;
    }

    const character = value[cursor];
    if (!inTag) {
      if (character !== "<") continue;
      if (cursor === index) return true;
      inTag = true;
      quote = null;
      continue;
    }

    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      inTag = false;
    }
  }
  return false;
}

function isDocumentHtml(
  value: string,
  rawTextBodyRanges = scanRawTextTags(value).bodyRanges,
): boolean {
  return [
    ...value.matchAll(/<!doctype\s+html\b/gi),
    ...value.matchAll(/<html\b/gi),
  ].some(
    (match) =>
      match.index !== undefined &&
      matchStartsMarkupToken(value, match.index, rawTextBodyRanges),
  );
}

function stripBoundaryNoise(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/<!--(?:[\s\S]*?)-->/g, "")
    .trim();
}

function tagCount(
  value: string,
  tag: "html" | "head" | "body",
  ranges: RawTextScan["bodyRanges"],
) {
  return {
    open: countMatchesOutsideRanges(
      value,
      new RegExp(`<${tag}\\b[^>]*>`, "gi"),
      ranges,
      true,
    ),
    close: countMatchesOutsideRanges(
      value,
      new RegExp(`<\\s*\\/\\s*${tag}\\s*>`, "gi"),
      ranges,
      true,
    ),
  };
}

function scanRawTextTags(value: string): RawTextScan {
  // HTML raw-text bodies may legitimately contain strings such as
  // `<style>...</style>` inside JavaScript. Once a real style/script opener is
  // seen, ignore every tag-like token except that element's own closer. This
  // mirrors browser tokenization closely enough to avoid rejecting code-heavy
  // Alpine documents while still detecting an orphaned closer/missing opener.
  let active: RawTextTag | null = null;
  let bodyStart = -1;
  let severity = 0;
  const bodyRanges: RawTextScan["bodyRanges"] = [];
  let cursor = 0;
  while (cursor < value.length) {
    if (active) {
      // HTML raw-text elements terminate at the first matching end-tag token,
      // even when that text happens to look like a JavaScript/CSS string.
      const closer = new RegExp(`<\\s*\\/\\s*${active}(?=[\\s/>])[^>]*>`, "gi");
      closer.lastIndex = cursor;
      const match = closer.exec(value);
      if (!match) break;
      bodyRanges.push({ start: bodyStart, end: match.index });
      active = null;
      bodyStart = -1;
      cursor = match.index + match[0].length;
      continue;
    }

    const nextOpen = value.indexOf("<", cursor);
    if (nextOpen === -1) break;
    if (value.startsWith("<!--", nextOpen)) {
      const commentEnd = value.indexOf("-->", nextOpen + 4);
      cursor = commentEnd === -1 ? value.length : commentEnd + 3;
      continue;
    }

    // Consume one complete markup token while respecting quoted attributes.
    // This is the important distinction from the former bare regex: an
    // Alpine value such as x-data="{ sample: '<style></style>' }" must not
    // open raw-text mode halfway through the surrounding start tag.
    let quote: '"' | "'" | null = null;
    let tokenEnd = nextOpen + 1;
    for (; tokenEnd < value.length; tokenEnd += 1) {
      const character = value[tokenEnd];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        tokenEnd += 1;
        break;
      }
    }
    const token = value.slice(nextOpen, tokenEnd);
    const match = token.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)\b/i);
    if (match && RAW_TEXT_TAGS.has(match[2]!.toLowerCase())) {
      const closing = match[1] === "/";
      const tag = match[2]!.toLowerCase() as RawTextTag;
      if (closing) severity += 1;
      else {
        active = tag;
        bodyStart = tokenEnd;
      }
    }
    cursor = Math.max(tokenEnd, nextOpen + 1);
  }
  if (active) bodyRanges.push({ start: bodyStart, end: value.length });
  return { severity: severity + (active ? 1 : 0), bodyRanges };
}

// ---------------------------------------------------------------------------
// Structural pass. Counting tokens is blind to order, so an unclosed <div> or
// a stray </section> leaves every root count above intact — those need a stack
// walk, and they are the defects browsers recover from most invisibly.
// ---------------------------------------------------------------------------

/** Closing tag is forbidden, so these never reach the stack. */
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
 * Closing tag optional per HTML5, so omitting one is legal authoring.
 * `html`/`head`/`body` belong here because the counting pass already owns them.
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

/** Opening one of these implicitly closes the listed open sibling. */
const IMPLICIT_SIBLING_CLOSE = new Map<string, Set<string>>([
  ["li", new Set(["li"])],
  ["p", new Set(["p"])],
  ["td", new Set(["td", "th"])],
  ["th", new Set(["td", "th"])],
  ["tr", new Set(["tr", "td", "th"])],
  ["dt", new Set(["dt", "dd"])],
  ["dd", new Set(["dt", "dd"])],
  ["option", new Set(["option"])],
  ["optgroup", new Set(["optgroup", "option"])],
  ["tbody", new Set(["thead", "tbody", "tr", "td", "th"])],
  ["tfoot", new Set(["thead", "tbody", "tr", "td", "th"])],
]);

const MAX_EXCERPT_CHARS = 120;

/**
 * Deliberately conservative: a miss costs one unreported advisory, a false hit
 * costs trust in every advisory after it.
 */
const USES_TAILWIND_UTILITIES =
  /\bclass\s*=\s*["'][^"']*(?:\b(?:flex|grid|hidden|absolute|relative|sticky)\b|\b(?:p|m|px|py|mx|my|pt|pb|pl|pr|gap|w|h|text|bg|border|rounded|shadow|items|justify|font|leading|tracking|space-x|space-y|min-h|max-w|opacity|ring|z)-[a-z0-9[\]./-]+)/i;

type Locator = (index: number) => {
  line: number;
  column: number;
  excerpt: string;
};

/**
 * Scanning to the offset per call made validation quadratic on VALID documents,
 * not just malformed ones — a 117KB screen cost ~700ms on every save. Index the
 * line starts once, lazily, and binary search.
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

interface TagScan {
  end: number;
  /** False when EOF arrived before the tag's `>`. */
  terminated: boolean;
  /** Whether EOF arrived inside a quoted value — the truncation cause. */
  quoteOpen: boolean;
  /** The attribute that quote belonged to, when one was named. */
  unterminatedAttribute?: string;
}

/**
 * A raw-text end tag only closes the element when the name is followed by
 * whitespace, `/`, or `>`. Matching on a word boundary instead treats script
 * text like `"</script=template>"` as the closer, which orphans the real one.
 */
function rawTextCloser(tag: string): RegExp {
  return new RegExp(`<\\s*/\\s*${tag}(?=[\\s/>])`, "gi");
}

/** Consume one markup token starting at `start` (the `<`), honoring quotes. */
function scanTag(value: string, start: number): TagScan {
  let quote: '"' | "'" | null = null;
  let pendingAttribute: string | undefined;
  let quotedAttribute: string | undefined;
  let word = "";
  for (let cursor = start; cursor < value.length; cursor += 1) {
    const character = value[cursor]!;
    if (quote) {
      if (character === quote) {
        quote = null;
        quotedAttribute = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      quotedAttribute = pendingAttribute;
      continue;
    }
    if (character === ">") {
      return { end: cursor + 1, terminated: true, quoteOpen: false };
    }
    if (character === "=") {
      if (word) pendingAttribute = word;
      word = "";
      continue;
    }
    if (character === "<" || character === "/" || /\s/.test(character)) {
      word = "";
      continue;
    }
    word += character;
  }
  return {
    end: value.length,
    terminated: false,
    quoteOpen: quote !== null,
    unterminatedAttribute: quotedAttribute,
  };
}

/**
 * One parse for both facts. Deriving `isClose` separately let `< /div>` be read
 * as a close tag by one check and an open tag by the other.
 */
function tagAt(
  value: string,
  index: number,
): { tag: string; isClose: boolean } | null {
  const match = /^<(\s*\/)?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(
    value.slice(index, index + 64),
  );
  return match
    ? { tag: match[2]!.toLowerCase(), isClose: match[1] !== undefined }
    : null;
}

/**
 * Runs on fragments as well as documents — an unterminated quote is as
 * destructive in a `<template>` snippet as in a full page.
 */
function collectStructuralIssues(
  value: string,
): DesignHtmlIntegrityIssueDetail[] {
  const issues: DesignHtmlIntegrityIssueDetail[] = [];
  const stack: Array<{ tag: string; start: number }> = [];
  const locate = createLocator(value);
  let cursor = 0;

  while (cursor < value.length) {
    const open = value.indexOf("<", cursor);
    if (open === -1) break;

    if (value.startsWith("<!--", open)) {
      const commentEnd = value.indexOf("-->", open + 4);
      if (commentEnd === -1) {
        issues.push({ issue: "content-truncated", ...locate(open) });
        return issues;
      }
      cursor = commentEnd + 3;
      continue;
    }

    if (value.startsWith("<!", open)) {
      cursor = Math.max(scanTag(value, open).end, open + 1);
      continue;
    }

    const parsed = tagAt(value, open);
    if (!parsed) {
      // A bare `<` in text content. Not markup, not a defect.
      cursor = open + 1;
      continue;
    }
    const { tag, isClose } = parsed;

    const scan = scanTag(value, open);
    if (!scan.terminated) {
      // Anything after an unclosed tag would be invented structure. Stop here.
      const located = locate(open);
      issues.push(
        scan.quoteOpen
          ? {
              issue: "attribute-unterminated",
              ...located,
              tag,
              attribute: scan.unterminatedAttribute,
            }
          : { issue: "content-truncated", ...located, tag },
      );
      return issues;
    }

    if (isClose) {
      let matched = -1;
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index]!.tag === tag) {
          matched = index;
          break;
        }
      }
      if (matched === -1) {
        if (!OPTIONAL_CLOSE_TAGS.has(tag) && !VOID_TAGS.has(tag)) {
          issues.push({ issue: "close-tag-orphaned", ...locate(open), tag });
        }
      } else {
        // Located lazily: computing this for every balanced close tag is what
        // made a valid document quadratic.
        let closeLine: number | null = null;
        for (let index = stack.length - 1; index > matched; index -= 1) {
          const abandoned = stack[index]!;
          if (OPTIONAL_CLOSE_TAGS.has(abandoned.tag)) continue;
          closeLine ??= locate(open).line;
          issues.push({
            issue: "element-unclosed",
            ...locate(abandoned.start),
            tag: abandoned.tag,
            closedBy: { tag, line: closeLine },
          });
        }
        stack.length = matched;
      }
      cursor = scan.end;
      continue;
    }

    const selfClosing = /\/\s*>$/.test(value.slice(open, scan.end));

    if (RAW_TEXT_TAGS.has(tag) && !selfClosing) {
      // Resume AT the closing tag so the close branch pops this element,
      // rather than duplicating that logic here. An unterminated body is left
      // to the raw-text-balance check, which names that cause correctly.
      const closer = rawTextCloser(tag);
      closer.lastIndex = scan.end;
      const found = closer.exec(value);
      if (!found) {
        // Report here rather than deferring to the document-only raw-text
        // balance check: fragments never reach that check, so an unclosed
        // <script> would pass the well-formedness gate entirely.
        issues.push({
          issue: "raw-text-balance",
          ...locate(open),
          tag,
        });
        return issues;
      }
      stack.push({ tag, start: open });
      cursor = found.index;
      continue;
    }

    if (VOID_TAGS.has(tag) || selfClosing) {
      cursor = scan.end;
      continue;
    }

    // An implied close discards the target AND everything opened inside it —
    // the browser closes those too, so popping only the stack top reports a
    // still-open inline descendant (`<li><span>one<li>`) as unclosed.
    const impliedClose = IMPLICIT_SIBLING_CLOSE.get(tag);
    if (impliedClose) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (!impliedClose.has(stack[index]!.tag)) continue;
        stack.length = index;
        break;
      }
    }
    stack.push({ tag, start: open });
    cursor = scan.end;
  }

  // Stack order is document order, so stopping at the cap keeps the earliest
  // (outermost) unclosed elements without locating every one of them.
  for (const abandoned of stack) {
    if (issues.length >= MAX_REPORTED_ISSUES) break;
    if (OPTIONAL_CLOSE_TAGS.has(abandoned.tag)) continue;
    issues.push({
      issue: "element-unclosed",
      ...locate(abandoned.start),
      tag: abandoned.tag,
    });
  }

  return issues
    .sort((left, right) =>
      left.line === right.line
        ? left.column - right.column
        : left.line - right.line,
    )
    .slice(0, MAX_REPORTED_ISSUES);
}

/**
 * Reported, never enforced: legitimate fragments and token-only screens carry no
 * runtime of their own, so blocking here would reject valid work.
 */
function collectAdvisoryIssues(
  value: string,
  rawTextBodyRanges: RawTextScan["bodyRanges"],
): DesignHtmlIntegrityIssueDetail[] {
  if (!isDocumentHtml(value, rawTextBodyRanges)) return [];
  // Only documents that actually depend on utility classes can be broken by a
  // missing runtime. A screen styled entirely through its own CSS needs no
  // Tailwind, and flagging it would train authors to ignore this warning.
  if (!USES_TAILWIND_UTILITIES.test(value)) return [];
  // Comments are not markup: a commented-out runtime tag is not a runtime.
  const value_ = value.replace(/<!--[\s\S]*?-->/g, "");
  const hasTailwindRuntime =
    /<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*tailwind[^"]*"|'[^']*tailwind[^']*')/i.test(
      value_,
    ) ||
    /<style\b[^>]*\btype\s*=\s*(?:"text\/tailwindcss"|'text\/tailwindcss')/i.test(
      value_,
    ) ||
    /<link\b[^>]*\bhref\s*=\s*(?:"[^"]*tailwind[^"]*"|'[^']*tailwind[^']*')/i.test(
      value_,
    );
  if (hasTailwindRuntime) return [];
  const headIndex = value.search(/<head\b/i);
  return [
    {
      issue: "runtime-missing",
      ...createLocator(value)(headIndex === -1 ? 0 : headIndex),
    },
  ];
}

function markerCounts(
  value: string,
  marker: string,
  tag: "style" | "script",
  ranges: RawTextScan["bodyRanges"],
): { raw: number; attached: number } {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    raw: countMatchesOutsideRanges(
      value,
      new RegExp(`\\b${escapedMarker}\\b`, "gi"),
      ranges,
    ),
    attached: countMatchesOutsideRanges(
      value,
      new RegExp(`<${tag}\\b[^>]*\\b${escapedMarker}\\b[^>]*>`, "gi"),
      ranges,
      true,
    ),
  };
}

/**
 * Validate one complete Design HTML document without parsing/serializing it.
 * DOMParser is intentionally not used: it repairs exactly the missing
 * `<style>`/root boundaries this guard must detect. Alpine fragments and
 * `<template>` snippets are not documents and are handled by the transition
 * function below instead of being rejected here.
 */
export function inspectDesignHtmlDocumentIntegrity(
  value: string,
): DesignHtmlIntegrityResult {
  const rawText = scanRawTextTags(value);

  // Structure first, counting second. An unterminated quote swallows the root
  // tags, so the counting pass would report `document-root` — sending the fix to
  // a `<html>` tag that is present and correct instead of to the quote.
  const structural = collectStructuralIssues(value);
  if (structural.length > 0) {
    return {
      valid: false,
      issue: structural[0]!.issue,
      detail: structural,
    };
  }

  if (!isDocumentHtml(value, rawText.bodyRanges)) return { valid: true };

  // Before the root counts: an unbalanced raw-text element swallows the tags
  // those counts look for, so checking order decides whether the report names
  // the cause or its effect.
  if (rawText.severity > 0) {
    return { valid: false, issue: "raw-text-balance" };
  }

  const html = tagCount(value, "html", rawText.bodyRanges);
  if (html.open !== 1 || html.close !== 1) {
    return { valid: false, issue: "document-root" };
  }
  const body = tagCount(value, "body", rawText.bodyRanges);
  if (body.open !== 1 || body.close !== 1) {
    return { valid: false, issue: "document-body" };
  }
  const head = tagCount(value, "head", rawText.bodyRanges);
  if (head.open !== head.close || head.open > 1) {
    return { valid: false, issue: "document-head" };
  }

  const htmlOpen = firstMatchOutsideRanges(
    value,
    /<html\b[^>]*>/gi,
    rawText.bodyRanges,
  );
  const htmlClose = firstMatchOutsideRanges(
    value,
    /<\s*\/\s*html\s*>/gi,
    rawText.bodyRanges,
  );
  const bodyOpen = firstMatchOutsideRanges(
    value,
    /<body\b[^>]*>/gi,
    rawText.bodyRanges,
  );
  const bodyClose = firstMatchOutsideRanges(
    value,
    /<\s*\/\s*body\s*>/gi,
    rawText.bodyRanges,
  );
  if (!htmlOpen || !htmlClose || !bodyOpen || !bodyClose) {
    return { valid: false, issue: "document-root" };
  }
  if (
    htmlOpen.index >= bodyOpen.index ||
    bodyOpen.index >= bodyClose.index ||
    bodyClose.index >= htmlClose.index
  ) {
    return { valid: false, issue: "document-boundary" };
  }

  const prefix = stripBoundaryNoise(value.slice(0, htmlOpen.index)).replace(
    /<!doctype\s+html\b[^>]*>/i,
    "",
  );
  const suffix = stripBoundaryNoise(
    value.slice(htmlClose.index + htmlClose.text.length),
  );
  if (prefix.trim() || suffix.trim()) {
    return { valid: false, issue: "document-boundary" };
  }

  for (const { marker, tag } of MANAGED_RAW_TEXT_MARKERS) {
    const counts = markerCounts(value, marker, tag, rawText.bodyRanges);
    if (counts.raw !== counts.attached) {
      return { valid: false, issue: "managed-marker-orphaned" };
    }
    if (counts.attached > 1) {
      return { valid: false, issue: "managed-marker-duplicated" };
    }
  }

  const advisory = collectAdvisoryIssues(value, rawText.bodyRanges);
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
