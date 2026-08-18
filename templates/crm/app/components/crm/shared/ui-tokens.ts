/**
 * The TS half of the CRM surface token layer. Everything expressible as CSS
 * lives in `app/global.css`; this file exists only for the values that must be
 * *numbers* in JS — virtualizer row math, board layout, resizable panel
 * clamps, timers — plus the two bits of shared geometry logic.
 *
 * Read `README-tokens.md` in this directory before styling a surface.
 */

/** Fixed. There is no density toggle; every consumer must agree on 36. */
export const ROW_HEIGHT = 36;
export const HEADER_HEIGHT = 40;

export const BOARD_CARD_WIDTH = 246;
export const BOARD_COLUMN_WIDTH = 268;
export const BOARD_CARD_GAP = 8;
export const BOARD_COLUMN_HEADER_HEIGHT = 36;

/** Record page is two panes: a resizable left panel plus main content. */
export const RECORD_PANEL_MIN_WIDTH = 320;
export const RECORD_MAIN_MIN_WIDTH = 350;

/** Milliseconds, mirroring --motion-* in global.css. Use these only for JS
 *  timers; anything CSS can express should use the vars instead. */
export const MOTION = {
  fast: 80,
  comfortable: 140,
  breezy: 200,
  sluggish: 300,
  sloth: 400,
} as const;

/** Cell selection ring geometry. The ring overlaps the shared 1px divider on
 *  three sides so a range reads as one outline rather than a double line. */
export const SELECTION_RING_INSET = "-1px -1px -1px 0";

export interface OverlayOptions {
  selected?: boolean;
  /** Cells: select with the content color at 8% instead of the accent at 10%,
   *  because the row underneath already carries the accent tint. */
  soft?: boolean;
  className?: string;
}

/**
 * The one hover/selection implementation. Returns the overlay class plus the
 * state attribute it keys off; spread it onto the row, cell, or card.
 */
export function overlayProps(options: OverlayOptions = {}): {
  className: string;
  "data-selected"?: "true";
} {
  return {
    className: [
      "crm-overlay",
      options.soft && "crm-overlay-soft",
      options.className,
    ]
      .filter(Boolean)
      .join(" "),
    ...(options.selected ? { "data-selected": "true" as const } : {}),
  };
}

export interface SelectionEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/**
 * A selected range is drawn per cell, so a corner may only round where the two
 * border segments that form it are both present. Rounding by cell position
 * instead of by edge pair is the usual bug: it rounds interior corners that
 * have no visible border and the range reads as loose tiles.
 */
export function selectionCornerRadius(
  edges: SelectionEdges,
  radius = 4,
): string {
  const corner = (a: boolean, b: boolean) => (a && b ? `${radius}px` : "0");
  return [
    corner(edges.top, edges.left),
    corner(edges.top, edges.right),
    corner(edges.bottom, edges.right),
    corner(edges.bottom, edges.left),
  ].join(" ");
}
