import { buildCodeLayerProjection } from "@shared/code-layer";
import { parseCssColor, rgbaToHex } from "@shared/color-utils";

import type { ElementInfo } from "../types";

export interface DocumentColorSourceFile {
  id: string;
  content: string;
}

// Matches hex (#rgb/#rgba/#rrggbb/#rrggbbaa), legacy comma-separated RGB and
// HSL function color literals in CSS declaration values. Modern
// space-separated `rgb(R G B [/ A])` and DOM-resolved formats (oklch,
// color(display-p3 ...)) are intentionally out of scope: `parseCssColor` (the
// non-DOM parser, safe to run in a plain Node/vitest environment) doesn't
// resolve them, and pulling in the canvas-based `parseCssColorExtended`
// resolver would make this helper impure/untestable without jsdom.
const CSS_COLOR_TOKEN_PATTERN =
  /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|(?:rgb|hsl)a?\([^)]*\)/gi;

interface ColorTokenSpan {
  value: string;
  start: number;
  end: number;
}

interface DeclarationValueSpan {
  value: string;
  start: number;
}

const HTML_TAG_PATTERN = /<[^>]*>/g;
const STYLE_BLOCK_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const STYLE_ATTRIBUTE_PATTERN =
  /\sstyle\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\s>]+))/gi;
const NON_RENDERED_HTML_PATTERN =
  /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<noscript\b[\s\S]*?<\/noscript\s*>/gi;

function maskNonRenderedHtml(content: string): string {
  return content.replace(NON_RENDERED_HTML_PATTERN, (match) =>
    match.replace(/[^\r\n]/g, " "),
  );
}

function cssPropertyName(property: string): string {
  return property
    .replace(/^\s*\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .toLowerCase();
}

function isColorDeclaration(property: string): boolean {
  const normalized = cssPropertyName(property);
  if (normalized.startsWith("--")) return true;
  return (
    COLOR_STYLE_PROPERTIES.has(normalized) ||
    /^border(?:-(?:top|right|bottom|left))?(?:-color)?$/.test(normalized) ||
    /^-webkit-text-stroke(?:-color)?$/.test(normalized)
  );
}

function topLevelColon(value: string): number {
  let quote: string | null = null;
  let escaped = false;
  let parentheses = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (character === ":" && parentheses === 0) return index;
  }
  return -1;
}

function declarationValueSpans(
  css: string,
  offset = 0,
): DeclarationValueSpan[] {
  const declarations: DeclarationValueSpan[] = [];
  let segmentStart = 0;
  let quote: string | null = null;
  let escaped = false;
  let parentheses = 0;

  const addSegment = (segmentEnd: number) => {
    const segment = css.slice(segmentStart, segmentEnd);
    const colon = topLevelColon(segment);
    if (colon < 0 || !isColorDeclaration(segment.slice(0, colon))) return;
    const rawValueStart = segmentStart + colon + 1;
    const value = css.slice(rawValueStart, segmentEnd);
    const leadingWhitespace = value.search(/\S|$/);
    const trimmed = value.trim();
    if (!trimmed) return;
    declarations.push({
      value: trimmed,
      start: offset + rawValueStart + leadingWhitespace,
    });
  };

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (parentheses > 0) continue;
    if (character === ";" || character === "{" || character === "}") {
      addSegment(index);
      segmentStart = index + 1;
    }
  }
  addSegment(css.length);
  return declarations;
}

function isInsideUrl(value: string, index: number): boolean {
  const before = value.slice(0, index).toLowerCase();
  return before.lastIndexOf("url(") > before.lastIndexOf(")");
}

function colorTokenSpansInCss(css: string, offset = 0): ColorTokenSpan[] {
  const tokens: ColorTokenSpan[] = [];
  declarationValueSpans(css, offset).forEach(({ value, start }) => {
    const matcher = new RegExp(CSS_COLOR_TOKEN_PATTERN.source, "gi");
    for (const match of value.matchAll(matcher)) {
      const token = match[0];
      const relativeStart = match.index ?? 0;
      if (isInsideUrl(value, relativeStart)) continue;
      tokens.push({
        value: token,
        start: start + relativeStart,
        end: start + relativeStart + token.length,
      });
    }
  });
  return tokens;
}

