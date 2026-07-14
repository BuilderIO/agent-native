import type {
  DistanceGuideBand,
  EqualGapGuide,
  FrameBounds,
} from "@shared/canvas-math";

import type {
  AlignmentGuide,
  AltHoverMeasurement,
  AltHoverMeasurementLine,
} from "./types";

// Snap/guide recompute runs every rAF-coalesced mousemove during a drag and
// always returns a freshly-allocated array, so referential-equality bail in
// setState never fires even when the guides are unchanged frame-to-frame
// (e.g. holding steady mid-drag, or dragging along an axis with no new
// alignment). Shallow field-compare avoids the wasted re-render (PF15).
export function alignmentGuidesEqual(a: AlignmentGuide[], b: AlignmentGuide[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.orientation !== y.orientation ||
      x.position !== y.position ||
      x.start !== y.start ||
      x.end !== y.end
    ) {
      return false;
    }
  }
  return true;
}

export function distanceGuideBandEqual(
  a: DistanceGuideBand,
  b: DistanceGuideBand,
): boolean {
  return (
    a.gapStart === b.gapStart &&
    a.gapEnd === b.gapEnd &&
    a.crossStart === b.crossStart &&
    a.crossEnd === b.crossEnd
  );
}

export function equalGapGuidesEqual(a: EqualGapGuide[], b: EqualGapGuide[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.orientation !== y.orientation ||
      x.gap !== y.gap ||
      !distanceGuideBandEqual(x.bands[0], y.bands[0]) ||
      !distanceGuideBandEqual(x.bands[1], y.bands[1])
    ) {
      return false;
    }
  }
  return true;
}

export function altHoverMeasurementLineEqual(
  a: AltHoverMeasurementLine | null,
  b: AltHoverMeasurementLine | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.orientation === b.orientation &&
    a.gap === b.gap &&
    a.start === b.start &&
    a.end === b.end &&
    a.crossPosition === b.crossPosition &&
    a.overlaps === b.overlaps
  );
}

export function altHoverMeasurementEqual(
  a: AltHoverMeasurement | null,
  b: AltHoverMeasurement | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    altHoverMeasurementLineEqual(a.horizontal, b.horizontal) &&
    altHoverMeasurementLineEqual(a.vertical, b.vertical)
  );
}

/** Computes the Figma-style alt-hover measurement lines between a selection's
 *  bounding box and a hovered object's bounding box: one horizontal gap (x
 *  axis) and one vertical gap (y axis), each with the px distance and the
 *  line's placement. Pure/testable — no DOM, no React state. Returns null for
 *  an axis where the two boxes overlap (nothing meaningful to measure there),
 *  matching Figma's behavior of only showing the line(s) that represent real
 *  empty space. */
export function computeAltHoverMeasurement(
  selectionBounds: FrameBounds,
  hoveredBounds: FrameBounds,
): AltHoverMeasurement {
  const horizontalOverlap =
    selectionBounds.top < hoveredBounds.bottom &&
    selectionBounds.bottom > hoveredBounds.top;
  const verticalOverlap =
    selectionBounds.left < hoveredBounds.right &&
    selectionBounds.right > hoveredBounds.left;

  let horizontal: AltHoverMeasurementLine | null = null;
  if (selectionBounds.right <= hoveredBounds.left) {
    horizontal = {
      orientation: "horizontal",
      gap: hoveredBounds.left - selectionBounds.right,
      start: selectionBounds.right,
      end: hoveredBounds.left,
      crossPosition: horizontalOverlap
        ? (Math.max(selectionBounds.top, hoveredBounds.top) +
            Math.min(selectionBounds.bottom, hoveredBounds.bottom)) /
          2
        : (selectionBounds.centerY + hoveredBounds.centerY) / 2,
      overlaps: false,
    };
  } else if (hoveredBounds.right <= selectionBounds.left) {
    horizontal = {
      orientation: "horizontal",
      gap: selectionBounds.left - hoveredBounds.right,
      start: hoveredBounds.right,
      end: selectionBounds.left,
      crossPosition: horizontalOverlap
        ? (Math.max(selectionBounds.top, hoveredBounds.top) +
            Math.min(selectionBounds.bottom, hoveredBounds.bottom)) /
          2
        : (selectionBounds.centerY + hoveredBounds.centerY) / 2,
      overlaps: false,
    };
  }

  let vertical: AltHoverMeasurementLine | null = null;
  if (selectionBounds.bottom <= hoveredBounds.top) {
    vertical = {
      orientation: "vertical",
      gap: hoveredBounds.top - selectionBounds.bottom,
      start: selectionBounds.bottom,
      end: hoveredBounds.top,
      crossPosition: verticalOverlap
        ? (Math.max(selectionBounds.left, hoveredBounds.left) +
            Math.min(selectionBounds.right, hoveredBounds.right)) /
          2
        : (selectionBounds.centerX + hoveredBounds.centerX) / 2,
      overlaps: false,
    };
  } else if (hoveredBounds.bottom <= selectionBounds.top) {
    vertical = {
      orientation: "vertical",
      gap: selectionBounds.top - hoveredBounds.bottom,
      start: hoveredBounds.bottom,
      end: selectionBounds.top,
      crossPosition: verticalOverlap
        ? (Math.max(selectionBounds.left, hoveredBounds.left) +
            Math.min(selectionBounds.right, hoveredBounds.right)) /
          2
        : (selectionBounds.centerX + hoveredBounds.centerX) / 2,
      overlaps: false,
    };
  }

  return { horizontal, vertical };
}
