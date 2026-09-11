import { buildCodeLayerProjection } from "@shared/code-layer";
import { parseCssColor, rgbaToHex } from "@shared/color-utils";

import type { ElementInfo } from "../types";

export interface DocumentColorSourceFile {
  id: string;
  content: string;
}

// Matches hex (#rgb/#rgba/#rrggbb/#rrggbbaa), legacy comma rgb()/rgba(), and
// hsl()/hsla() color literals appearing anywhere in raw HTML/CSS text (inline
// `style="..."` attributes and `<style>` blocks alike — both are plain
// substrings of `content`, so a single text scan covers both). Modern
// space-separated `rgb(R G B [/ A])` and DOM-resolved formats (oklch,
// color(display-p3 ...)) are intentionally out of scope: `parseCssColor` (the
// non-DOM parser, safe to run in a plain Node/vitest environment) doesn't
// resolve them, and pulling in the canvas-based `parseCssColorExtended`
// resolver would make this helper impure/untestable without jsdom.
const CSS_COLOR_TOKEN_PATTERN =
  /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|(?:rgb|hsl)a?\([^)]*\)/gi;

/**
 * Extracts a document-wide color palette from raw file contents: every
 * distinct color literal (hex/rgb/hsl) found anywhere in the given files'
 * HTML/CSS text, normalized to uppercase hex, deduped, and ordered by
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
    const matches = file.content.match(CSS_COLOR_TOKEN_PATTERN);
    if (!matches) continue;
    for (const token of matches) {
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
  "backgroundColor",
  "backgroundImage",
  "background-image",
  "border",
  "border-color",
  "borderColor",
  "outline",
  "outline-color",
  "outlineColor",
  "fill",
  "stroke",
  "box-shadow",
  "boxShadow",
  "text-shadow",
  "textShadow",
  "text-decoration-color",
  "textDecorationColor",
  "-webkit-text-stroke-color",
  "webkitTextStrokeColor",
]);

function cssColorTokens(value: string): string[] {
  const matches = value.match(CSS_COLOR_TOKEN_PATTERN) ?? [];
  if (matches.length > 0) return matches;
  return parseCssColor(value) ? [value] : [];
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
    if (!COLOR_STYLE_PROPERTIES.has(property) && !value.includes("(")) {
      return;
    }
    const tokens = cssColorTokens(value);
    if (tokens.length > 0) {
      tokens.forEach((token) =>
        addColorValue(values, property, token, increment),
      );
      return;
    }
    if (
      [
        "color",
        "backgroundColor",
        "background-color",
        "borderColor",
        "border-color",
        "outlineColor",
        "outline-color",
      ].includes(property)
    ) {
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
    const segment = content
      .slice(range.start, range.end)
      .replace(CSS_COLOR_TOKEN_PATTERN, (token) =>
        colorKey(token) === target ? to : token,
      );
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
      cssColorTokens(content).forEach((token) =>
        addColorValue(values, "color", token),
      );
    }
  }

  for (const current of elements) {
    addStyleColors(values, current.computedStyles, scopes.length === 0);
    current.portableStyleSnapshot?.nodes.forEach((node) =>
      addStyleColors(values, node.styles, scopes.length === 0),
    );
    if (scopes.length === 0 && current.htmlContent) {
      cssColorTokens(current.htmlContent).forEach((token) =>
        addColorValue(values, "color", token),
      );
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
