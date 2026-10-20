import {
  parseReviewAnchor,
  type DesignReviewAnchor,
  type ReviewAnchorPoint,
  type ReviewCanvasPoint,
} from "../../../shared/review-anchor";

export interface ReviewPinPosition {
  point: ReviewAnchorPoint;
  source: "node" | "selector" | "point";
  canvasPoint?: ReviewCanvasPoint;
}

export function getReviewPinPosition(
  anchor: unknown,
  screenId?: string | null,
): ReviewPinPosition | null {
  const parsed = parseReviewAnchor(anchor);
  if (!parsed) return null;
  return {
    point:
      screenId && parsed.screenId === screenId && parsed.screenPoint
        ? parsed.screenPoint
        : parsed.point,
    source: parsed.nodeId ? "node" : parsed.selector ? "selector" : "point",
    ...(parsed.canvasPoint ? { canvasPoint: parsed.canvasPoint } : {}),
  };
}

export interface ReviewDraftPin {
  id: string;
  anchor: DesignReviewAnchor;
  draft: string;
  resolutionTarget: "agent" | "human";
  metadata: Record<string, unknown>;
}

export interface ReviewDraftLocation {
  id: string;
  anchor: DesignReviewAnchor;
  metadata: Record<string, unknown>;
}

export function placeReviewDraftPin(
  current: ReviewDraftPin | null,
  location: ReviewDraftLocation,
): ReviewDraftPin {
  if (current?.draft.trim()) return current;
  return {
    id: current?.id ?? location.id,
    anchor: location.anchor,
    draft: current?.draft ?? "",
    resolutionTarget: current?.resolutionTarget ?? "human",
    metadata: location.metadata,
  };
}

export interface ReviewPopoverPlacement {
  horizontal: "start" | "end";
  vertical: "above" | "below";
}

export function getReviewPopoverPlacement(
  point: ReviewAnchorPoint,
  viewportPoint?: ReviewCanvasPoint | null,
  viewport?: { width: number; height: number },
): ReviewPopoverPlacement {
  const placementPoint =
    viewportPoint && viewport && viewport.width > 0 && viewport.height > 0
      ? {
          xPct: (viewportPoint.x / viewport.width) * 100,
          yPct: (viewportPoint.y / viewport.height) * 100,
        }
      : point;
  return {
    horizontal: placementPoint.xPct > 60 ? "end" : "start",
    vertical: placementPoint.yPct > 65 ? "above" : "below",
  };
}

/**
 * The part of the screen where review UI may paint. Pins are portaled above
 * the editor chrome's stacking context, so the editor's panels, bars and
 * toolbar are cut out of this region instead of being outranked by z-index.
 */
export interface ReviewVisibleRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The floating bottom toolbar, cut out of the region from its top edge down. */
  bottomNotch: { left: number; right: number; top: number } | null;
}

export function isReviewPointVisible(
  region: ReviewVisibleRegion,
  point: ReviewCanvasPoint,
): boolean {
  const { left, top, width, height, bottomNotch } = region;
  const right = left + width;
  const bottom = top + height;
  if (point.x < left || right < point.x || point.y < top || bottom < point.y) {
    return false;
  }
  return !(
    bottomNotch &&
    point.x >= bottomNotch.left &&
    point.x <= bottomNotch.right &&
    point.y >= bottomNotch.top
  );
}

export function reviewRegionClipPath(region: ReviewVisibleRegion): string {
  const { left, top, width, height, bottomNotch } = region;
  const right = left + width;
  const bottom = top + height;
  const corners: Array<[number, number]> = [
    [left, top],
    [right, top],
    [right, bottom],
  ];
  if (bottomNotch) {
    const notchLeft = Math.min(Math.max(bottomNotch.left, left), right);
    const notchRight = Math.min(Math.max(bottomNotch.right, left), right);
    const notchTop = Math.min(Math.max(bottomNotch.top, top), bottom);
    corners.push(
      [notchRight, bottom],
      [notchRight, notchTop],
      [notchLeft, notchTop],
      [notchLeft, bottom],
    );
  }
  corners.push([left, bottom]);
  return `polygon(${corners.map(([x, y]) => `${x}px ${y}px`).join(", ")})`;
}

