export interface ReviewAnchorPoint {
  xPct: number;
  yPct: number;
}

export interface DesignReviewAnchor {
  nodeId?: string;
  point: ReviewAnchorPoint;
}

export interface ResolvedReviewAnchor {
  anchor: DesignReviewAnchor;
  point: ReviewAnchorPoint;
  source: "node" | "point";
}

export function createElementReviewAnchor(input: {
  nodeId?: string | null;
  rect?: { x: number; y: number; width: number; height: number } | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
}): DesignReviewAnchor | null {
  const nodeId = input.nodeId?.trim() ?? "";
  const rect = input.rect;
  const hasRect = Boolean(
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    rect.width > 0 &&
    Number.isFinite(rect.height) &&
    rect.height > 0 &&
    typeof input.viewportWidth === "number" &&
    Number.isFinite(input.viewportWidth) &&
    input.viewportWidth > 0 &&
    typeof input.viewportHeight === "number" &&
    Number.isFinite(input.viewportHeight) &&
    input.viewportHeight > 0,
  );
  if (!nodeId && !hasRect) return null;

  const point = hasRect
    ? {
        xPct:
          finitePercentage(
            (((rect?.x ?? 0) + (rect?.width ?? 0) / 2) /
              (input.viewportWidth as number)) *
              100,
          ) ?? 50,
        yPct:
          finitePercentage(
            (((rect?.y ?? 0) + (rect?.height ?? 0) / 2) /
              (input.viewportHeight as number)) *
              100,
          ) ?? 50,
      }
    : { xPct: 50, yPct: 50 };

  return {
    ...(nodeId ? { nodeId } : {}),
    point,
  };
}

function finitePercentage(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function inBoundsPercentage(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    return null;
  }
  return value;
}

/**
 * Parse the persisted anchor contract used by Design review comments.
 * Malformed anchors intentionally return null so a thread remains visible in
 * the panel without creating a misleading canvas pin.
 */
export function parseReviewAnchor(value: unknown): DesignReviewAnchor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const point =
    record.point &&
    typeof record.point === "object" &&
    !Array.isArray(record.point)
      ? (record.point as Record<string, unknown>)
      : null;
  const xPct = finitePercentage(point?.xPct);
  const yPct = finitePercentage(point?.yPct);
  if (xPct === null || yPct === null) return null;

  const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
  return {
    ...(nodeId ? { nodeId } : {}),
    point: { xPct, yPct },
  };
}

/** Resolve a node-id position first, then degrade to the stored click point. */
export function resolveReviewAnchor(
  value: unknown,
  resolveNodePoint: (nodeId: string) => ReviewAnchorPoint | null,
): ResolvedReviewAnchor | null {
  const anchor = parseReviewAnchor(value);
  if (!anchor) return null;
  if (anchor.nodeId) {
    const nodePoint = resolveNodePoint(anchor.nodeId);
    if (nodePoint) {
      const xPct = inBoundsPercentage(nodePoint.xPct);
      const yPct = inBoundsPercentage(nodePoint.yPct);
      if (xPct !== null && yPct !== null) {
        return {
          anchor,
          point: { xPct, yPct },
          source: "node",
        };
      }
    }
  }
  return { anchor, point: anchor.point, source: "point" };
}