function colorTokenSpansInHtml(content: string): ColorTokenSpan[] {
  const maskedContent = maskNonRenderedHtml(content);
  const tokens: ColorTokenSpan[] = [];

  for (const match of maskedContent.matchAll(HTML_TAG_PATTERN)) {
    const tag = match[0];
    if (/^<\/?(?:script|noscript|style)\b/i.test(tag)) continue;
    const tagOffset = match.index ?? 0;
    for (const attribute of tag.matchAll(STYLE_ATTRIBUTE_PATTERN)) {
      const value = attribute[1] ?? attribute[2] ?? attribute[3] ?? "";
      const valueOffset =
        tagOffset + (attribute.index ?? 0) + attribute[0].indexOf(value);
      tokens.push(...colorTokenSpansInCss(value, valueOffset));
    }
  }

  for (const match of maskedContent.matchAll(STYLE_BLOCK_PATTERN)) {
    const css = match[1] ?? "";
    const cssOffset = (match.index ?? 0) + match[0].indexOf(css);
    tokens.push(...colorTokenSpansInCss(css, cssOffset));
  }

  return tokens.sort((left, right) => left.start - right.start);
}

/**
 * Extracts a document-wide color palette from raw file contents: every
 * distinct color literal (hex/rgb/hsl) found in CSS declarations in the
 * given files, normalized to uppercase hex, deduped, and ordered by
 * descending frequency (most-used colors first) so the most relevant swatches
 * lead the grid. Capped at `limit` entries — real designs can reference many
 * more distinct color strings than are useful to show as quick-pick swatches.
 *
 * Pure and DOM-free so it can run against any file content (server-rendered,
 * cached, or live) and is unit-testable without jsdom.
 */
export function extractDocumentColorPalette(
  files: DocumentColorSourceFile[],
  limit = 24,
): string[] {
  const countByHex = new Map<string, number>();
  for (const file of files) {
    if (!file.content) continue;
    for (const { value: token } of colorTokenSpansInHtml(file.content)) {
      const parsed = parseCssColor(token);
      if (!parsed) continue;
      // Skip fully transparent tokens — not a meaningful "document color"
      // swatch (matches selectionColorValues' same filter below).
      if (parsed.a === 0) continue;
      const hex = rgbaToHex(parsed).toUpperCase();
      countByHex.set(hex, (countByHex.get(hex) ?? 0) + 1);
    }
  }
  return Array.from(countByHex.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hex]) => hex);
}

export interface SelectionColorValue {
  property: string;
  value: string;
  count?: number;
}

export interface SelectionColorScope {
  fileId: string;
  content: string;
  sourceId?: string;
  selector?: string;
  wholeDocument?: boolean;
}

export interface SelectionColorRange {
  start: number;
  end: number;
}

const COLOR_STYLE_PROPERTIES = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-color",
  "outline",
  "outline-color",
  "fill",
  "stroke",
  "box-shadow",
  "text-shadow",
  "text-decoration-color",
  "-webkit-text-stroke-color",
  "accent-color",
  "caret-color",
  "column-rule",
  "column-rule-color",
  "filter",
  "flood-color",
  "lighting-color",
  "stop-color",
]);

function cssColorTokens(value: string): string[] {
  return value.match(CSS_COLOR_TOKEN_PATTERN) ?? [];
}

function colorKey(value: string): string {
  const parsed = parseCssColor(value);
  return parsed
    ? rgbaToHex(parsed, true).toUpperCase()
    : value.trim().toLowerCase();
}

function isVisibleColor(value: string): boolean {
  const parsed = parseCssColor(value);
  return !parsed || parsed.a > 0;
}

function addColorValue(
  values: Map<string, SelectionColorValue>,
  property: string,
  value: string,
  increment = true,
) {
  const trimmed = value.trim();
  if (!trimmed || !isVisibleColor(trimmed)) return;
  const key = colorKey(trimmed);
  const existing = values.get(key);
  if (existing) {
    if (increment) existing.count = (existing.count ?? 1) + 1;
    return;
  }
  values.set(key, {
    property,
    value: trimmed,
  });
}

function addStyleColors(
  values: Map<string, SelectionColorValue>,
  styles: Record<string, string>,
  increment: boolean,
) {
  Object.entries(styles).forEach(([property, value]) => {
    if (!isColorDeclaration(property)) {
      return;
    }
    const tokens = cssColorTokens(value);
    if (tokens.length > 0) {
      tokens.forEach((token) =>
        addColorValue(values, property, token, increment),
      );
      return;
    }
    if (value.trim() === "Mixed") {
      addColorValue(values, property, value, increment);
    }
  });
}

