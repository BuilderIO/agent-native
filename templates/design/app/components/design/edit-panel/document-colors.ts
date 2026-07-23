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
}

export function selectionColorValues(
  element: ElementInfo,
): SelectionColorValue[] {
  const styles = element.computedStyles;
  const rawValues: SelectionColorValue[] = [
    { property: "color", value: styles.color },
    { property: "backgroundColor", value: styles.backgroundColor },
    { property: "borderColor", value: styles.borderColor },
    { property: "outlineColor", value: styles.outlineColor },
  ];
  const seen = new Set<string>();
  return rawValues
    .map((color) => ({ ...color, value: color.value?.trim() }))
    .filter((color): color is SelectionColorValue => Boolean(color.value))
    .filter((color) => {
      // Skip fully transparent colors — not a meaningful "selection color"
      // swatch (matches extractDocumentColorPalette's same alpha check
      // below). Parsed via parseCssColor rather than compared against the
      // two literal spellings "transparent"/"rgba(0, 0, 0, 0)" — a border/
      // outline color can be zero-alpha in many other forms (e.g.
      // "rgba(255, 0, 0, 0)", "hsla(0, 0%, 0%, 0)", no-space formatting)
      // and those previously slipped through as a bogus opaque-looking
      // swatch instead of being hidden like every other invisible color.
      const parsed = parseCssColor(color.value);
      return !parsed || parsed.a > 0;
    })
    .filter((color) => {
      const key = color.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Uppercase 6-char hex (no #) for a CSS color, matching the design editor's row readout. */
export function selectionDisplayHex(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value.replace(/^#/, "").toUpperCase();
  return rgbaToHex(parsed).replace(/^#/, "").toUpperCase();
}