const REVIEW_POPOVER_WIDTH_PX = 320;
const REVIEW_POPOVER_ANCHOR_GAP_PX = 12;
const REVIEW_POPOVER_EDGE_MARGIN_PX = 8;
// Popovers sit beside the 24px pin: one opening down starts 4px below the
// pin's center, one opening up ends 12px below it.
const REVIEW_POPOVER_DOWN_OFFSET_PX = 4;
const REVIEW_POPOVER_UP_OFFSET_PX = 12;

/**
 * Box of a popover opened from a pin. `left` and `top` are offsets of its
 * top-left corner from the pin's center; past `maxHeight` its body scrolls.
 */
export interface ReviewPopoverBox extends ReviewPopoverPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

function reviewPopoverBoxFor(
  anchor: ReviewCanvasPoint,
  region: ReviewVisibleRegion,
  placement: ReviewPopoverPlacement,
  height: number,
): ReviewPopoverBox {
  const width = Math.min(
    REVIEW_POPOVER_WIDTH_PX,
    Math.max(0, region.width - 2 * REVIEW_POPOVER_EDGE_MARGIN_PX),
  );
  const preferredLeft =
    placement.horizontal === "end"
      ? anchor.x - REVIEW_POPOVER_ANCHOR_GAP_PX - width
      : anchor.x + REVIEW_POPOVER_ANCHOR_GAP_PX;
  const minLeft = region.left + REVIEW_POPOVER_EDGE_MARGIN_PX;
  const maxLeft =
    region.left + region.width - REVIEW_POPOVER_EDGE_MARGIN_PX - width;
  const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);

  const { bottomNotch } = region;
  const overlapsNotchColumn =
    bottomNotch !== null &&
    bottomNotch.left < left + width &&
    left < bottomNotch.right;
  const notchTop = overlapsNotchColumn
    ? bottomNotch.top
    : Number.POSITIVE_INFINITY;
  const floor =
    Math.min(region.top + region.height, notchTop) -
    REVIEW_POPOVER_EDGE_MARGIN_PX;
  const ceiling = region.top + REVIEW_POPOVER_EDGE_MARGIN_PX;

  if (placement.vertical === "below") {
    const top = Math.max(anchor.y + REVIEW_POPOVER_DOWN_OFFSET_PX, ceiling);
    return {
      ...placement,
      left: left - anchor.x,
      top: top - anchor.y,
      width,
      maxHeight: Math.max(0, floor - top),
    };
  }
  const bottom = Math.min(anchor.y + REVIEW_POPOVER_UP_OFFSET_PX, floor);
  const maxHeight = Math.max(0, bottom - ceiling);
  return {
    ...placement,
    left: left - anchor.x,
    top: bottom - Math.min(height, maxHeight) - anchor.y,
    width,
    maxHeight,
  };
}

/**
 * Where a popover of the given height opens from a pin so that none of it
 * lands outside the region or under the bottom toolbar cut-out. Tries the
 * preferred side, then the opposite vertical side, then the opposite
 * horizontal side; when no side fits, takes the one with the most room and
 * caps the height there so the body scrolls instead of being clipped.
 */
export function getReviewPopoverBox(
  anchor: ReviewCanvasPoint,
  region: ReviewVisibleRegion,
  preferred: ReviewPopoverPlacement,
  height: number,
): ReviewPopoverBox {
  const horizontal = preferred.horizontal === "end" ? "start" : "end";
  const vertical = preferred.vertical === "above" ? "below" : "above";
  const placements: ReviewPopoverPlacement[] = [
    preferred,
    { horizontal: preferred.horizontal, vertical },
    { horizontal, vertical: preferred.vertical },
    { horizontal, vertical },
  ];
  const boxes = placements.map((placement) =>
    reviewPopoverBoxFor(anchor, region, placement, height),
  );
  return (
    boxes.find((box) => height <= box.maxHeight) ??
    boxes.reduce((best, box) => (box.maxHeight > best.maxHeight ? box : best))
  );
}
