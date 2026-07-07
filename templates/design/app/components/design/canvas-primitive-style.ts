/**
 * Single source of truth for canvas-primitive visual styles.
 *
 * Both the board draft preview (DraftPrimitiveContent in MultiScreenCanvas.tsx)
 * and the committed HTML renderer (appendCanvasPrimitiveToHtml in
 * DesignEditor.tsx) must use these helpers so that what you see while drawing
 * (preview) is pixel-identical to what gets committed — fixing the B5 color
 * jump and the B6 ellipse border-radius jump.
 *
 * Design decisions:
 * - Fill (rect/ellipse): `rgb(218 218 218)` — a plain, theme-independent
 *   neutral gray, not a CSS custom property. This is intentional: a shape
 *   drawn with no explicit color should look the same (a soft Figma-like
 *   gray) regardless of which document theme it lands in, rather than
 *   silently tinting to whatever `--primary` resolves to there.
 * - Stroke (rect/ellipse): `rgb(168 168 168)` — a slightly darker plain gray,
 *   same rationale as fill above.
 * - Frame fill: the one default that *is* theme-adaptive —
 *   `hsl(var(--primary) / 0.05)`, a very faint tint of the editor's accent
 *   color so a layout frame's interior reads as "structural chrome" rather
 *   than a fixed gray. Its border stays a plain dashed gray, same as
 *   rect/ellipse's border.
 * - Stroke width: 1px for div-based shapes.
 * - Ellipse: borderRadius "50%" in both paths — no more "oval on commit" jump.
 * - Rect: borderRadius "2px" (small, matches the previous committed value; the
 *   preview used Tailwind `rounded-sm` which resolves to 2px).
 * - Text: inherits current color by default. Selection/edit chrome owns
 *   outlines so text does not carry a persistent border that double-stacks
 *   with focused states.
 *
 * Overrides: when a caller passes a `fill` override, it becomes the
 * `background` for every kind EXCEPT text — a text primitive's `fill` maps to
 * `color` instead (text has no fillable background box; DesignEditor's
 * `appendCanvasPrimitiveToHtml` does the same `primitive.fill ?? "currentColor"`
 * mapping for the committed element). Getting this wrong here previously
 * meant a text primitive's chosen color rendered in the preview but was
 * silently dropped, then jumped to the correct color only once committed.
 * `stroke` / `strokeWidth` overrides are passed through unchanged for every
 * kind.
 */

import type * as React from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CanvasPrimitiveKind =
  | "rect"
  | "rectangle"
  | "ellipse"
  | "text"
  | "frame";

/**
 * Canonical visual properties for a div-based canvas primitive.
 * All values are plain CSS strings (usable verbatim in both React CSSProperties
 * and HTML style attributes).
 */
export interface CanvasPrimitiveVisual {
  background: string;
  border: string;
  borderRadius: string;
  /** Only set for text primitives */
  color?: string;
}

// ---------------------------------------------------------------------------
// Canonical tokens
// ---------------------------------------------------------------------------

/** Default fill — a soft Figma-like neutral gray. */
const DEFAULT_FILL = "rgb(218 218 218)";

/** Default stroke — slightly darker so new rectangles stay visible. */
const DEFAULT_STROKE = "rgb(168 168 168)";

/** Stroke width in pixels for div-based shapes. */
const DEFAULT_STROKE_WIDTH_PX = 1;

/** Border shorthand shared by rect + ellipse. */
const DEFAULT_BORDER = `${DEFAULT_STROKE_WIDTH_PX}px solid ${DEFAULT_STROKE}`;

/** Text nodes rely on editor chrome for outlines; the element itself is bare. */
const TEXT_BORDER = "0 solid transparent";

/** Frame gets a dashed border to signal it is a layout container. */
const FRAME_BORDER = `${DEFAULT_STROKE_WIDTH_PX}px dashed ${DEFAULT_STROKE}`;

/** Very faint fill for frames so the interior is readable. */
const FRAME_FILL = "hsl(var(--primary) / 0.05)";

/** Small radius matching Tailwind `rounded-sm` (2 px). */
const RECT_RADIUS = "2px";

/**
 * Canonical default stroke for vector primitives (line / arrow / pen path).
 *
 * Figma-parity: a freshly drawn line, arrow, or pen path defaults to solid
 * black at 1px — not the editor's `--primary` accent color at 3px. These are
 * exported so every call site that draws or commits one of these primitives
 * (the board draft preview in MultiScreenCanvas.tsx, the persisted board file
 * in shared/board-file.ts, and DesignEditor.tsx's
 * `appendCanvasPrimitiveToHtml`) agrees on the same default, exactly like the
 * div-based `canvasPrimitiveVisual` tokens above keep rect/ellipse/frame/text
 * consistent.
 */
export const DEFAULT_LINE_STROKE = "#000000";

/** Default stroke width, in pixels, for a freshly drawn line/arrow/pen path. */
export const DEFAULT_LINE_STROKE_WIDTH_PX = 1;

// ---------------------------------------------------------------------------
// canvasPrimitiveVisual
// ---------------------------------------------------------------------------

/**
 * Returns the canonical CanvasPrimitiveVisual for the given kind.
 *
 * Usage (React preview):
 *   const v = canvasPrimitiveVisual("ellipse");
 *   <div style={{ background: v.background, border: v.border, borderRadius: v.borderRadius }} />
 *
 * Usage (committed HTML):
 *   const v = canvasPrimitiveVisual("ellipse");
 *   el.style.background = v.background;
 *   el.style.border = v.border;
 *   el.style.borderRadius = v.borderRadius;
 */
