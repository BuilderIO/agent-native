// Resize-handle hit-zone geometry for the host-side selection chrome
// (SelectionBox / screen-frame / draft-primitive handles in
// MultiScreenCanvas.tsx).
//
// The chrome is drawn inside the pan/zoom-scaled world container, so every
// screen-space size is multiplied by chromeScale (= 1 / zoomScale) to stay a
// constant size on screen. That compensation is correct for the VISUAL chrome,
// but it makes handle HIT zones grow without bound in local (board) units as
// you zoom out: at 19% zoom a nominal 14px edge bar is ~74 local px thick,
// reaching ~37 local px into the frame from each edge. For any frame shorter
// than twice that reach, the opposing N/S (or W/E) hit bars overlap and
// jointly cover the ENTIRE frame body — every press resolves to a resize and
// the frame can never be grabbed for a move drag (dnd finding: "scale-
// compensated resize-handle hit-zones can completely cover a selected
// element's body at low zoom").
//
// Figma bar: handles keep their constant on-screen size, but their hit slop
// must never eat the element's own body — a press near the element's center
// engages a MOVE at any zoom. These helpers implement that by clamping only
// the INWARD reach of each hit zone to a fraction of the frame's own
// dimension, leaving the outward reach (which can never occlude the body)
// untouched. With HANDLE_MAX_INWARD_FRACTION = 0.25, two opposing handles
// consume at most half of the frame's dimension, so the central 50% band of
// each axis is always body-grabbable.
//
// Keep in sync with the in-iframe selection chrome's mirror of this clamp in
// bridge/editor-chrome.bridge.ts (applySelectionHandleHitGeometry /
// clampHandleInwardReach — bridge files are self-contained, so it ports these
// pure functions locally with its own nominal handle sizes).

/** Nominal hit slop of an invisible edge-resize bar beyond the frame edge,
 *  in screen px. Never clamped: space outside the frame can't occlude it. */
export const EDGE_HANDLE_HIT_OUTWARD_PX = 7;

/** Nominal hit slop of an invisible edge-resize bar into the frame body, in
 *  screen px. Clamped by clampHandleInwardReach on small/zoomed-out frames. */
export const EDGE_HANDLE_HIT_INWARD_PX = 7;

/** Visible corner-handle square size, in screen px. The square is also its
 *  own hit target, so its inward quadrant is subject to the same clamp. */
export const CORNER_HANDLE_SIZE_PX = 10;

/** Maximum fraction of the frame's own dimension a single handle's hit zone
 *  may reach inward past the frame edge. 0.25 guarantees the central 50% of
 *  each axis stays free of handle hit zones (opposing handles reach 25% each),
 *  so a center press always engages a body move, matching Figma. */
export const HANDLE_MAX_INWARD_FRACTION = 0.25;

/**
 * Clamps a handle hit zone's inward reach (local px past the frame edge,
 * toward the frame center) so it never exceeds HANDLE_MAX_INWARD_FRACTION of
 * the frame's own dimension on that axis.
 *
 * Non-finite or non-positive dimensions (unknown frame size, degenerate
 * zero-size frames mid-creation) return the nominal reach unchanged — that is
 * exactly the pre-clamp behavior, and a zero-size frame has no body to
 * protect.
 */
export function clampHandleInwardReach(
  nominalInward: number,
  frameDimension: number,
): number {
  if (!Number.isFinite(frameDimension) || frameDimension <= 0) {
    return nominalInward;
  }
  return Math.min(nominalInward, frameDimension * HANDLE_MAX_INWARD_FRACTION);
}

export interface EdgeHandleHitGeometry {
  /** Total bar thickness along its resize axis, in local px. */
  thickness: number;
  /** Offset of the bar's outward side from the frame edge, in local px
   *  (negative: starts outside the frame). Apply as `top` for the N bar,
   *  `bottom` for S, `left` for W, `right` for E. */
  outwardOffset: number;
}

/**
 * Hit geometry for an invisible edge-resize bar. `frameDimension` is the
 * frame's size in local px along the bar's resize axis (height for N/S bars,
 * width for W/E bars). On large frames this returns the historical geometry
 * exactly: 14 * chromeScale thick, centered on the edge.
 */
export function getEdgeHandleHitGeometry(
  chromeScale: number,
  frameDimension: number,
): EdgeHandleHitGeometry {
  const outward = EDGE_HANDLE_HIT_OUTWARD_PX * chromeScale;
  const inward = clampHandleInwardReach(
    EDGE_HANDLE_HIT_INWARD_PX * chromeScale,
    frameDimension,
  );
  return { thickness: outward + inward, outwardOffset: -outward };
}

export interface CornerHandleGeometry {
  /** Square side length in local px (constant CORNER_HANDLE_SIZE_PX on
   *  screen — the visual size is never clamped, only its placement). */
  size: number;
  /** Offset from the frame's vertical edge, in local px (negative: outside).
   *  Apply as `left` for W-side corners, `right` for E-side corners. */
  offsetX: number;
  /** Offset from the frame's horizontal edge, in local px (negative:
   *  outside). Apply as `top` for N-side corners, `bottom` for S-side. */
  offsetY: number;
}

/**
 * Geometry for a visible corner-handle square. The square keeps its constant
 * on-screen size, but when its nominal half-inward overlap would exceed the
 * per-axis clamp (tiny frame and/or low zoom), the square shifts outward so
 * only the clamped reach overlaps the body. On large frames this returns the
 * historical geometry exactly: centered on the corner (offset -size / 2).
 */
export function getCornerHandleGeometry(
  chromeScale: number,
  frameWidth: number,
  frameHeight: number,
): CornerHandleGeometry {
  const size = CORNER_HANDLE_SIZE_PX * chromeScale;
  const inwardX = clampHandleInwardReach(size / 2, frameWidth);
  const inwardY = clampHandleInwardReach(size / 2, frameHeight);
  return { size, offsetX: inwardX - size, offsetY: inwardY - size };
}
