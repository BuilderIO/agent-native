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

export function getReviewPopoverPlacement(
  point: ReviewAnchorPoint,
  viewportPoint?: ReviewCanvasPoint | null,
  viewport?: { width: number; height: number },
): {
  horizontal: "start" | "end";
  vertical: "above" | "below";
} {
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

/**
 * Horizontal box of a popover opened from a pin, as a left offset from the
 * pin plus a width, kept inside the region so the clip never cuts it off.
 */
export function getReviewPopoverBox(
  anchorX: number,
  region: ReviewVisibleRegion,
  horizontal: "start" | "end",
): { left: number; width: number } {
  const width = Math.min(
    REVIEW_POPOVER_WIDTH_PX,
    Math.max(0, region.width - 2 * REVIEW_POPOVER_EDGE_MARGIN_PX),
  );
  const preferredLeft =
    horizontal === "end"
      ? anchorX - REVIEW_POPOVER_ANCHOR_GAP_PX - width
      : anchorX + REVIEW_POPOVER_ANCHOR_GAP_PX;
  const minLeft = region.left + REVIEW_POPOVER_EDGE_MARGIN_PX;
  const maxLeft =
    region.left + region.width - REVIEW_POPOVER_EDGE_MARGIN_PX - width;
  return {
    left: Math.min(Math.max(preferredLeft, minLeft), maxLeft) - anchorX,
    width,
  };
}