export function canvasPrimitiveVisual(
  kind: CanvasPrimitiveKind,
): CanvasPrimitiveVisual {
  switch (kind) {
    case "ellipse":
      return {
        background: DEFAULT_FILL,
        border: DEFAULT_BORDER,
        borderRadius: "50%",
      };
    case "frame":
      return {
        background: FRAME_FILL,
        border: FRAME_BORDER,
        borderRadius: RECT_RADIUS,
      };
    case "text":
      return {
        background: "transparent",
        border: TEXT_BORDER,
        borderRadius: RECT_RADIUS,
        color: "currentColor",
      };
    case "rect":
    case "rectangle":
    default:
      return {
        background: DEFAULT_FILL,
        border: DEFAULT_BORDER,
        borderRadius: RECT_RADIUS,
      };
  }
}

// ---------------------------------------------------------------------------
// canvasPrimitiveStyleString
// ---------------------------------------------------------------------------

/**
 * Returns an inline CSS style string for the given kind, ready to assign to
 * `element.setAttribute("style", …)` or to splice into generated HTML.
 *
 * Override parameters let callers pass a user-chosen fill/stroke instead of
 * the defaults — if undefined the canonical tokens are used.
 *
 * Example output for "ellipse":
 *   "background:hsl(var(--primary) / 0.12);border:1px solid hsl(var(--primary) / 0.7);border-radius:50%"
 */
export function canvasPrimitiveStyleString(
  kind: CanvasPrimitiveKind,
  overrides?: { fill?: string; stroke?: string; strokeWidth?: number },
): string {
  const v = canvasPrimitiveVisual(kind);
  const isText = kind === "text";

  // Apply caller overrides so user-chosen colours are preserved.
  let background = v.background;
  let border = v.border;

  // Text primitives render their fill as `color`, not `background` (see the
  // matching note in canvasPrimitiveReactStyle) — otherwise a caller-chosen
  // text color would paint a filled background box instead of tinting the
  // glyphs, and would disagree with the committed HTML output.
  if (overrides?.fill && !isText) {
    background = overrides.fill;
  }
  if (overrides?.stroke || overrides?.strokeWidth !== undefined) {
    const stroke = overrides.stroke ?? DEFAULT_STROKE;
    const width = overrides.strokeWidth ?? DEFAULT_STROKE_WIDTH_PX;
    const style = kind === "frame" || isText ? "dashed" : "solid";
    border = `${width}px ${style} ${stroke}`;
  }

  const parts: string[] = [
    `background:${background}`,
    `border:${border}`,
    `border-radius:${v.borderRadius}`,
  ];

  const color = isText ? overrides?.fill || v.color || "currentColor" : v.color;
  if (color) {
    parts.push(`color:${color}`);
  }

  return parts.join(";");
}

// ---------------------------------------------------------------------------
// canvasPrimitiveReactStyle
// ---------------------------------------------------------------------------

/**
 * Returns a React CSSProperties object for the given kind, ready to spread
 * onto a JSX `style` prop.
 *
 * Override parameters preserve user-chosen fill/stroke colours.
 *
 * Example:
 *   <div style={canvasPrimitiveReactStyle("ellipse")} />
 */
export function canvasPrimitiveReactStyle(
  kind: CanvasPrimitiveKind,
  overrides?: { fill?: string; stroke?: string; strokeWidth?: number },
): React.CSSProperties {
  const v = canvasPrimitiveVisual(kind);
  const isText = kind === "text";

  let background = v.background as string | undefined;
  let borderColor: string | undefined;
  let borderWidth: number | string | undefined = DEFAULT_STROKE_WIDTH_PX;
  let borderStyle: string | undefined = "solid";

  if (kind === "frame" || isText) {
    borderStyle = "dashed";
  }

  if (isText && !overrides?.stroke && overrides?.strokeWidth === undefined) {
    borderWidth = 0;
    borderStyle = "solid";
  }

  // Text primitives render their fill as `color`, not `background` — the
  // element itself stays transparent so it doesn't paint a filled box behind
  // the glyphs. Committed HTML output (DesignEditor's
  // appendCanvasPrimitiveToHtml) already maps `primitive.fill` to
  // `element.style.color`; this must match exactly or a text primitive with
  // a custom fill shows the wrong color in the draft preview and visibly
  // jumps to the correct color the moment it commits.
  if (overrides?.fill && !isText) {
    background = overrides.fill;
  }
  if (overrides?.stroke) {
    borderColor = overrides.stroke;
  } else {
    // Extract from canonical border shorthand: "Npx style color"
    const borderParts = v.border.split(" ");
    // e.g. ["1px", "solid", "hsl(...)"] — colour may have spaces inside parens
    borderColor = borderParts.slice(2).join(" ");
  }
  if (overrides?.strokeWidth !== undefined) {
    borderWidth = overrides.strokeWidth;
  }

  const style: React.CSSProperties = {
    background,
    border: undefined,
    borderColor,
    borderWidth,
    borderStyle,
    borderRadius: v.borderRadius,
  };

  if (v.color) {
    style.color = v.color;
  }

  if (isText) {
    style.background = "transparent";
    style.outline = "none";
    style.outlineOffset = 0;
    // Matches DesignEditor's `primitive.fill ?? "currentColor"` convention
    // for the committed element, so the preview and the commit never
    // disagree on text color.
    style.color = overrides?.fill || "currentColor";
  }

  return style;
}
