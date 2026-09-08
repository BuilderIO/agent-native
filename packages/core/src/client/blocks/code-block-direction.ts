import type { CSSProperties } from "react";

/**
 * Props that pin a block to left-to-right with left-aligned text. Spread onto
 * the OUTERMOST element of a code-like read block — code, diffs, file trees,
 * annotated code, API endpoints, JSON / data-model / schema editors, diagrams,
 * mermaid, and wireframes.
 *
 * These surfaces are inherently LTR: glyph order, line numbers, gutters, and
 * ASCII layout only read correctly left-to-right. When a plan document is
 * Persian/Arabic the renderer sets `dir="rtl"` on the document shell so prose
 * flows RTL; without this, these blocks would inherit that and render reversed.
 * Prose, rich-text, and callout blocks intentionally omit it so they stay RTL.
 *
 * `textAlign: "left"` overrides any inherited RTL text-alignment; with
 * `dir="ltr"` it is equivalent to `text-align: start`.
 */
export const ltrCodeBlockProps: { dir: "ltr"; style: CSSProperties } = {
  dir: "ltr",
  style: { textAlign: "left" },
};
