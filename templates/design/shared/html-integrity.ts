/**
 * Stable error code shared by browser and server write paths. Keep this value
 * transport-safe: action errors may preserve either `code` or only `message`.
 */
export const DESIGN_HTML_INTEGRITY_ERROR_CODE = "DESIGN_HTML_INTEGRITY";

export type DesignHtmlIntegrityIssue =
  | "document-boundary"
  | "document-root"
  | "document-body"
  | "document-head"
  | "raw-text-balance"
  | "managed-marker-orphaned"
  | "managed-marker-duplicated";

export interface DesignHtmlIntegrityResult {
  valid: boolean;
  issue?: DesignHtmlIntegrityIssue;
}

export class DesignHtmlIntegrityError extends Error {
  readonly code = DESIGN_HTML_INTEGRITY_ERROR_CODE;
  readonly status = 422;
  readonly issue: DesignHtmlIntegrityIssue;

  constructor(issue: DesignHtmlIntegrityIssue) {
    super(
      `${DESIGN_HTML_INTEGRITY_ERROR_CODE}: The edit was not applied because it would make the design HTML invalid.`,
    );
    this.name = "DesignHtmlIntegrityError";
    this.issue = issue;
  }
}

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
): number {
  return Array.from(value.matchAll(pattern)).filter(
    (match) =>
      match.index !== undefined && !matchFallsInsideRanges(match.index, ranges),
  ).length;
}

function firstMatchOutsideRanges(
  value: string,
  pattern: RegExp,
  ranges: RawTextScan["bodyRanges"],
): { index: number; text: string } | null {
  const match = Array.from(value.matchAll(pattern)).find(
    (candidate) =>
      candidate.index !== undefined &&
      !matchFallsInsideRanges(candidate.index, ranges),
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
    ),
    close: countMatchesOutsideRanges(
      value,
      new RegExp(`<\\s*\\/\\s*${tag}\\s*>`, "gi"),
      ranges,
    ),
  };
}

function scanRawTextTags(value: string): RawTextScan {
  // HTML raw-text bodies may legitimately contain strings such as
  // `<style>...</style>` inside JavaScript. Once a real style/script opener is
  // seen, ignore every tag-like token except that element's own closer. This
  // mirrors browser tokenization closely enough to avoid rejecting code-heavy
  // Alpine documents while still detecting an orphaned closer/missing opener.
  const token = /<\s*(\/?)\s*(style|script)\b[^>]*>/gi;
  let active: "style" | "script" | null = null;
  let bodyStart = 0;
  let severity = 0;
  const bodyRanges: RawTextScan["bodyRanges"] = [];
  for (const match of value.matchAll(token)) {
    if (match.index === undefined) continue;
    const closing = match[1] === "/";
    const tag = match[2]!.toLowerCase() as "style" | "script";
    if (active) {
      if (closing && tag === active) {
        bodyRanges.push({ start: bodyStart, end: match.index });
        active = null;
      }
      continue;
    }
    if (closing) severity += 1;
    else {
      active = tag;
      bodyStart = match.index + match[0].length;
    }
  }
  if (active) bodyRanges.push({ start: bodyStart, end: value.length });
  return { severity: severity + (active ? 1 : 0), bodyRanges };
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
  if (!isDocumentHtml(value, rawText.bodyRanges)) return { valid: true };

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

  if (rawText.severity > 0) {
    return { valid: false, issue: "raw-text-balance" };
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

  return { valid: true };
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
}): void {
  if (args.fileType.toLowerCase() !== "html") return;
  const previousIsDocument = isDocumentHtml(args.previousContent);
  const nextIsDocument = isDocumentHtml(args.nextContent);
  if (!previousIsDocument && !nextIsDocument) return;
  if (previousIsDocument && !nextIsDocument) {
    throw new DesignHtmlIntegrityError("document-root");
  }
  const result = inspectDesignHtmlDocumentIntegrity(args.nextContent);
  if (!result.valid) {
    throw new DesignHtmlIntegrityError(result.issue ?? "document-root");
  }
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
