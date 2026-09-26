import { decodeHTML } from "entities";
import { parseFragment } from "parse5";


export const CAPTURE_DATA_MAX_BYTES = 256 * 1024;

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

export function looksLikeMarkup(value: string): boolean {
  return /<[a-zA-Z!/]/.test(value) || value.includes("</");
}

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
