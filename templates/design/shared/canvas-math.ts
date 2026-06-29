export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface FrameGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameEntry {
  id: string;
  geometry: FrameGeometry;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type FrameBoundsInput = FrameEntry | FrameGeometry;

export interface FrameBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface AssignedCanvasRegion extends FrameGeometry {
  index: number;
  row: number;
  column: number;
}

export interface AssignRegionsOptions {
  origin?: CanvasPoint;
  regionSize?: CanvasSize;
  gap?: number;
  columns?: number;
  maxColumns?: number;
}

export interface CanvasSnapOptions {
  thresholdScreenPx?: number;
  zoom: number;
  bypass?: boolean;
}

export interface ResizeFrameOptions {
  preserveAspectRatio?: boolean;
  resizeFromCenter?: boolean;
  minWidth?: number;
  minHeight?: number;
}

export interface ResizeGroupResult {
  bounds: FrameGeometry;
  frames: FrameEntry[];
}

export interface DraftGeometryOptions {
  minWidth?: number;
  minHeight?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}

export interface AlignmentGuide {
  orientation: "vertical" | "horizontal";
  position: number;
  start: number;
  end: number;
}

export interface RotateFrameMetadata {
  id: string;
  geometry: FrameGeometry;
  center: CanvasPoint;
  startAngle: number;
  initialRotation: number;
}

export interface RotateFrameResult {
  id: string;
  angle: number;
  rawAngle: number;
  delta: number;
  snapped: boolean;
}

export interface RotationSnapOptions {
  shiftKey?: boolean;
  incrementDegrees?: number;
}

export interface FitViewportOptions {
  paddingScreenPx?: number;
  canvasPadding?: number;
  minZoom?: number;
  maxZoom?: number;
  fallbackZoom?: number;
}

export interface RulerTick {
  value: number;
  position: number;
  label: string;
}

export interface RulerTicks {
  x: RulerTick[];
  y: RulerTick[];
}

export interface RulerTickOptions {
  minTickSpacingPx?: number;
  canvasPadding?: number;
  maxTicks?: number;
}

export type ArrowNudgeKey =
  | "ArrowUp"
  | "ArrowRight"
  | "ArrowDown"
  | "ArrowLeft";

export interface NudgeModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface NudgeOptions {
  baseStep?: number;
  shiftMultiplier?: number;
}

export interface NudgeDelta {
  dx: number;
  dy: number;
  step: number;
  snap: {
    bypass: boolean;
    reason: "modifier" | null;
  };
}

interface SnapCandidate {
  distance: number;
  offset: number;
  guide: AlignmentGuide;
}

export const DEFAULT_SNAP_THRESHOLD_SCREEN_PX = 6;
export const DEFAULT_ROTATION_SNAP_DEGREES = 15;
export const DEFAULT_PIXEL_GRID_MIN_ZOOM = 800;
export const MIN_CANVAS_FRAME_WIDTH = 120;
export const MIN_CANVAS_FRAME_HEIGHT = 120;
export const DEFAULT_ASSIGNED_REGION_WIDTH = 1440;
export const DEFAULT_ASSIGNED_REGION_HEIGHT = 1024;
export const DEFAULT_ASSIGNED_REGION_GAP = 320;
export const DEFAULT_ASSIGNED_REGION_MAX_COLUMNS = 3;

export function screenToCanvasPoint(
  point: CanvasPoint,
  camera: CanvasCamera,
  surfaceOrigin: CanvasPoint = { x: 0, y: 0 },
  padding = 0,
  round = false,
): CanvasPoint {
  const scale = camera.zoom / 100;
  if (scale === 0) return { x: 0, y: 0 };
  const next = {
    x: (point.x - surfaceOrigin.x - camera.x) / scale - padding,
    y: (point.y - surfaceOrigin.y - camera.y) / scale - padding,
  };
  return round ? { x: Math.round(next.x), y: Math.round(next.y) } : next;
}

export function canvasToScreenPoint(
  point: CanvasPoint,
  camera: CanvasCamera,
  surfaceOrigin: CanvasPoint = { x: 0, y: 0 },
  padding = 0,
): CanvasPoint {
  const scale = camera.zoom / 100;
  return {
    x: surfaceOrigin.x + camera.x + (point.x + padding) * scale,
    y: surfaceOrigin.y + camera.y + (point.y + padding) * scale,
  };
}

export function getPanForZoomToCursor({
  pan,
  cursor,
  oldZoom,
  nextZoom,
}: {
  pan: CanvasPoint;
  cursor: CanvasPoint;
  oldZoom: number;
  nextZoom: number;
}): CanvasPoint {
  const ratio = nextZoom / oldZoom;
  return {
    x: cursor.x - (cursor.x - pan.x) * ratio,
    y: cursor.y - (cursor.y - pan.y) * ratio,
  };
}

export function getAngleFromCenter(
  center: CanvasPoint,
  point: CanvasPoint,
): number {
  return radiansToDegrees(Math.atan2(point.y - center.y, point.x - center.x));
}

export function getAngleDeltaDegrees(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function snapAngleToIncrement(
  angle: number,
  {
    shiftKey = false,
    incrementDegrees = DEFAULT_ROTATION_SNAP_DEGREES,
  }: RotationSnapOptions = {},
): number {
  if (!shiftKey || incrementDegrees <= 0) return angle;
  return Math.round(angle / incrementDegrees) * incrementDegrees;
}

export function getRotateFrameMetadata(
  entry: FrameEntry,
  pointer: CanvasPoint,
  {
    center,
    initialRotation = 0,
  }: { center?: CanvasPoint; initialRotation?: number } = {},
): RotateFrameMetadata {
  const bounds = getFrameBounds(entry.geometry);
  const rotationCenter = center ?? { x: bounds.centerX, y: bounds.centerY };
  return {
    id: entry.id,
    geometry: entry.geometry,
    center: rotationCenter,
    startAngle: getAngleFromCenter(rotationCenter, pointer),
    initialRotation,
  };
}

export function getRotatedFrameAngle(
  metadata: RotateFrameMetadata,
  pointer: CanvasPoint,
  options: RotationSnapOptions = {},
): RotateFrameResult {
  const currentAngle = getAngleFromCenter(metadata.center, pointer);
  const delta = getAngleDeltaDegrees(metadata.startAngle, currentAngle);
  const rawAngle = metadata.initialRotation + delta;
  const angle = snapAngleToIncrement(rawAngle, options);
  const incrementDegrees =
    options.incrementDegrees ?? DEFAULT_ROTATION_SNAP_DEGREES;
  return {
    id: metadata.id,
    angle,
    rawAngle,
    delta,
    snapped: !!options.shiftKey && incrementDegrees > 0,
  };
}

export function getFrameBounds(geometry: FrameGeometry): FrameBounds {
  const width = geometry.width;
  const height = geometry.height;
  return {
    left: geometry.x,
    top: geometry.y,
    right: geometry.x + width,
    bottom: geometry.y + height,
    width,
    height,
    centerX: geometry.x + width / 2,
    centerY: geometry.y + height / 2,
  };
}

export function getFrameGroupBounds(
  frames: readonly FrameBoundsInput[],
): FrameBounds | null {
  if (frames.length === 0) return null;

  const bounds = frames.map((frame) => getFrameBounds(getFrameGeometry(frame)));
  const left = Math.min(...bounds.map((bound) => bound.left));
  const top = Math.min(...bounds.map((bound) => bound.top));
  const right = Math.max(...bounds.map((bound) => bound.right));
  const bottom = Math.max(...bounds.map((bound) => bound.bottom));
  return getFrameBounds({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export function assignRegions(
  count: number,
  options: AssignRegionsOptions = {},
): AssignedCanvasRegion[] {
  if (!Number.isFinite(count) || count <= 0) return [];

  const total = Math.floor(count);
  const origin = options.origin ?? { x: 0, y: 0 };
  const width = getPositiveFiniteNumber(
    options.regionSize?.width,
    DEFAULT_ASSIGNED_REGION_WIDTH,
  );
  const height = getPositiveFiniteNumber(
    options.regionSize?.height,
    DEFAULT_ASSIGNED_REGION_HEIGHT,
  );
  const gap = Math.max(
    0,
    getFiniteNumber(options.gap, DEFAULT_ASSIGNED_REGION_GAP),
  );
  const maxColumns = getWholeNumberAtLeast(
    options.maxColumns,
    DEFAULT_ASSIGNED_REGION_MAX_COLUMNS,
    1,
  );
  const requestedColumns =
    options.columns == null
      ? maxColumns
      : getWholeNumberAtLeast(options.columns, maxColumns, 1);
  const columns = Math.min(total, requestedColumns);

  return Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return {
      index,
      row,
      column,
      x: origin.x + column * (width + gap),
      y: origin.y + row * (height + gap),
      width,
      height,
    };
  });
}

export function getCameraForBounds(
  bounds: FrameBounds | FrameGeometry | null,
  viewport: CanvasSize,
  {
    paddingScreenPx = 48,
    canvasPadding = 0,
    minZoom = 10,
    maxZoom = 400,
    fallbackZoom = 100,
  }: FitViewportOptions = {},
): CanvasCamera {
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) {
    return { x: 0, y: 0, zoom: fallbackZoom };
  }

  const geometry = getBoundsGeometry(bounds);
  const availableWidth = Math.max(1, viewport.width - paddingScreenPx * 2);
  const availableHeight = Math.max(1, viewport.height - paddingScreenPx * 2);
  const scale = Math.min(
    availableWidth / Math.max(1, geometry.width),
    availableHeight / Math.max(1, geometry.height),
  );
  const zoom = clamp(scale * 100, minZoom, maxZoom);
  const nextScale = zoom / 100;

  return {
    x:
      (viewport.width - geometry.width * nextScale) / 2 -
      (geometry.x + canvasPadding) * nextScale,
    y:
      (viewport.height - geometry.height * nextScale) / 2 -
      (geometry.y + canvasPadding) * nextScale,
    zoom,
  };
}

export function getRulerTicks(
  camera: CanvasCamera,
  viewport: CanvasSize,
  options: RulerTickOptions = {},
): RulerTicks {
  return {
    x: getAxisRulerTicks("x", camera, viewport.width, options),
    y: getAxisRulerTicks("y", camera, viewport.height, options),
  };
}

export function shouldShowPixelGrid(
  zoom: number,
  minZoom = DEFAULT_PIXEL_GRID_MIN_ZOOM,
): boolean {
  return zoom >= minZoom;
}

export function getNudgeDelta(
  key: ArrowNudgeKey,
  modifiers: NudgeModifiers = {},
  { baseStep = 1, shiftMultiplier = 10 }: NudgeOptions = {},
): NudgeDelta {
  const step = baseStep * (modifiers.shiftKey ? shiftMultiplier : 1);
  const vector = getNudgeVector(key);
  const bypass = !!(modifiers.altKey || modifiers.metaKey || modifiers.ctrlKey);

  return {
    dx: vector.x * step,
    dy: vector.y * step,
    step,
    snap: {
      bypass,
      reason: bypass ? "modifier" : null,
    },
  };
}

export function getDraftGeometryFromPoints(
  start: CanvasPoint,
  end: CanvasPoint,
  {
    minWidth = 1,
    minHeight = 1,
    defaultWidth,
    defaultHeight,
  }: DraftGeometryOptions = {},
): FrameGeometry {
  const rawWidth = Math.abs(end.x - start.x);
  const rawHeight = Math.abs(end.y - start.y);
  const width = Math.max(rawWidth || defaultWidth || 0, minWidth);
  const height = Math.max(rawHeight || defaultHeight || 0, minHeight);
  const drawingLeft = end.x < start.x;
  const drawingUp = end.y < start.y;

  return {
    x: drawingLeft ? start.x - width : start.x,
    y: drawingUp ? start.y - height : start.y,
    width,
    height,
  };
}

export function appendPolylinePoint(
  points: readonly CanvasPoint[],
  nextPoint: CanvasPoint,
  minDistance = 4,
): CanvasPoint[] {
  const previous = points[points.length - 1];
  if (!previous) return [nextPoint];
  if (
    Math.hypot(nextPoint.x - previous.x, nextPoint.y - previous.y) < minDistance
  ) {
    return [...points];
  }
  return [...points, nextPoint];
}

export function computeMoveSnap(
  moving: FrameEntry[],
  stationary: FrameEntry[],
  options: CanvasSnapOptions,
) {
  if (options.bypass) {
    return { dx: 0, dy: 0, guides: [] as AlignmentGuide[] };
  }

  let bestX: SnapCandidate | null = null;
  let bestY: SnapCandidate | null = null;
  const threshold = getCanvasSnapThreshold(options);
  const stationaryBounds = stationary.map((entry) => ({
    ...entry,
    bounds: getFrameBounds(entry.geometry),
  }));

  for (const entry of moving) {
    const movingBounds = getFrameBounds(entry.geometry);
    for (const stationaryEntry of stationaryBounds) {
      bestX = getBestCandidate(
        bestX,
        getAxisSnapCandidates(
          "x",
          movingBounds,
          stationaryEntry.bounds,
          threshold,
        ),
      );
      bestY = getBestCandidate(
        bestY,
        getAxisSnapCandidates(
          "y",
          movingBounds,
          stationaryEntry.bounds,
          threshold,
        ),
      );
    }
  }

  return {
    dx: bestX?.offset ?? 0,
    dy: bestY?.offset ?? 0,
    guides: [bestX?.guide, bestY?.guide].filter(Boolean) as AlignmentGuide[],
  };
}

export function resizeFrameFromDelta(
  origin: FrameGeometry,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: ResizeFrameOptions = {},
) {
  const ratio = origin.width / Math.max(1, origin.height);
  const affectsHorizontal =
    handleAffectsWest(handle) || handleAffectsEast(handle);
  const affectsVertical =
    handleAffectsNorth(handle) || handleAffectsSouth(handle);
  const horizontalDelta = handleAffectsWest(handle) ? -dx : dx;
  const verticalDelta = handleAffectsNorth(handle) ? -dy : dy;
  let width = affectsHorizontal
    ? origin.width + horizontalDelta * (options.resizeFromCenter ? 2 : 1)
    : origin.width;
  let height = affectsVertical
    ? origin.height + verticalDelta * (options.resizeFromCenter ? 2 : 1)
    : origin.height;

  if (options.preserveAspectRatio) {
    if (affectsHorizontal && affectsVertical) {
      const widthChange = Math.abs(width - origin.width);
      const heightChange = Math.abs(height - origin.height);
      if (widthChange >= heightChange) {
        height = width / ratio;
      } else {
        width = height * ratio;
      }
    } else if (affectsHorizontal) {
      height = width / ratio;
    } else if (affectsVertical) {
      width = height * ratio;
    }
  }

  width = Math.max(options.minWidth ?? MIN_CANVAS_FRAME_WIDTH, width);
  height = Math.max(options.minHeight ?? MIN_CANVAS_FRAME_HEIGHT, height);

  return {
    ...origin,
    x: getResizedAxisStart(
      origin.x,
      origin.width,
      width,
      handleAffectsWest(handle),
      handleAffectsEast(handle),
      options.resizeFromCenter ||
        (!affectsHorizontal && width !== origin.width),
    ),
    y: getResizedAxisStart(
      origin.y,
      origin.height,
      height,
      handleAffectsNorth(handle),
      handleAffectsSouth(handle),
      options.resizeFromCenter ||
        (!affectsVertical && height !== origin.height),
    ),
    width,
    height,
  };
}

export function resizeFrameGroupFromDelta(
  frames: FrameEntry[],
  originBounds: FrameBounds | FrameGeometry,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: ResizeFrameOptions = {},
): ResizeGroupResult {
  const originGeometry = getBoundsGeometry(originBounds);
  const minimums = getGroupMinimumBounds(frames, originGeometry, options);
  const bounds = resizeFrameFromDelta(originGeometry, handle, dx, dy, {
    ...options,
    minWidth: minimums.width,
    minHeight: minimums.height,
  });

  return {
    bounds,
    frames: resizeFrameGroupToBounds(frames, originGeometry, bounds),
  };
}

export function resizeFrameGroupToBounds(
  frames: FrameEntry[],
  originBounds: FrameBounds | FrameGeometry,
  nextBounds: FrameBounds | FrameGeometry,
): FrameEntry[] {
  const originGeometry = getBoundsGeometry(originBounds);
  const nextGeometry = getBoundsGeometry(nextBounds);
  const scaleX = nextGeometry.width / Math.max(1, originGeometry.width);
  const scaleY = nextGeometry.height / Math.max(1, originGeometry.height);

  return frames.map((frame) => ({
    id: frame.id,
    geometry: {
      x: nextGeometry.x + (frame.geometry.x - originGeometry.x) * scaleX,
      y: nextGeometry.y + (frame.geometry.y - originGeometry.y) * scaleY,
      width: frame.geometry.width * scaleX,
      height: frame.geometry.height * scaleY,
    },
  }));
}

export function computeResizeSnap(
  frame: FrameGeometry,
  stationary: FrameEntry[],
  handle: ResizeHandle,
  options: CanvasSnapOptions,
) {
  if (options.bypass) {
    return { frame, guides: [] as AlignmentGuide[] };
  }

  let nextFrame = frame;
  const guides: AlignmentGuide[] = [];
  const threshold = getCanvasSnapThreshold(options);

  if (handleAffectsWest(handle) || handleAffectsEast(handle)) {
    const candidate = getResizeSnapCandidate(
      "x",
      nextFrame,
      stationary,
      handle,
      threshold,
    );
    if (candidate) {
      nextFrame = applyResizeSnapOffset(
        nextFrame,
        handle,
        "x",
        candidate.offset,
      );
      guides.push(candidate.guide);
    }
  }

  if (handleAffectsNorth(handle) || handleAffectsSouth(handle)) {
    const candidate = getResizeSnapCandidate(
      "y",
      nextFrame,
      stationary,
      handle,
      threshold,
    );
    if (candidate) {
      nextFrame = applyResizeSnapOffset(
        nextFrame,
        handle,
        "y",
        candidate.offset,
      );
      guides.push(candidate.guide);
    }
  }

  return { frame: nextFrame, guides };
}

function getResizedAxisStart(
  originStart: number,
  originSize: number,
  nextSize: number,
  affectsStart: boolean,
  affectsEnd: boolean,
  fromCenter: boolean,
) {
  if (fromCenter && (affectsStart || affectsEnd)) {
    return originStart - (nextSize - originSize) / 2;
  }
  if (fromCenter) return originStart + (originSize - nextSize) / 2;
  if (affectsStart) return originStart + originSize - nextSize;
  return originStart;
}

function getGroupMinimumBounds(
  frames: FrameEntry[],
  originBounds: FrameGeometry,
  options: ResizeFrameOptions,
): CanvasSize {
  const minimumFrameWidth = options.minWidth ?? MIN_CANVAS_FRAME_WIDTH;
  const minimumFrameHeight = options.minHeight ?? MIN_CANVAS_FRAME_HEIGHT;
  const minimumWidth = frames.reduce(
    (best, frame) =>
      Math.max(
        best,
        originBounds.width *
          (minimumFrameWidth / Math.max(1, frame.geometry.width)),
      ),
    minimumFrameWidth,
  );
  const minimumHeight = frames.reduce(
    (best, frame) =>
      Math.max(
        best,
        originBounds.height *
          (minimumFrameHeight / Math.max(1, frame.geometry.height)),
      ),
    minimumFrameHeight,
  );
  return { width: minimumWidth, height: minimumHeight };
}

function getCanvasSnapThreshold({
  thresholdScreenPx = DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
  zoom,
}: {
  thresholdScreenPx?: number;
  zoom: number;
}) {
  const scale = getCameraScale(zoom);
  return thresholdScreenPx / scale;
}

function getAxisSnapCandidates(
  axis: "x" | "y",
  movingBounds: FrameBounds,
  stationaryBounds: FrameBounds,
  threshold: number,
): SnapCandidate[] {
  const movingValues =
    axis === "x"
      ? [movingBounds.left, movingBounds.centerX, movingBounds.right]
      : [movingBounds.top, movingBounds.centerY, movingBounds.bottom];
  const stationaryValues =
    axis === "x"
      ? [
          stationaryBounds.left,
          stationaryBounds.centerX,
          stationaryBounds.right,
        ]
      : [
          stationaryBounds.top,
          stationaryBounds.centerY,
          stationaryBounds.bottom,
        ];

  return movingValues.flatMap((movingValue) =>
    stationaryValues
      .map((stationaryValue) => {
        const offset = stationaryValue - movingValue;
        const distance = Math.abs(offset);
        if (distance > threshold) return null;
        return {
          distance,
          offset,
          guide:
            axis === "x"
              ? getVerticalGuide(
                  stationaryValue,
                  movingBounds,
                  stationaryBounds,
                )
              : getHorizontalGuide(
                  stationaryValue,
                  movingBounds,
                  stationaryBounds,
                ),
        };
      })
      .filter(Boolean),
  ) as SnapCandidate[];
}

function getBestCandidate(
  current: SnapCandidate | null,
  candidates: SnapCandidate[],
) {
  return candidates.reduce<SnapCandidate | null>(
    (best, candidate) =>
      !best || candidate.distance < best.distance ? candidate : best,
    current,
  );
}

function getResizeSnapCandidate(
  axis: "x" | "y",
  frame: FrameGeometry,
  stationary: FrameEntry[],
  handle: ResizeHandle,
  threshold: number,
) {
  const frameBounds = getFrameBounds(frame);
  const sourceValue =
    axis === "x"
      ? handleAffectsWest(handle)
        ? frameBounds.left
        : frameBounds.right
      : handleAffectsNorth(handle)
        ? frameBounds.top
        : frameBounds.bottom;

  return stationary.reduce<SnapCandidate | null>((best, entry) => {
    const stationaryBounds = getFrameBounds(entry.geometry);
    const targetValues =
      axis === "x"
        ? [
            stationaryBounds.left,
            stationaryBounds.centerX,
            stationaryBounds.right,
          ]
        : [
            stationaryBounds.top,
            stationaryBounds.centerY,
            stationaryBounds.bottom,
          ];

    const candidates = targetValues
      .map((targetValue) => {
        const offset = targetValue - sourceValue;
        const distance = Math.abs(offset);
        if (distance > threshold) return null;
        return {
          distance,
          offset,
          guide:
            axis === "x"
              ? getVerticalGuide(targetValue, frameBounds, stationaryBounds)
              : getHorizontalGuide(targetValue, frameBounds, stationaryBounds),
        };
      })
      .filter(Boolean) as SnapCandidate[];

    return getBestCandidate(best, candidates);
  }, null);
}

function applyResizeSnapOffset(
  frame: FrameGeometry,
  handle: ResizeHandle,
  axis: "x" | "y",
  offset: number,
) {
  if (axis === "x") {
    return clampFrameSize(
      handleAffectsWest(handle)
        ? { ...frame, x: frame.x + offset, width: frame.width - offset }
        : { ...frame, width: frame.width + offset },
      handle,
    );
  }

  return clampFrameSize(
    handleAffectsNorth(handle)
      ? { ...frame, y: frame.y + offset, height: frame.height - offset }
      : { ...frame, height: frame.height + offset },
    handle,
  );
}

function clampFrameSize(frame: FrameGeometry, handle: ResizeHandle) {
  let next = { ...frame };
  if (next.width < MIN_CANVAS_FRAME_WIDTH) {
    if (handleAffectsWest(handle)) {
      next.x = next.x + next.width - MIN_CANVAS_FRAME_WIDTH;
    }
    next.width = MIN_CANVAS_FRAME_WIDTH;
  }
  if (next.height < MIN_CANVAS_FRAME_HEIGHT) {
    if (handleAffectsNorth(handle)) {
      next.y = next.y + next.height - MIN_CANVAS_FRAME_HEIGHT;
    }
    next.height = MIN_CANVAS_FRAME_HEIGHT;
  }
  return next;
}

function getVerticalGuide(
  position: number,
  movingBounds: FrameBounds,
  stationaryBounds: FrameBounds,
): AlignmentGuide {
  return {
    orientation: "vertical",
    position,
    start: Math.min(movingBounds.top, stationaryBounds.top),
    end: Math.max(movingBounds.bottom, stationaryBounds.bottom),
  };
}

function getHorizontalGuide(
  position: number,
  movingBounds: FrameBounds,
  stationaryBounds: FrameBounds,
): AlignmentGuide {
  return {
    orientation: "horizontal",
    position,
    start: Math.min(movingBounds.left, stationaryBounds.left),
    end: Math.max(movingBounds.right, stationaryBounds.right),
  };
}

function handleAffectsWest(handle: ResizeHandle) {
  return handle.includes("w");
}

function handleAffectsEast(handle: ResizeHandle) {
  return handle.includes("e");
}

function handleAffectsNorth(handle: ResizeHandle) {
  return handle.includes("n");
}

function handleAffectsSouth(handle: ResizeHandle) {
  return handle.includes("s");
}

function getFrameGeometry(frame: FrameBoundsInput): FrameGeometry {
  return "geometry" in frame ? frame.geometry : frame;
}

function getBoundsGeometry(bounds: FrameBounds | FrameGeometry): FrameGeometry {
  if ("left" in bounds) {
    return {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
  }
  return bounds;
}

function getAxisRulerTicks(
  axis: "x" | "y",
  camera: CanvasCamera,
  viewportLength: number,
  {
    minTickSpacingPx = 64,
    canvasPadding = 0,
    maxTicks = 200,
  }: RulerTickOptions,
): RulerTick[] {
  if (viewportLength <= 0) return [];

  const scale = getCameraScale(camera.zoom);
  const pan = axis === "x" ? camera.x : camera.y;
  const minCanvasStep = minTickSpacingPx / scale;
  const step = getNiceCanvasStep(minCanvasStep);
  const start = -pan / scale - canvasPadding;
  const end = (viewportLength - pan) / scale - canvasPadding;
  const first = Math.ceil(start / step) * step;
  const ticks: RulerTick[] = [];

  for (
    let value = first;
    value <= end + 1e-9 && ticks.length < maxTicks;
    value += step
  ) {
    ticks.push({
      value: normalizeTickValue(value),
      position: pan + (value + canvasPadding) * scale,
      label: formatTickLabel(value, step),
    });
  }

  return ticks;
}

function getNiceCanvasStep(minStep: number): number {
  if (!Number.isFinite(minStep) || minStep <= 0) return 1;

  const magnitude = Math.pow(10, Math.floor(Math.log10(minStep)));
  for (const multiplier of [1, 2, 5, 10]) {
    const step = multiplier * magnitude;
    if (step >= minStep) return step;
  }
  return 10 * magnitude;
}

function formatTickLabel(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.ceil(Math.abs(Math.log10(step)));
  if (decimals === 0) return String(Math.round(normalizeTickValue(value)));
  const label = normalizeTickValue(value)
    .toFixed(decimals)
    .replace(/\.?0+$/, "");
  return label === "" ? "0" : label;
}

function normalizeTickValue(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < 1e-9 ? 0 : value;
}

function getNudgeVector(key: ArrowNudgeKey): CanvasPoint {
  if (key === "ArrowUp") return { x: 0, y: -1 };
  if (key === "ArrowRight") return { x: 1, y: 0 };
  if (key === "ArrowDown") return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function getCameraScale(zoom: number): number {
  return Math.max(0.01, zoom / 100);
}

function getFiniteNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getPositiveFiniteNumber(
  value: number | undefined,
  fallback: number,
): number {
  const next = getFiniteNumber(value, fallback);
  return next > 0 ? next : fallback;
}

function getWholeNumberAtLeast(
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  return Math.max(
    minimum,
    Math.floor(getPositiveFiniteNumber(value, fallback)),
  );
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