function scopeNodeRange(
  scope: SelectionColorScope,
): SelectionColorRange | null {
  if (scope.wholeDocument) {
    return { start: 0, end: scope.content.length };
  }
  const projection = buildCodeLayerProjection(scope.content);
  const node = projection.nodes.find((candidate) => {
    const stableIds = [
      candidate.id,
      candidate.dataAttributes["data-agent-native-node-id"],
      candidate.dataAttributes["data-code-layer-id"],
      candidate.dataAttributes["data-layer-id"],
      candidate.dataAttributes["data-builder-id"],
      candidate.dataAttributes["data-loc"],
      typeof candidate.attributes.id === "string"
        ? candidate.attributes.id
        : undefined,
    ];
    if (scope.sourceId && stableIds.includes(scope.sourceId)) return true;
    if (!scope.selector) return false;
    return [candidate.selector, candidate.path, ...candidate.selectors].some(
      (selector) => selector === scope.selector,
    );
  });
  const source = node?.source;
  return source ? { start: source.start, end: source.end } : null;
}

function mergedScopeRanges(
  scopes: SelectionColorScope[],
): SelectionColorRange[] {
  const ranges = scopes
    .map(scopeNodeRange)
    .filter((range): range is SelectionColorRange => Boolean(range))
    .sort((left, right) => left.start - right.start);
  const merged: SelectionColorRange[] = [];
  ranges.forEach((range) => {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  });
  return merged;
}

export function selectionColorScopeRanges(
  scopes: SelectionColorScope[],
): Map<string, SelectionColorRange[]> {
  const byFile = new Map<string, SelectionColorScope[]>();
  scopes.forEach((scope) => {
    byFile.set(scope.fileId, [...(byFile.get(scope.fileId) ?? []), scope]);
  });
  return new Map(
    Array.from(byFile, ([fileId, fileScopes]) => [
      fileId,
      mergedScopeRanges(fileScopes),
    ]),
  );
}

export function replaceSelectionColorsInHtml(
  content: string,
  scopes: SelectionColorScope[],
  from: string,
  to: string,
): string {
  const target = colorKey(from);
  const ranges = mergedScopeRanges(scopes);
  if (ranges.length === 0) return content;
  let next = content;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    if (!range) continue;
    let segment = content.slice(range.start, range.end);
    const tokens = colorTokenSpansInHtml(segment);
    for (let tokenIndex = tokens.length - 1; tokenIndex >= 0; tokenIndex -= 1) {
      const token = tokens[tokenIndex];
      if (!token || colorKey(token.value) !== target) continue;
      segment = `${segment.slice(0, token.start)}${to}${segment.slice(token.end)}`;
    }
    next = `${next.slice(0, range.start)}${segment}${next.slice(range.end)}`;
  }
  return next;
}

export function selectionColorValues(
  element: ElementInfo | ElementInfo[],
  scopes: SelectionColorScope[] = [],
): SelectionColorValue[] {
  const elements = Array.isArray(element) ? element : [element];
  const values = new Map<string, SelectionColorValue>();
  const rangesByFile = selectionColorScopeRanges(scopes);

  // Source ranges are the authoritative selection-wide scan. They include
  // every literal in descendants, including nodes beyond the bridge's compact
  // runtime payload. Computed values fill in colors supplied by shared CSS.
  for (const [fileId, ranges] of rangesByFile) {
    const scope = scopes.find((candidate) => candidate.fileId === fileId);
    if (!scope) continue;
    for (const range of ranges) {
      const content = scope.content.slice(range.start, range.end);
      colorTokenSpansInHtml(content).forEach(({ value: token }) =>
        addColorValue(values, "color", token),
      );
    }
  }

  for (const current of elements) {
    if (scopes.length === 0) {
      addStyleColors(values, current.computedStyles, true);
      current.portableStyleSnapshot?.nodes.forEach((node) =>
        addStyleColors(values, node.styles, true),
      );
      if (current.htmlContent) {
        colorTokenSpansInHtml(current.htmlContent).forEach(({ value: token }) =>
          addColorValue(values, "color", token),
        );
      }
    }
  }

  return Array.from(values.values());
}

/** Uppercase 6-char hex (no #) for a CSS color, matching the design editor's row readout. */
export function selectionDisplayHex(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value.replace(/^#/, "").toUpperCase();
  return rgbaToHex(parsed).replace(/^#/, "").toUpperCase();
}
