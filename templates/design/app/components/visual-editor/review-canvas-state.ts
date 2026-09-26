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
