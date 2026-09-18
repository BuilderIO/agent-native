import { decodeHTML } from "entities";
import { parseFragment } from "parse5";

/**
 * Shared sanitization helpers for design state capture payloads.
 *
 * Used by both create-design-state and capture-design-state to enforce a
 * consistent stored-XSS guard and size cap before persisting arbitrary
 * caller-supplied markup / DOM snapshots into `design_state` rows.
 */

/**
 * Maximum serialised size of a captured/replayed `captureData` or
 * `fixtureData` payload. Caps single-row size to protect the DB and the
 * shareable content each row feeds.
 */
export const CAPTURE_DATA_MAX_BYTES = 256 * 1024; // 256 KB

const URL_ATTRIBUTE_NAMES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
const HTML_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

type SourceRange = { start: number; end: number };
type SourceLocation = { startOffset: number; endOffset: number };

function attributeRangeStart(html: string, offset: number): number {
  let start = offset;
  while (start > 0 && /\s/.test(html[start - 1] ?? "")) start -= 1;
  return start;
}

function isSafeUrlAttribute(name: string, value: string): boolean {
  const decoded = decodeHTML(value);
  const candidates =
    name === "srcset"
      ? decoded
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? "")
      : [decoded.trim()];

  return candidates.every((candidate) => {
    if (!candidate) return true;
    const compact = candidate.replace(/[\u0000-\u0020]+/g, "");
    if (!HTML_SCHEME.test(compact)) return true;
    const scheme = HTML_SCHEME.exec(compact)?.[0].toLowerCase();
    return scheme ? SAFE_URL_SCHEMES.has(scheme) : false;
  });
}

function unsafeUrlAttributeRanges(html: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let unlocatableUnsafeAttribute = false;
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });

  const visit = (node: unknown) => {
    const element = node as {
      attrs?: Array<{ name: string; value: string }>;
      childNodes?: unknown[];
      content?: { childNodes?: unknown[] };
      sourceCodeLocation?: {
        attrs?: Record<string, SourceLocation>;
        startTag?: SourceLocation;
        startOffset?: number;
        endOffset?: number;
      };
    };
    if (element.attrs && element.sourceCodeLocation) {
      for (const attribute of element.attrs) {
        const name = attribute.name.toLowerCase();
        if (
          !URL_ATTRIBUTE_NAMES.has(name) ||
          isSafeUrlAttribute(name, attribute.value)
        ) {
          continue;
        }
        const location = element.sourceCodeLocation.attrs?.[name];
        if (location) {
          ranges.push({
            start: attributeRangeStart(html, location.startOffset),
            end: location.endOffset,
          });
        } else if (element.sourceCodeLocation.startTag) {
          ranges.push({
            start: element.sourceCodeLocation.startTag.startOffset,
            end: element.sourceCodeLocation.startTag.endOffset,
          });
        } else if (
          element.sourceCodeLocation.startOffset !== undefined &&
          element.sourceCodeLocation.endOffset !== undefined
        ) {
          ranges.push({
            start: element.sourceCodeLocation.startOffset,
            end: element.sourceCodeLocation.endOffset,
          });
        } else {
          unlocatableUnsafeAttribute = true;
        }
      }
    }
    for (const child of [
      ...(element.childNodes ?? []),
      ...(element.content?.childNodes ?? []),
    ]) {
      visit(child);
    }
  };
  visit(fragment);
  if (unlocatableUnsafeAttribute) {
    throw new Error("Could not safely locate an unsafe URL attribute.");
  }
  return ranges;
}

function stripSourceRanges(html: string, ranges: SourceRange[]): string {
  const merged = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start)
    .reduce<SourceRange[]>((result, range) => {
      const previous = result[result.length - 1];
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        result.push({ ...range });
      }
      return result;
    }, []);

  return merged
    .reverse()
    .reduce(
      (result, range) => result.slice(0, range.start) + result.slice(range.end),
      html,
    );
}

/**
 * Strip stored-XSS vectors out of an HTML/markup string before it is persisted
 * and later replayed into shareable design content. Mirrors the framework's
 * text-edit HTML sanitiser: removes script/style/iframe/object/embed/link/meta/
 * base tags, inline `on*` handlers, and URL attributes whose decoded schemes
 * are not on the small http(s)/mailto/tel allow-list.
 */
export function sanitizeMarkup(html: string): string {
  const withoutUnsafeUrlAttributes = stripSourceRanges(
    html,
    unsafeUrlAttributeRanges(html),
  );
  return withoutUnsafeUrlAttributes
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|base)\b[^>]*\/?\s*>/gi,
      "",
    )
    .replace(/\s+on[A-Za-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, "")
    .replace(
      /\s+(href|src|xlink:href)\s*=\s*(?:(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2|(?:javascript|vbscript|data):[^\s>]*)/gi,
      "",
    );
}

/**
 * A string "looks like markup" — and is therefore worth sanitising — when it
 * contains an angle-bracket tag opener or an Alpine `x-`/`@`/`:` binding that
 * could carry script. Plain data strings (route names, ids) are left untouched.
 */
export function looksLikeMarkup(value: string): boolean {
  return /<[a-zA-Z!/]/.test(value) || value.includes("</");
}

/**
 * Recursively sanitise every string value inside a captured/replayed
 * `captureData` or `fixtureData` object (e.g. `domHtml`, `domSnapshot`,
 * `x-data` markup) so no untrusted DOM is persisted raw. Non-string leaves
 * pass through unchanged.
 */
export function sanitizeCaptureData(value: unknown): unknown {
  if (typeof value === "string") {
    return looksLikeMarkup(value) ? sanitizeMarkup(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCaptureData(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeCaptureData(v);
    }
    return out;
  }
  return value;
}
