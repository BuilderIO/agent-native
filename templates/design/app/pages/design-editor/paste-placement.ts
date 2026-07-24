import type { FrameBounds } from "@shared/canvas-math";

/**
 * Pure decision module for context-aware paste placement: decides where each
 * pasted entry lands (in-flow "flow-after" or absolute), the next cascade
 * counter, and whether to recenter the camera.
 *
 * Owns placement for layer/screen/image paste entries only — not
 * paste-to-replace, duplicate-with-replay, or asset/Figma insertion. Keep pure:
 * no DOM, React, or I/O.
 */

/** Cascade step so repeated keyboard pastes don't stack exactly. */
export const CASCADE_STEP_PX = 16;
/** Small nudge applied to a same-screen paste (the "+10" in the legacy rule). */
export const SAME_SCREEN_NUDGE_PX = 10;
/** Fallback viewport center when no viewport bounds are available. */
const FALLBACK_VIEWPORT_CENTER = { x: 120, y: 120 } as const;
/** Minimum fraction of the pasted group's AABB that must stay visible. */
const MIN_VISIBLE_FRACTION = 0.5;

export type PastePlacementEntry = {
  index: number;
  sourceFileId: string | null;
  sourcePosition: { x: number; y: number } | null; // from extractLayerPosition
  kind: "layer" | "screen" | "image";
};

export type PastePlacementInput = {
  entries: PastePlacementEntry[];
  target: {
    fileId: string;
    isSourceScreen: boolean;
    frameBounds: FrameBounds | null;
  };
  selection: { selector: string | null; isFlowContainer: boolean } | null;
  viewport: { visibleCanvasBounds: FrameBounds; zoom: number } | null;
  explicitPoint: { x: number; y: number } | null; // "Paste here"
  origin: "same-screen" | "cross-screen" | "assets" | "figma" | "external";
  cascadeCount: number;
};

export type PastePlacement =
  | { mode: "flow-after"; anchorSelector: string }
  | { mode: "absolute"; position: { x: number; y: number } };

export type PastePlacementResult = {
  placements: PastePlacement[]; // index-aligned with input.entries
  nextCascadeCount: number;
  ensureVisible: boolean; // caller fires a fitBounds cameraCommand
};

type Point = { x: number; y: number };

function absolute(position: Point): PastePlacement {
  return { mode: "absolute", position };
}

function everyEntryPositioned(entries: PastePlacementEntry[]): boolean {
  return (
    entries.length > 0 &&
    entries.every((entry) => entry.sourcePosition !== null)
  );
}

function everyEntryIsLayer(entries: PastePlacementEntry[]): boolean {
  return entries.length > 0 && entries.every((entry) => entry.kind === "layer");
}

/** Group's top-left corner across every entry that has a source position. */
function minSourceCorner(entries: PastePlacementEntry[]): Point {
  const positioned = entries
    .map((entry) => entry.sourcePosition)
    .filter((source): source is Point => source !== null);
  if (positioned.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.min(...positioned.map((source) => source.x)),
    y: Math.min(...positioned.map((source) => source.y)),
  };
}

function centerOfBounds(bounds: FrameBounds): Point {
  return { x: bounds.centerX, y: bounds.centerY };
}

/** Flow-after applies when the selection is a valid in-flow target with a
 * concrete anchor selector. */
function flowAfterApplies(
  input: PastePlacementInput,
): input is PastePlacementInput & {
  selection: { selector: string; isFlowContainer: boolean };
} {
  const { selection, explicitPoint, entries } = input;
  if (explicitPoint !== null) return false;
  if (selection === null || selection.selector === null) return false;
  if (!everyEntryIsLayer(entries)) return false;
  return selection.isFlowContainer || selection.selector !== null;
}

/** Fraction of the group's AABB that overlaps the viewport; a degenerate
 * (zero-area) group falls back to a point-in-bounds test. */
function groupVisibleFraction(positions: Point[], bounds: FrameBounds): number {
  const xs = positions.map((point) => point.x);
  const ys = positions.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const groupArea = (right - left) * (bottom - top);

  const overlapW = Math.max(
    0,
    Math.min(right, bounds.right) - Math.max(left, bounds.left),
  );
  const overlapH = Math.max(
    0,
    Math.min(bottom, bounds.bottom) - Math.max(top, bounds.top),
  );
  const overlapArea = overlapW * overlapH;

  if (groupArea <= 0) {
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const inside =
      cx >= bounds.left &&
      cx <= bounds.right &&
      cy >= bounds.top &&
      cy <= bounds.bottom;
    return inside ? 1 : 0;
  }
  return overlapArea / groupArea;
}

