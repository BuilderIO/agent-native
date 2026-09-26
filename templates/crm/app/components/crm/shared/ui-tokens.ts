/**
 * The TS half of the CRM surface token layer. Everything expressible as CSS
 * lives in `app/global.css`; this file exists only for the values that must be
 * *numbers* in JS — virtualizer row math, board layout, resizable panel
 * clamps, timers — plus the two bits of shared geometry logic.
 *
 * Read `README-tokens.md` in this directory before styling a surface.
 */

export const ROW_HEIGHT = 36;
export const HEADER_HEIGHT = 40;

export const BOARD_CARD_WIDTH = 246;
export const BOARD_COLUMN_WIDTH = 268;
export const BOARD_CARD_GAP = 8;
export const BOARD_COLUMN_HEADER_HEIGHT = 36;

export const RECORD_PANEL_MIN_WIDTH = 320;
export const RECORD_MAIN_MIN_WIDTH = 350;

export const MOTION = {
  fast: 80,
  comfortable: 140,
  breezy: 200,
  sluggish: 300,
  sloth: 400,
} as const;

export const SELECTION_RING_INSET = "-1px -1px -1px 0";

export interface OverlayOptions {
  selected?: boolean;
  soft?: boolean;
  className?: string;
}

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
