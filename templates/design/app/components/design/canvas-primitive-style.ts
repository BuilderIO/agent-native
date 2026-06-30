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
 * - Fill: `hsl(var(--primary) / 0.12)` — the calm, theme-adaptive tint already
 *   used by the draft preview.  NOT the saturated blue previously hard-coded in
 *   appendCanvasPrimitiveToHtml (`rgba(37,99,235,0.16)`).
 * - Stroke: `hsl(var(--primary) / 0.7)` — same CSS-var approach, adapts to
 *   light/dark mode automatically.
 * - Stroke width: 1px for div-based shapes.
 * - Ellipse: borderRadius "50%" in both paths — no more "oval on commit" jump.
 * - Rect: borderRadius "2px" (small, matches the previous committed value; the
 *   preview used Tailwind `rounded-sm` which resolves to 2px).
 * - Frame: dashed border, slightly lighter fill (matches preview semantics).
 * - Text: inherits current color; dashed outline as placeholder affordance.
 *
 * CSS custom properties (`hsl(var(--primary) / …)`) work in the committed HTML
 * because the iframe inherits the design-editor stylesheet that defines
 * `--primary`.  When a `fill` / `stroke` override is already present on the
 * primitive those are passed through unchanged so user-chosen colors are never
 * clobbered.
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

/** Default fill tint — calm, theme-adaptive, not saturated. */
const DEFAULT_FILL = "hsl(var(--primary) / 0.12)";

/** Default stroke — uses the same hue at higher opacity for clarity. */
const DEFAULT_STROKE = "hsl(var(--primary) / 0.7)";

/** Stroke width in pixels for div-based shapes. */
const DEFAULT_STROKE_WIDTH_PX = 1;

/** Border shorthand shared by rect + ellipse. */
const DEFAULT_BORDER = `${DEFAULT_STROKE_WIDTH_PX}px solid ${DEFAULT_STROKE}`;

/** Frame gets a dashed border to signal it is a layout container. */
const FRAME_BORDER = `${DEFAULT_STROKE_WIDTH_PX}px dashed ${DEFAULT_STROKE}`;

/** Very faint fill for frames so the interior is readable. */
const FRAME_FILL = "hsl(var(--primary) / 0.05)";

/** Small radius matching Tailwind `rounded-sm` (2 px). */
const RECT_RADIUS = "2px";

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
        border: `${DEFAULT_STROKE_WIDTH_PX}px dashed hsl(var(--primary) / 0.6)`,
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

  // Apply caller overrides so user-chosen colours are preserved.
  let background = v.background;
  let border = v.border;

  if (overrides?.fill) {
    background = overrides.fill;
  }
  if (overrides?.stroke || overrides?.strokeWidth !== undefined) {
    const stroke = overrides.stroke ?? DEFAULT_STROKE;
    const width = overrides.strokeWidth ?? DEFAULT_STROKE_WIDTH_PX;
    const style = kind === "frame" || kind === "text" ? "dashed" : "solid";
    border = `${width}px ${style} ${stroke}`;
  }

  const parts: string[] = [
    `background:${background}`,
    `border:${border}`,
    `border-radius:${v.borderRadius}`,
  ];

  if (v.color) {
    parts.push(`color:${v.color}`);
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

  let background = v.background as string | undefined;
  let borderColor: string | undefined;
  let borderWidth: number | string | undefined = DEFAULT_STROKE_WIDTH_PX;
  let borderStyle: string | undefined = "solid";

  if (kind === "frame" || kind === "text") {
    borderStyle = "dashed";
  }

  if (overrides?.fill) {
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

  // For text kind, clear fill-as-background since text uses `color`
  if (kind === "text") {
    style.background = "transparent";
  }

  return style;
}