/** Center of the group's AABB across placement points. */
function groupCenter(positions: Point[]): Point {
  const xs = positions.map((point) => point.x);
  const ys = positions.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

export function resolvePastePlacement(
  input: PastePlacementInput,
): PastePlacementResult {
  const { entries, target, viewport, explicitPoint, origin, cascadeCount } =
    input;

  // Only keyboard pastes (same/cross-screen, no explicit point) advance the
  // cascade counter, independent of which placement branch fires.
  const isKeyboardPaste =
    (origin === "same-screen" || origin === "cross-screen") &&
    explicitPoint === null;
  const nextCascadeCount = isKeyboardPaste ? cascadeCount + 1 : cascadeCount;
  // Cascade offset is applied to the group as a unit, never per-index, so
  // multi-selection spacing survives repeated pastes.
  const cascadeOffset = cascadeCount * CASCADE_STEP_PX;

  if (entries.length === 0) {
    return { placements: [], nextCascadeCount, ensureVisible: false };
  }

  // Explicit "Paste here": group top-left lands at the point, relative offsets
  // preserved; a group with no source positions staggers by index.
  if (explicitPoint !== null) {
    const minSource = minSourceCorner(entries);
    const positioned = everyEntryPositioned(entries);
    const placements = entries.map((entry, index): PastePlacement => {
      if (positioned && entry.sourcePosition) {
        return absolute({
          x: explicitPoint.x + (entry.sourcePosition.x - minSource.x),
          y: explicitPoint.y + (entry.sourcePosition.y - minSource.y),
        });
      }
      return absolute({
        x: explicitPoint.x + index * CASCADE_STEP_PX,
        y: explicitPoint.y + index * CASCADE_STEP_PX,
      });
    });
    return { placements, nextCascadeCount, ensureVisible: false };
  }

  // Flow-after: every clone becomes an in-flow sibling after the selection.
  if (flowAfterApplies(input)) {
    const anchorSelector = input.selection.selector;
    const placements = entries.map(
      (): PastePlacement => ({ mode: "flow-after", anchorSelector }),
    );
    return { placements, nextCascadeCount, ensureVisible: false };
  }

  // Same container, no explicit point: reuse each entry's source coords plus a
  // uniform nudge and cascade offset.
  if (origin === "same-screen" && everyEntryPositioned(entries)) {
    const placements = entries.map((entry): PastePlacement => {
      const source = entry.sourcePosition as Point;
      return absolute({
        x: source.x + SAME_SCREEN_NUDGE_PX + cascadeOffset,
        y: source.y + SAME_SCREEN_NUDGE_PX + cascadeOffset,
      });
    });
    return { placements, nextCascadeCount, ensureVisible: false };
  }

  // Different compatible frame: anchor the group's top-left to the destination
  // frame origin, preserving internal spacing.
  if (
    origin === "cross-screen" &&
    target.frameBounds !== null &&
    everyEntryPositioned(entries)
  ) {
    const frameOrigin = {
      x: target.frameBounds.left,
      y: target.frameBounds.top,
    };
    const minSource = minSourceCorner(entries);
    let positions = entries.map((entry): Point => {
      const source = entry.sourcePosition as Point;
      return {
        x: frameOrigin.x + (source.x - minSource.x) + cascadeOffset,
        y: frameOrigin.y + (source.y - minSource.y) + cascadeOffset,
      };
    });

    // If <50% of the group's AABB is visible, translate the whole group by one
    // vector so its center matches the viewport center (never per-index).
    let ensureVisible = false;
    if (viewport !== null) {
      const fraction = groupVisibleFraction(
        positions,
        viewport.visibleCanvasBounds,
      );
      if (fraction < MIN_VISIBLE_FRACTION) {
        const target2 = centerOfBounds(viewport.visibleCanvasBounds);
        const current = groupCenter(positions);
        const delta = { x: target2.x - current.x, y: target2.y - current.y };
        positions = positions.map((point) => ({
          x: point.x + delta.x,
          y: point.y + delta.y,
        }));
        ensureVisible = true;
      }
    }

    return {
      placements: positions.map(absolute),
      nextCascadeCount,
      ensureVisible,
    };
  }

  // Last resort (no explicit point, no usable source positions): stagger from
  // the viewport center by index and ask the caller to recenter.
  const center =
    viewport !== null
      ? centerOfBounds(viewport.visibleCanvasBounds)
      : FALLBACK_VIEWPORT_CENTER;
  const placements = entries.map(
    (_, index): PastePlacement =>
      absolute({
        x: center.x + index * CASCADE_STEP_PX,
        y: center.y + index * CASCADE_STEP_PX,
      }),
  );
  return { placements, nextCascadeCount, ensureVisible: true };
}
