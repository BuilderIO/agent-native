export interface ReviewAnchorPoint {
  xPct: number;
  yPct: number;
}

export interface ReviewAnchorRegion {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface ReviewBoardGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReviewAnchorWorldPoint {
  x: number;
  y: number;
}

export interface ReviewCanvasPoint {
  x: number;
  y: number;
}

export interface ReviewAnchorWorldRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignReviewAnchor {
  nodeId?: string;
  selector?: string;
  screenId?: string;
  screenPoint?: ReviewAnchorPoint;
  point: ReviewAnchorPoint;
  relativePoint?: ReviewAnchorPoint;
  region?: ReviewAnchorRegion;
  worldPoint?: ReviewAnchorWorldPoint;
  worldRegion?: ReviewAnchorWorldRegion;
  canvasPoint?: ReviewCanvasPoint;
}

export interface ResolvedReviewAnchor {
  anchor: DesignReviewAnchor;
  point: ReviewAnchorPoint;
  source: "node" | "selector" | "point";
}

export function createElementReviewAnchor(input: {
  nodeId?: string | null;
  selector?: string | null;
  rect?: { x: number; y: number; width: number; height: number } | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
}): DesignReviewAnchor | null {
  const nodeId = input.nodeId?.trim() ?? "";
  const selector = input.selector?.trim() ?? "";
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
  if (!nodeId && !selector && !hasRect) return null;

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
    ...(selector ? { selector } : {}),
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
  const selector =
    typeof record.selector === "string" ? record.selector.trim() : "";
  const screenId =
    typeof record.screenId === "string" ? record.screenId.trim() : "";
  const screenPoint = screenId ? parsePoint(record.screenPoint) : null;
  const relativePoint = parsePoint(record.relativePoint);
  const region = parseRegion(record.region);
  const worldPoint = parseWorldPoint(record.worldPoint);
  const worldRegion = parseWorldRegion(record.worldRegion);
  const canvasPointRecord =
    record.canvasPoint &&
    typeof record.canvasPoint === "object" &&
    !Array.isArray(record.canvasPoint)
      ? (record.canvasPoint as Record<string, unknown>)
      : null;
  const canvasX = canvasPointRecord?.x;
  const canvasY = canvasPointRecord?.y;
  const canvasPoint =
    typeof canvasX === "number" &&
    Number.isFinite(canvasX) &&
    typeof canvasY === "number" &&
    Number.isFinite(canvasY)
      ? { x: canvasX, y: canvasY }
      : undefined;
  return {
    ...(nodeId ? { nodeId } : {}),
    ...(selector ? { selector } : {}),
    ...(screenId && screenPoint ? { screenId, screenPoint } : {}),
    point: { xPct, yPct },
    ...(relativePoint ? { relativePoint } : {}),
    ...(region ? { region } : {}),
    ...(worldPoint ? { worldPoint } : {}),
    ...(worldRegion ? { worldRegion } : {}),
    ...(canvasPoint ? { canvasPoint } : {}),
  };
}

function parsePoint(value: unknown): ReviewAnchorPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as Record<string, unknown>;
  const xPct = finitePercentage(point.xPct);
  const yPct = finitePercentage(point.yPct);
  return xPct === null || yPct === null ? null : { xPct, yPct };
}

function parseWorldPoint(value: unknown): ReviewAnchorWorldPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : null;
}

function parseWorldRegion(value: unknown): ReviewAnchorWorldRegion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const region = value as Record<string, unknown>;
  const values = [region.x, region.y, region.width, region.height];
  if (
    !values.every((item) => typeof item === "number" && Number.isFinite(item))
  )
    return null;
  if ((region.width as number) <= 0 || (region.height as number) <= 0)
    return null;
  return {
    x: region.x as number,
    y: region.y as number,
    width: region.width as number,
    height: region.height as number,
  };
}

function parseRegion(value: unknown): ReviewAnchorRegion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const region = value as Record<string, unknown>;
  const xPct = finitePercentage(region.xPct);
  const yPct = finitePercentage(region.yPct);
  const widthPct = finitePercentage(region.widthPct);
  const heightPct = finitePercentage(region.heightPct);
  if (
    xPct === null ||
    yPct === null ||
    widthPct === null ||
    heightPct === null ||
    xPct + widthPct > 100 ||
    yPct + heightPct > 100 ||
    widthPct <= 0 ||
    heightPct <= 0
  ) {
    return null;
  }
  return { xPct, yPct, widthPct, heightPct };
}

export function resolveReviewAnchor(
  value: unknown,
  resolveNodePoint: (nodeId: string) => ReviewAnchorPoint | null,
  resolveSelectorPoint: (selector: string) => ReviewAnchorPoint | null = () =>
    null,
  screenId?: string | null,
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
  if (anchor.selector) {
    const selectorPoint = resolveSelectorPoint(anchor.selector);
    if (selectorPoint) {
      const xPct = inBoundsPercentage(selectorPoint.xPct);
      const yPct = inBoundsPercentage(selectorPoint.yPct);
      if (xPct !== null && yPct !== null) {
        return {
          anchor,
          point: { xPct, yPct },
          source: "selector",
        };
      }
    }
  }
  const point =
    screenId && anchor.screenId === screenId && anchor.screenPoint
      ? anchor.screenPoint
      : anchor.point;
  return { anchor, point, source: "point" };
}
