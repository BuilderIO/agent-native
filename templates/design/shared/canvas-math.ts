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
  rotation?: number;
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
  lockedAxes?: { x?: boolean; y?: boolean };
  stationaryBounds?: FrameBounds[];
}

export type SpacingSnapOptions = CanvasSnapOptions;

export interface DragSnapOptions extends CanvasSnapOptions {
  snapStep?: number;
  proximityRangeScreenPx?: number;
}

export interface ProximityMeasurement {
  orientation: "vertical" | "horizontal";
  gap: number;
  band: DistanceGuideBand;
}

export interface DragSnapResult {
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
  spacingGuides: EqualGapGuide[];
  measurements: ProximityMeasurement[];
}

export interface ResizeSnapOptions extends CanvasSnapOptions {
  preserveAspectRatio?: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizeFromCenter?: boolean;
  snapStep?: number;
}

export interface ResizeFrameOptions {
  preserveAspectRatio?: boolean;
  resizeFromCenter?: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  frameSizeBoundsById?: Record<string, FrameSizeBounds>;
}

export interface FrameSizeBounds {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
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
  square?: boolean;
  fromCenter?: boolean;
}

export interface AlignmentGuide {
  orientation: "vertical" | "horizontal";
  position: number;
  start: number;
  end: number;
}

export interface DistanceGuideBand {
  gapStart: number;
  gapEnd: number;
  crossStart: number;
  crossEnd: number;
}

export interface EqualGapGuide {
  orientation: "vertical" | "horizontal";
  gap: number;
  bands: DistanceGuideBand[];
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

export const DEFAULT_GRID_STEP_PX = 8;

export const WHOLE_PIXEL_SNAP_STEP = 1;

export const DEFAULT_SMALL_NUDGE_PX = 1;
export const DEFAULT_BIG_NUDGE_PX = 10;

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
  bigStep?: number;
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
export const DEFAULT_PROXIMITY_RANGE_SCREEN_PX = 160;
export const DEFAULT_ROTATION_SNAP_DEGREES = 15;
export const DEFAULT_PIXEL_GRID_MIN_ZOOM = 800;
export const MIN_CANVAS_FRAME_WIDTH = 120;
export const MIN_CANVAS_FRAME_HEIGHT = 120;
export const DEFAULT_ASSIGNED_REGION_WIDTH = 1440;
export const DEFAULT_ASSIGNED_REGION_HEIGHT = 1024;
export const DEFAULT_ASSIGNED_REGION_GAP = 320;
export const DEFAULT_ASSIGNED_REGION_MAX_COLUMNS = 3;

/**
 * Zoom range for the MultiScreenCanvas overview surface (wheel/pinch zoom,
 * toolbar/keyboard zoom, pixel-grid threshold). Exported so every zoom-clamp
 * in MultiScreenCanvas.tsx reads from one place instead of a locally
 * redeclared magic number.
 *
 * NOTE: DesignCanvas's own single-screen pinch-zoom currently clamps to a
 * different range (10–500) — that's a separate, pre-existing surface with
 * its own zoom semantics (it also supports device-frame previews at fixed
 * scales) and reconciling the two ranges is intentionally left as a
 * follow-up rather than done here, since DesignCanvas.tsx is out of scope
 * for this fix.
 */
export const DEFAULT_CANVAS_MIN_ZOOM = 2;
export const DEFAULT_CANVAS_MAX_ZOOM = 25600;

export const DEFAULT_CANVAS_AUTOFIT_MIN_ZOOM = 10;

export const CANVAS_FIT_PADDING_PX = 64;

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

export function rotateFrameGroupAroundCenter(
  frames: FrameEntry[],
  groupCenter: CanvasPoint,
  deltaDegrees: number,
): FrameEntry[] {
  return frames.map((frame) => {
    const bounds = getFrameBounds(frame.geometry);
    const originCenter = { x: bounds.centerX, y: bounds.centerY };
    const nextCenter = rotatePoint(originCenter, groupCenter, deltaDegrees);
    const nextRotation = (frame.geometry.rotation ?? 0) + deltaDegrees;
    return {
      id: frame.id,
      geometry: {
        ...frame.geometry,
        x: nextCenter.x - frame.geometry.width / 2,
        y: nextCenter.y - frame.geometry.height / 2,
        rotation: nextRotation,
      },
    };
  });
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

export function getElementWorldBoundsForZoomFit(
  screenGeometry: FrameGeometry,
  localRect: { x: number; y: number; width: number; height: number },
): FrameBounds {
  return getFrameBounds({
    x: screenGeometry.x + localRect.x,
    y: screenGeometry.y + localRect.y,
    width: localRect.width,
    height: localRect.height,
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
      : Math.min(
          maxColumns,
          getWholeNumberAtLeast(options.columns, maxColumns, 1),
        );
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
    paddingScreenPx = CANVAS_FIT_PADDING_PX,
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
  {
    baseStep = DEFAULT_SMALL_NUDGE_PX,
    bigStep = DEFAULT_BIG_NUDGE_PX,
  }: NudgeOptions = {},
): NudgeDelta {
  const step = modifiers.shiftKey ? bigStep : baseStep;
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

export function quantizeToStep(
  value: number,
  step: number = WHOLE_PIXEL_SNAP_STEP,
): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(step) || step <= WHOLE_PIXEL_SNAP_STEP) {
    return Math.round(value);
  }
  return Math.round(value / step) * step;
}

export function quantizeCanvasPoint(
  point: CanvasPoint,
  step: number = WHOLE_PIXEL_SNAP_STEP,
): CanvasPoint {
  return {
    x: quantizeToStep(point.x, step),
    y: quantizeToStep(point.y, step),
  };
}

function quantizeCanvasGeometry<T extends FrameGeometry>(geometry: T): T {
  return {
    ...geometry,
    x: quantizeToStep(geometry.x),
    y: quantizeToStep(geometry.y),
    width: quantizeToStep(geometry.width),
    height: quantizeToStep(geometry.height),
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
    square = false,
    fromCenter = false,
  }: DraftGeometryOptions = {},
): FrameGeometry {
  const centerMultiplier = fromCenter ? 2 : 1;
  let rawWidth = Math.abs(end.x - start.x) * centerMultiplier;
  let rawHeight = Math.abs(end.y - start.y) * centerMultiplier;

  if (square) {
    const side = Math.max(rawWidth, rawHeight);
    rawWidth = side;
    rawHeight = side;
  }

  let width = Math.max(rawWidth || defaultWidth || 0, minWidth);
  let height = Math.max(rawHeight || defaultHeight || 0, minHeight);

  if (square && width !== height) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }

  if (fromCenter) {
    return quantizeCanvasGeometry({
      x: start.x - width / 2,
      y: start.y - height / 2,
      width,
      height,
    });
  }

  const drawingLeft = end.x < start.x;
  const drawingUp = end.y < start.y;

  return quantizeCanvasGeometry({
    x: drawingLeft ? start.x - width : start.x,
    y: drawingUp ? start.y - height : start.y,
    width,
    height,
  });
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

  const threshold = getCanvasSnapThreshold(options);
  const movingBounds = moving.map((entry) =>
    getRotatedFrameAABB(entry.geometry),
  );
  const stationaryBounds =
    options.stationaryBounds ??
    stationary.map((entry) => getRotatedFrameAABB(entry.geometry));

  const dx = options.lockedAxes?.x
    ? null
    : findAxisSnapOffset("x", movingBounds, stationaryBounds, threshold);
  const dy = options.lockedAxes?.y
    ? null
    : findAxisSnapOffset("y", movingBounds, stationaryBounds, threshold);

  const snappedBounds = movingBounds.map((bounds) =>
    translateBounds(bounds, dx ?? 0, dy ?? 0),
  );

  return {
    dx: dx ?? 0,
    dy: dy ?? 0,
    guides: [
      ...(options.lockedAxes?.x
        ? []
        : buildAxisGuides("x", snappedBounds, stationaryBounds)),
      ...(options.lockedAxes?.y
        ? []
        : buildAxisGuides("y", snappedBounds, stationaryBounds)),
    ],
  };
}

export function computeSpacingSnap(
  moving: FrameGeometry,
  stationary: FrameEntry[],
  options: SpacingSnapOptions,
): {
  dx: number;
  dy: number;
  guides: EqualGapGuide[];
  movedAxes?: { x: boolean; y: boolean };
} {
  if (options.bypass) return { dx: 0, dy: 0, guides: [] };

  const tolerance = getCanvasSnapThreshold(options);
  const spacingMatchTolerance = getCanvasSnapThreshold({
    ...options,
    thresholdScreenPx: SPACING_MATCH_SCREEN_PX,
  });
  const bounds = getRotatedFrameAABB(moving);
  const stationaryBounds =
    options.stationaryBounds ??
    stationary.map((entry) => getRotatedFrameAABB(entry.geometry));

  const idle = { offset: 0, side: null } as const;
  const x = options.lockedAxes?.x
    ? idle
    : findSpacingSnapOffset("x", bounds, stationaryBounds, tolerance);
  const y = options.lockedAxes?.y
    ? idle
    : findSpacingSnapOffset("y", bounds, stationaryBounds, tolerance);

  const snapped = translateBounds(bounds, x.offset, y.offset);
  return {
    dx: x.offset,
    dy: y.offset,
    guides: [
      ...(options.lockedAxes?.x
        ? []
        : buildSpacingGuides(
            "x",
            snapped,
            stationaryBounds,
            spacingMatchTolerance,
            x.side,
          )),
      ...(options.lockedAxes?.y
        ? []
        : buildSpacingGuides(
            "y",
            snapped,
            stationaryBounds,
            spacingMatchTolerance,
            y.side,
          )),
    ],
    movedAxes: { x: x.offset !== 0, y: y.offset !== 0 },
  };
}

export function computeProximityMeasurements(
  moving: FrameGeometry,
  stationary: FrameEntry[],
  options: {
    zoom: number;
    rangeScreenPx?: number;
    bypass?: boolean;
    stationaryBounds?: FrameBounds[];
  },
): ProximityMeasurement[] {
  if (options.bypass) return [];
  const range =
    (options.rangeScreenPx ?? DEFAULT_PROXIMITY_RANGE_SCREEN_PX) /
    getCameraScale(options.zoom);
  const bounds = getRotatedFrameAABB(moving);
  const stationaryBounds =
    options.stationaryBounds ??
    stationary.map((entry) => getRotatedFrameAABB(entry.geometry));

  const measurements: ProximityMeasurement[] = [];
  for (const axis of ["x", "y"] as const) {
    const candidates = collectAxisGapCandidates(axis, bounds, stationaryBounds);
    const nearest = candidates.reduce<GapCandidate | null>(
      (best, candidate) =>
        !best || candidate.gap < best.gap ? candidate : best,
      null,
    );
    if (!nearest || nearest.gap > range) continue;
    measurements.push({
      orientation: axis === "x" ? "vertical" : "horizontal",
      gap: nearest.gap,
      band: gapCandidateBand(nearest),
    });
  }
  return measurements;
}

export function computeDragSnap(
  moving: FrameEntry[],
  stationary: FrameEntry[],
  options: DragSnapOptions,
): DragSnapResult {
  const stationaryBounds = stationary.map((entry) =>
    getRotatedFrameAABB(entry.geometry),
  );
  const alignment = computeMoveSnap(moving, stationary, {
    ...options,
    stationaryBounds,
  });
  const claimedX = alignment.guides.some((g) => g.orientation === "vertical");
  const claimedY = alignment.guides.some((g) => g.orientation === "horizontal");

  const single = moving.length === 1 ? moving[0] : null;
  const spacing = single
    ? computeSpacingSnap(
        {
          ...single.geometry,
          x: single.geometry.x + alignment.dx,
          y: single.geometry.y + alignment.dy,
        },
        stationary,
        {
          zoom: options.zoom,
          bypass: options.bypass,
          thresholdScreenPx: options.thresholdScreenPx,
          stationaryBounds,
          lockedAxes: {
            x: claimedX || options.lockedAxes?.x,
            y: claimedY || options.lockedAxes?.y,
          },
        },
      )
    : {
        dx: 0,
        dy: 0,
        guides: [] as EqualGapGuide[],
        movedAxes: { x: false, y: false },
      };

  let dx = alignment.dx + spacing.dx;
  let dy = alignment.dy + spacing.dy;

  const anchor = moving[0];
  const snapStep = options.snapStep ?? 0;
  if (snapStep > 0 && anchor && !options.bypass) {
    const claimed = (orientation: "vertical" | "horizontal") =>
      alignment.guides.some((g) => g.orientation === orientation) ||
      spacing.guides.some((g) => g.orientation === orientation) ||
      (orientation === "vertical"
        ? spacing.movedAxes?.x
        : spacing.movedAxes?.y);
    if (!claimed("vertical") && !options.lockedAxes?.x) {
      dx = quantizeToStep(anchor.geometry.x + dx, snapStep) - anchor.geometry.x;
    }
    if (!claimed("horizontal") && !options.lockedAxes?.y) {
      dy = quantizeToStep(anchor.geometry.y + dy, snapStep) - anchor.geometry.y;
    }
  }

  const settled = single
    ? {
        ...single.geometry,
        x: single.geometry.x + dx,
        y: single.geometry.y + dy,
      }
    : null;
  const measurements = settled
    ? computeProximityMeasurements(settled, stationary, {
        zoom: options.zoom,
        rangeScreenPx: options.proximityRangeScreenPx,
        bypass: options.bypass,
        stationaryBounds,
      }).filter(
        (measurement) =>
          !spacing.guides.some(
            (guide) => guide.orientation === measurement.orientation,
          ),
      )
    : [];

  return {
    dx,
    dy,
    guides: alignment.guides,
    spacingGuides: spacing.guides,
    measurements,
  };
}

interface GapCandidate {
  side: "before" | "after";
  gap: number;
  gapStart: number;
  gapEnd: number;
  crossStart: number;
  crossEnd: number;
}

function collectAxisGapCandidates(
  axis: "x" | "y",
  movingBounds: FrameBounds,
  stationary: FrameBounds[],
): GapCandidate[] {
  const candidates: GapCandidate[] = [];
  for (const bounds of stationary) {
    if (!crossAxisOverlaps(axis, bounds, movingBounds)) continue;

    const crossStart = Math.max(
      getCrossStart(bounds, axis),
      getCrossStart(movingBounds, axis),
    );
    const crossEnd = Math.min(
      getCrossEnd(bounds, axis),
      getCrossEnd(movingBounds, axis),
    );

    if (getAxisEnd(bounds, axis) <= getAxisStart(movingBounds, axis)) {
      candidates.push({
        side: "before",
        gap: getAxisStart(movingBounds, axis) - getAxisEnd(bounds, axis),
        gapStart: getAxisEnd(bounds, axis),
        gapEnd: getAxisStart(movingBounds, axis),
        crossStart,
        crossEnd,
      });
    } else if (getAxisStart(bounds, axis) >= getAxisEnd(movingBounds, axis)) {
      candidates.push({
        side: "after",
        gap: getAxisStart(bounds, axis) - getAxisEnd(movingBounds, axis),
        gapStart: getAxisEnd(movingBounds, axis),
        gapEnd: getAxisStart(bounds, axis),
        crossStart,
        crossEnd,
      });
    }
  }
  return candidates;
}

function closestGapCandidate(
  candidates: GapCandidate[],
  side: "before" | "after",
): GapCandidate | null {
  return candidates.reduce<GapCandidate | null>(
    (best, candidate) =>
      candidate.side === side && (!best || candidate.gap < best.gap)
        ? candidate
        : best,
    null,
  );
}

function gapCandidateBand(candidate: GapCandidate): DistanceGuideBand {
  return {
    gapStart: candidate.gapStart,
    gapEnd: candidate.gapEnd,
    crossStart: candidate.crossStart,
    crossEnd: candidate.crossEnd,
  };
}

function buildEqualGapPair(
  axis: "x" | "y",
  movingBounds: FrameBounds,
  stationary: FrameBounds[],
  toleranceCanvasPx: number,
): EqualGapGuide[] {
  const candidates = collectAxisGapCandidates(axis, movingBounds, stationary);
  const before = closestGapCandidate(candidates, "before");
  const after = closestGapCandidate(candidates, "after");
  if (!before || !after) return [];
  if (Math.abs(before.gap - after.gap) > toleranceCanvasPx) return [];
  return [
    {
      orientation: axis === "x" ? "vertical" : "horizontal",
      gap: (before.gap + after.gap) / 2,
      bands: [gapCandidateBand(before), gapCandidateBand(after)],
    },
  ];
}

function matchingRhythmBands(
  rhythms: { gap: number; band: DistanceGuideBand }[],
  gap: number,
  tolerance: number,
): DistanceGuideBand[] {
  return rhythms
    .filter((rhythm) => Math.abs(rhythm.gap - gap) <= tolerance)
    .map((rhythm) => rhythm.band);
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

  const minWidth = options.minWidth ?? MIN_CANVAS_FRAME_WIDTH;
  const minHeight = options.minHeight ?? MIN_CANVAS_FRAME_HEIGHT;
  const maxWidth = Math.max(
    minWidth,
    options.maxWidth ?? Number.POSITIVE_INFINITY,
  );
  const maxHeight = Math.max(
    minHeight,
    options.maxHeight ?? Number.POSITIVE_INFINITY,
  );
  const allowFlipWidth = minWidth < MIN_CANVAS_FRAME_WIDTH;
  const allowFlipHeight = minHeight < MIN_CANVAS_FRAME_HEIGHT;

  const rawWidth = width;
  const rawHeight = height;
  const widthMagnitude = allowFlipWidth ? Math.abs(rawWidth) : rawWidth;
  const heightMagnitude = allowFlipHeight ? Math.abs(rawHeight) : rawHeight;
  const widthFlipped =
    allowFlipWidth &&
    affectsHorizontal &&
    !options.resizeFromCenter &&
    rawWidth < 0;
  const heightFlipped =
    allowFlipHeight &&
    affectsVertical &&
    !options.resizeFromCenter &&
    rawHeight < 0;

  width = Math.min(maxWidth, Math.max(minWidth, widthMagnitude));
  height = Math.min(maxHeight, Math.max(minHeight, heightMagnitude));

  if (options.preserveAspectRatio) {
    const widthAtLimit = width !== widthMagnitude;
    const heightAtLimit = height !== heightMagnitude;
    if (widthAtLimit && !heightAtLimit) {
      height = Math.min(maxHeight, Math.max(minHeight, width / ratio));
    } else if (heightAtLimit && !widthAtLimit) {
      width = Math.min(maxWidth, Math.max(minWidth, height * ratio));
    } else if (widthAtLimit && heightAtLimit) {
      height = width / ratio;
    }
  }

  return {
    ...origin,
    x: widthFlipped
      ? getFlippedAxisStart(
          origin.x,
          origin.width,
          rawWidth,
          width,
          handleAffectsWest(handle),
        )
      : getResizedAxisStart(
          origin.x,
          origin.width,
          width,
          handleAffectsWest(handle),
          handleAffectsEast(handle),
          options.resizeFromCenter ||
            (!affectsHorizontal && width !== origin.width),
        ),
    y: heightFlipped
      ? getFlippedAxisStart(
          origin.y,
          origin.height,
          rawHeight,
          height,
          handleAffectsNorth(handle),
        )
      : getResizedAxisStart(
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
  const limits = getFrameGroupSizeBounds(frames, originGeometry, options);
  const bounds = resizeFrameFromDelta(originGeometry, handle, dx, dy, {
    ...options,
    minWidth: limits.minWidth,
    minHeight: limits.minHeight,
    maxWidth: limits.maxWidth,
    maxHeight: limits.maxHeight,
  });

  return {
    bounds,
    frames: resizeFrameGroupToBounds(frames, originGeometry, bounds),
  };
}

export function getFrameGroupSizeBounds(
  frames: FrameEntry[],
  originBounds: FrameBounds | FrameGeometry,
  options: ResizeFrameOptions = {},
): Required<Pick<FrameSizeBounds, "minWidth" | "minHeight">> &
  Pick<FrameSizeBounds, "maxWidth" | "maxHeight"> {
  const originGeometry = getBoundsGeometry(originBounds);
  const minimumWidth = frames.reduce((best, frame) => {
    const minimum =
      options.frameSizeBoundsById?.[frame.id]?.minWidth ??
      options.minWidth ??
      MIN_CANVAS_FRAME_WIDTH;
    return Math.max(
      best,
      originGeometry.width * (minimum / Math.max(1, frame.geometry.width)),
    );
  }, options.minWidth ?? MIN_CANVAS_FRAME_WIDTH);
  const minimumHeight = frames.reduce((best, frame) => {
    const minimum =
      options.frameSizeBoundsById?.[frame.id]?.minHeight ??
      options.minHeight ??
      MIN_CANVAS_FRAME_HEIGHT;
    return Math.max(
      best,
      originGeometry.height * (minimum / Math.max(1, frame.geometry.height)),
    );
  }, options.minHeight ?? MIN_CANVAS_FRAME_HEIGHT);
  const maximumWidth = frames.reduce((best, frame) => {
    const maximum =
      options.frameSizeBoundsById?.[frame.id]?.maxWidth ?? options.maxWidth;
    return maximum == null
      ? best
      : Math.min(
          best,
          originGeometry.width * (maximum / Math.max(1, frame.geometry.width)),
        );
  }, Number.POSITIVE_INFINITY);
  const maximumHeight = frames.reduce((best, frame) => {
    const maximum =
      options.frameSizeBoundsById?.[frame.id]?.maxHeight ?? options.maxHeight;
    return maximum == null
      ? best
      : Math.min(
          best,
          originGeometry.height *
            (maximum / Math.max(1, frame.geometry.height)),
        );
  }, Number.POSITIVE_INFINITY);
  return {
    minWidth: minimumWidth,
    minHeight: minimumHeight,
    maxWidth: Math.max(minimumWidth, maximumWidth),
    maxHeight: Math.max(minimumHeight, maximumHeight),
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

export function rotatePoint(
  point: CanvasPoint,
  center: CanvasPoint,
  degrees: number,
): CanvasPoint {
  if (!degrees) return point;
  const rad = (degrees * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function rotateVector(
  vector: CanvasPoint,
  degrees: number,
): CanvasPoint {
  if (!degrees) return vector;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  };
}

export function getRotatedFrameCorners(
  geometry: FrameGeometry,
): [CanvasPoint, CanvasPoint, CanvasPoint, CanvasPoint] {
  const bounds = getFrameBounds(geometry);
  const center = { x: bounds.centerX, y: bounds.centerY };
  const degrees = geometry.rotation ?? 0;
  const corners: CanvasPoint[] = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ];
  return corners.map((corner) => rotatePoint(corner, center, degrees)) as [
    CanvasPoint,
    CanvasPoint,
    CanvasPoint,
    CanvasPoint,
  ];
}

export function getRotatedFrameAABB(geometry: FrameGeometry): FrameBounds {
  const degrees = geometry.rotation ?? 0;
  if (!degrees) return getFrameBounds(geometry);
  const corners = getRotatedFrameCorners(geometry);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return getFrameBounds({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export interface AxisRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AxisBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rotatedRectIntersects(
  rect: AxisRect,
  bounds: AxisBounds,
  center: CanvasPoint = {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  },
  degrees = 0,
): boolean {
  const rectCorners: CanvasPoint[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];

  if (!degrees) {
    return (
      rect.x <= bounds.right &&
      rect.x + rect.width >= bounds.left &&
      rect.y <= bounds.bottom &&
      rect.y + rect.height >= bounds.top
    );
  }

  const boundsCorners: CanvasPoint[] = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ].map((corner) => rotatePoint(corner, center, degrees));
  const rad = (degrees * Math.PI) / 180;
  const axes: CanvasPoint[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: Math.cos(rad), y: Math.sin(rad) },
    { x: -Math.sin(rad), y: Math.cos(rad) },
  ];

  return axes.every((axis) =>
    projectionsOverlap(rectCorners, boundsCorners, axis),
  );
}

function projectionsOverlap(
  a: readonly CanvasPoint[],
  b: readonly CanvasPoint[],
  axis: CanvasPoint,
): boolean {
  const projectionA = a.map((point) => point.x * axis.x + point.y * axis.y);
  const projectionB = b.map((point) => point.x * axis.x + point.y * axis.y);
  const minA = Math.min(...projectionA);
  const maxA = Math.max(...projectionA);
  const minB = Math.min(...projectionB);
  const maxB = Math.max(...projectionB);
  return minA <= maxB && minB <= maxA;
}

function reanchorRotatedResizeToWorld(
  origin: FrameGeometry,
  handle: ResizeHandle,
  degrees: number,
  resizedLocal: FrameGeometry,
  options: Pick<ResizeFrameOptions, "resizeFromCenter">,
): FrameGeometry {
  const originCenter = {
    x: origin.x + origin.width / 2,
    y: origin.y + origin.height / 2,
  };
  const anchorLocalBefore = options.resizeFromCenter
    ? originCenter
    : getResizeAnchorPoint(origin, handle);
  const anchorWorld = rotatePoint(anchorLocalBefore, originCenter, degrees);

  const centerAfterLocal = {
    x: resizedLocal.x + resizedLocal.width / 2,
    y: resizedLocal.y + resizedLocal.height / 2,
  };
  const anchorLocalAfter = options.resizeFromCenter
    ? centerAfterLocal
    : getResizeAnchorPoint(resizedLocal, handle);
  const anchorWorldIfUntranslated = rotatePoint(
    anchorLocalAfter,
    centerAfterLocal,
    degrees,
  );
  const translation = {
    x: anchorWorld.x - anchorWorldIfUntranslated.x,
    y: anchorWorld.y - anchorWorldIfUntranslated.y,
  };

  return {
    ...resizedLocal,
    x: resizedLocal.x + translation.x,
    y: resizedLocal.y + translation.y,
    rotation: degrees,
  };
}

export function resizeRotatedFrameFromDelta(
  origin: FrameGeometry,
  handle: ResizeHandle,
  worldDx: number,
  worldDy: number,
  options: ResizeFrameOptions = {},
): FrameGeometry {
  const degrees = origin.rotation ?? 0;
  if (!degrees) {
    return resizeFrameFromDelta(origin, handle, worldDx, worldDy, options);
  }

  const localDelta = rotateVector({ x: worldDx, y: worldDy }, -degrees);

  const resizedLocal = resizeFrameFromDelta(
    { ...origin, rotation: undefined },
    handle,
    localDelta.x,
    localDelta.y,
    options,
  );

  return reanchorRotatedResizeToWorld(
    origin,
    handle,
    degrees,
    resizedLocal,
    options,
  );
}

const RESIZE_HANDLES_CLOCKWISE: readonly ResizeHandle[] = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
];

function rotateHandleByQuadrants(
  handle: ResizeHandle,
  quadrants: number,
): ResizeHandle {
  const index = RESIZE_HANDLES_CLOCKWISE.indexOf(handle);
  return RESIZE_HANDLES_CLOCKWISE[(index + 2 * ((quadrants % 4) + 4)) % 8]!;
}

const ROTATED_RESIZE_SNAP_MAX_OFF_AXIS_DEGREES = 30;

export function resizeRotatedFrameFromDeltaWithSnap(
  origin: FrameGeometry,
  handle: ResizeHandle,
  worldDx: number,
  worldDy: number,
  stationary: FrameEntry[],
  snapOptions: ResizeSnapOptions,
  options: ResizeFrameOptions = {},
): { frame: FrameGeometry; guides: AlignmentGuide[] } {
  const degrees = origin.rotation ?? 0;
  if (!degrees) {
    const resizedLocal = resizeFrameFromDelta(
      origin,
      handle,
      worldDx,
      worldDy,
      options,
    );
    return computeResizeSnap(resizedLocal, stationary, handle, snapOptions);
  }

  const localDelta = rotateVector({ x: worldDx, y: worldDy }, -degrees);

  const resizedLocal = resizeFrameFromDelta(
    { ...origin, rotation: undefined },
    handle,
    localDelta.x,
    localDelta.y,
    options,
  );

  if (snapOptions.preserveAspectRatio || snapOptions.bypass) {
    return {
      frame: reanchorRotatedResizeToWorld(
        origin,
        handle,
        degrees,
        resizedLocal,
        options,
      ),
      guides: [],
    };
  }

  const unsnapped = reanchorRotatedResizeToWorld(
    origin,
    handle,
    degrees,
    resizedLocal,
    options,
  );

  const normalizedDegrees = ((degrees % 360) + 360) % 360;
  const nearestQuadrant = Math.round(normalizedDegrees / 90) % 4;
  const offAxisDegrees = Math.abs(
    normalizedDegrees - Math.round(normalizedDegrees / 90) * 90,
  );
  if (offAxisDegrees > ROTATED_RESIZE_SNAP_MAX_OFF_AXIS_DEGREES) {
    return { frame: unsnapped, guides: [] };
  }

  const worldHandle = rotateHandleByQuadrants(handle, nearestQuadrant);
  const aabb = getRotatedFrameAABB(unsnapped);
  const worldBox: FrameGeometry = {
    x: aabb.left,
    y: aabb.top,
    width: aabb.width,
    height: aabb.height,
  };
  const worldSnapOptions =
    nearestQuadrant % 2 === 1
      ? {
          ...snapOptions,
          minWidth: snapOptions.minHeight,
          minHeight: snapOptions.minWidth,
          maxWidth: snapOptions.maxHeight,
          maxHeight: snapOptions.maxWidth,
        }
      : snapOptions;

  const snap = computeResizeSnap(
    worldBox,
    stationary,
    worldHandle,
    worldSnapOptions,
  );
  if (snap.guides.length === 0) {
    return { frame: unsnapped, guides: [] };
  }

  const snapDx = handleAffectsEast(worldHandle)
    ? snap.frame.x + snap.frame.width - (worldBox.x + worldBox.width)
    : handleAffectsWest(worldHandle)
      ? snap.frame.x - worldBox.x
      : 0;
  const snapDy = handleAffectsSouth(worldHandle)
    ? snap.frame.y + snap.frame.height - (worldBox.y + worldBox.height)
    : handleAffectsNorth(worldHandle)
      ? snap.frame.y - worldBox.y
      : 0;

  return {
    frame: resizeRotatedFrameFromDelta(
      origin,
      handle,
      worldDx + snapDx,
      worldDy + snapDy,
      options,
    ),
    guides: snap.guides,
  };
}

function getResizeAnchorPoint(
  geometry: FrameGeometry,
  handle: ResizeHandle,
): CanvasPoint {
  const bounds = getFrameBounds(geometry);
  const x = handleAffectsWest(handle)
    ? bounds.right
    : handleAffectsEast(handle)
      ? bounds.left
      : bounds.centerX;
  const y = handleAffectsNorth(handle)
    ? bounds.bottom
    : handleAffectsSouth(handle)
      ? bounds.top
      : bounds.centerY;
  return { x, y };
}

const RESIZE_HANDLE_ANGLES: Record<ResizeHandle, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

const RESIZE_CURSOR_BY_QUADRANT = [
  "ew-resize",
  "nwse-resize",
  "ns-resize",
  "nesw-resize",
] as const;

export function getResizeCursorForHandle(
  handle: ResizeHandle,
  rotationDeg = 0,
): string {
  const angle = RESIZE_HANDLE_ANGLES[handle] + rotationDeg;
  const normalized = ((angle % 360) + 360) % 360;
  const quantized = Math.round(normalized / 45) % 8;
  return RESIZE_CURSOR_BY_QUADRANT[quantized % 4];
}

export function computeResizeSnap(
  frame: FrameGeometry,
  stationary: FrameEntry[],
  handle: ResizeHandle,
  options: ResizeSnapOptions,
) {
  if (options.bypass) {
    return { frame, guides: [] as AlignmentGuide[] };
  }

  const threshold = getCanvasSnapThreshold(options);
  const sizeLimits: FrameSizeLimits = {
    minWidth: options.minWidth ?? MIN_CANVAS_FRAME_WIDTH,
    minHeight: options.minHeight ?? MIN_CANVAS_FRAME_HEIGHT,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    resizeFromCenter: options.resizeFromCenter,
  };

  if (options.preserveAspectRatio) {
    const aspect = computeAspectPreservingResizeSnap(
      frame,
      stationary,
      handle,
      threshold,
      sizeLimits,
    );
    const snappedFrame = clampFrameSize(
      applyResizeSnapStep(aspect.frame, aspect.guides, options, true),
      handle,
      maximumOnlyFrameSizeLimits(sizeLimits),
    );
    const guides = guidesMatchingResizedEdges(
      snappedFrame,
      handle,
      aspect.guides,
    );
    return {
      frame: snappedFrame,
      guides,
    };
  }

  let nextFrame = frame;
  const guides: AlignmentGuide[] = [];

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
        sizeLimits,
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
        sizeLimits,
      );
      guides.push(candidate.guide);
    }
  }

  const snappedFrame = clampFrameSize(
    applyResizeSnapStep(nextFrame, guides, options, false),
    handle,
    maximumOnlyFrameSizeLimits(sizeLimits),
  );
  return {
    frame: snappedFrame,
    guides: guidesMatchingResizedEdges(snappedFrame, handle, guides),
  };
}

function maximumOnlyFrameSizeLimits(
  sizeLimits: FrameSizeLimits,
): FrameSizeLimits {
  return {
    minWidth: 0,
    minHeight: 0,
    maxWidth: sizeLimits.maxWidth,
    maxHeight: sizeLimits.maxHeight,
    resizeFromCenter: sizeLimits.resizeFromCenter,
  };
}

function guidesMatchingResizedEdges(
  frame: FrameGeometry,
  handle: ResizeHandle,
  guides: AlignmentGuide[],
): AlignmentGuide[] {
  return guides.filter((guide) => {
    const edge =
      guide.orientation === "vertical"
        ? handleAffectsWest(handle)
          ? frame.x
          : frame.x + frame.width
        : handleAffectsNorth(handle)
          ? frame.y
          : frame.y + frame.height;
    return Math.abs(edge - guide.position) <= SNAP_ALIGN_EPSILON;
  });
}

function applyResizeSnapStep(
  frame: FrameGeometry,
  guides: readonly AlignmentGuide[],
  options: ResizeSnapOptions,
  aspectLocked: boolean,
): FrameGeometry {
  const step = options.snapStep ?? 0;
  if (step <= 0) return frame;
  const claimedX = guides.some((guide) => guide.orientation === "vertical");
  const claimedY = guides.some((guide) => guide.orientation === "horizontal");
  return {
    ...frame,
    x: claimedX ? frame.x : quantizeToStep(frame.x, step),
    y: claimedY ? frame.y : quantizeToStep(frame.y, step),
    width:
      claimedX || aspectLocked
        ? frame.width
        : quantizeToStep(frame.width, step),
    height:
      claimedY || aspectLocked
        ? frame.height
        : quantizeToStep(frame.height, step),
  };
}


export interface Transform3DParts {
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  perspective: number;
}

const TRANSFORM_3D_ALL_ZERO: Transform3DParts = {
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  perspective: 0,
};

function matchTransformFn(
  transform: string,
  fnName: string,
): { value: number; unit: string } | null {
  const pattern = new RegExp(
    `${fnName}\\(\\s*([+-]?[\\d.]+(?:e[+-]?\\d+)?)([a-z%]*)\\s*\\)`,
    "i",
  );
  const match = transform.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (match[2] || "").toLowerCase() };
}

function angleFnToDegrees(transform: string, fnName: string): number | null {
  const found = matchTransformFn(transform, fnName);
  if (!found) return null;
  const { value, unit } = found;
  if (unit === "" || unit === "deg") return value;
  if (unit === "rad") return value * (180 / Math.PI);
  if (unit === "turn") return value * 360;
  if (unit === "grad") return value * 0.9;
  return null;
}

/**
 * Parses the 3D rotation + perspective portion of a CSS `transform` string
 * into plain degree/px numbers, ignoring any translate()/scale()/skew()
 * parts that may also be present (those are preserved separately by the
 * caller — see `composeTransform3D`).
 *
 * Returns `null` — rather than a best-effort guess — when the transform
 * contains a `matrix()`/`matrix3d()`/`rotate3d()` composite or any other
 * token this parser doesn't recognize, so callers can show a "custom
 * transform" state instead of silently misreporting angles (matches how
 * the 2D rotation field's `parseRotationValue` falls back to reading the
 * resolved matrix for *display*, but 3D composition from an arbitrary
 * matrix is not safely invertible into independent X/Y/Z/perspective
 * fields, so this parser intentionally does not attempt it).
 */
export function parseTransform3DParts(
  transform: string | undefined,
): Transform3DParts | null {
  const value = transform?.trim();
  if (!value || value === "none") return { ...TRANSFORM_3D_ALL_ZERO };

  if (/matrix3d\(|matrix\(|rotate3d\(/i.test(value)) return null;

  const rotateX = angleFnToDegrees(value, "rotateX") ?? 0;
  const rotateY = angleFnToDegrees(value, "rotateY") ?? 0;
  const rotateZ =
    angleFnToDegrees(value, "rotateZ") ??
    angleFnToDegrees(value, "rotate") ??
    0;

  const perspectiveMatch = matchTransformFn(value, "perspective");
  let perspective = 0;
  if (perspectiveMatch) {
    if (perspectiveMatch.unit !== "" && perspectiveMatch.unit !== "px") {
      return null;
    }
    perspective = perspectiveMatch.value;
  }

  return { rotateX, rotateY, rotateZ, perspective };
}

export function composeTransform3D(
  transform: string | undefined,
  parts: Transform3DParts,
): string {
  const base = !transform || transform === "none" ? "" : transform;
  const stripped = base
    .replace(/perspective\([^)]*\)/gi, "")
    .replace(/rotate[XYZxyz]?\([^)]*\)/gi, "")
    .replace(/rotate3d\([^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const rotateX = Number.isFinite(parts.rotateX) ? parts.rotateX : 0;
  const rotateY = Number.isFinite(parts.rotateY) ? parts.rotateY : 0;
  const rotateZ = Number.isFinite(parts.rotateZ) ? parts.rotateZ : 0;
  const perspective =
    Number.isFinite(parts.perspective) && parts.perspective > 0
      ? parts.perspective
      : 0;

  const is3DActive = perspective > 0 || rotateX !== 0 || rotateY !== 0;

  const chainTokens: string[] = [];
  if (is3DActive) {
    if (perspective > 0) chainTokens.push(`perspective(${perspective}px)`);
    if (rotateX !== 0) chainTokens.push(`rotateX(${rotateX}deg)`);
    if (rotateY !== 0) chainTokens.push(`rotateY(${rotateY}deg)`);
    chainTokens.push(`rotateZ(${rotateZ}deg)`);
  } else if (rotateZ !== 0) {
    chainTokens.push(`rotate(${rotateZ}deg)`);
  }

  if (chainTokens.length === 0) return stripped || "none";
  const chain = chainTokens.join(" ");
  return stripped ? `${chain} ${stripped}` : chain;
}

export function isTransform3DActive(parts: Transform3DParts): boolean {
  return parts.perspective > 0 || parts.rotateX !== 0 || parts.rotateY !== 0;
}

function computeAspectPreservingResizeSnap(
  frame: FrameGeometry,
  stationary: FrameEntry[],
  handle: ResizeHandle,
  threshold: number,
  sizeLimits: FrameSizeLimits,
) {
  const ratio = frame.width / Math.max(1, frame.height);
  const xCandidate =
    handleAffectsWest(handle) || handleAffectsEast(handle)
      ? getResizeSnapCandidate("x", frame, stationary, handle, threshold)
      : null;
  const yCandidate =
    handleAffectsNorth(handle) || handleAffectsSouth(handle)
      ? getResizeSnapCandidate("y", frame, stationary, handle, threshold)
      : null;

  if (!xCandidate && !yCandidate) {
    return { frame, guides: [] as AlignmentGuide[] };
  }

  const useX =
    !yCandidate || (xCandidate && xCandidate.distance <= yCandidate.distance);

  const affectsVertical =
    handleAffectsNorth(handle) || handleAffectsSouth(handle);
  const affectsHorizontal =
    handleAffectsWest(handle) || handleAffectsEast(handle);

  if (useX && xCandidate) {
    const snappedX = applyResizeSnapOffset(
      frame,
      handle,
      "x",
      xCandidate.offset,
      sizeLimits,
    );
    const nextHeight = snappedX.width / ratio;
    const rescaled = {
      ...snappedX,
      height: nextHeight,
      y: getResizedAxisStart(
        frame.y,
        frame.height,
        nextHeight,
        handleAffectsNorth(handle),
        handleAffectsSouth(handle),
        !affectsVertical && nextHeight !== frame.height,
      ),
    };
    return { frame: rescaled, guides: [xCandidate.guide] };
  }

  if (yCandidate) {
    const snappedY = applyResizeSnapOffset(
      frame,
      handle,
      "y",
      yCandidate.offset,
      sizeLimits,
    );
    const nextWidth = snappedY.height * ratio;
    const rescaled = {
      ...snappedY,
      width: nextWidth,
      x: getResizedAxisStart(
        frame.x,
        frame.width,
        nextWidth,
        handleAffectsWest(handle),
        handleAffectsEast(handle),
        !affectsHorizontal && nextWidth !== frame.width,
      ),
    };
    return { frame: rescaled, guides: [yCandidate.guide] };
  }

  return { frame, guides: [] as AlignmentGuide[] };
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

function getFlippedAxisStart(
  originStart: number,
  originSize: number,
  rawSize: number,
  nextSize: number,
  affectsStart: boolean,
): number {
  const anchor = affectsStart ? originStart + originSize : originStart;
  const draggedEdge = affectsStart ? anchor - rawSize : anchor + rawSize;
  const start = Math.min(anchor, draggedEdge);
  const rawSpan = Math.abs(draggedEdge - anchor);
  if (nextSize > rawSpan) {
    return anchor < draggedEdge ? anchor - nextSize : anchor;
  }
  return start;
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

const SNAP_ALIGN_EPSILON = 1e-6;
const SPACING_MATCH_SCREEN_PX = 0.5;

function getAxisSnapValues(bounds: FrameBounds, axis: "x" | "y") {
  return axis === "x"
    ? [bounds.left, bounds.centerX, bounds.right]
    : [bounds.top, bounds.centerY, bounds.bottom];
}

function getAxisStart(bounds: FrameBounds, axis: "x" | "y") {
  return axis === "x" ? bounds.left : bounds.top;
}

function getAxisEnd(bounds: FrameBounds, axis: "x" | "y") {
  return axis === "x" ? bounds.right : bounds.bottom;
}

function getCrossStart(bounds: FrameBounds, axis: "x" | "y") {
  return axis === "x" ? bounds.top : bounds.left;
}

function getCrossEnd(bounds: FrameBounds, axis: "x" | "y") {
  return axis === "x" ? bounds.bottom : bounds.right;
}

function crossAxisOverlaps(
  axis: "x" | "y",
  a: FrameBounds,
  b: FrameBounds,
): boolean {
  return (
    getCrossStart(a, axis) < getCrossEnd(b, axis) &&
    getCrossEnd(a, axis) > getCrossStart(b, axis)
  );
}

function translateBounds(
  bounds: FrameBounds,
  dx: number,
  dy: number,
): FrameBounds {
  return {
    left: bounds.left + dx,
    right: bounds.right + dx,
    centerX: bounds.centerX + dx,
    top: bounds.top + dy,
    bottom: bounds.bottom + dy,
    centerY: bounds.centerY + dy,
    width: bounds.width,
    height: bounds.height,
  };
}

function findAxisSnapOffset(
  axis: "x" | "y",
  moving: FrameBounds[],
  stationary: FrameBounds[],
  threshold: number,
): number | null {
  let offset: number | null = null;
  let bestDistance = Infinity;
  for (const movingBounds of moving) {
    for (const movingValue of getAxisSnapValues(movingBounds, axis)) {
      for (const stationaryBounds of stationary) {
        for (const stationaryValue of getAxisSnapValues(
          stationaryBounds,
          axis,
        )) {
          const candidate = stationaryValue - movingValue;
          const distance = Math.abs(candidate);
          if (distance > threshold || distance >= bestDistance) continue;
          bestDistance = distance;
          offset = candidate;
        }
      }
    }
  }
  return offset;
}

function buildAxisGuides(
  axis: "x" | "y",
  moving: FrameBounds[],
  stationary: FrameBounds[],
): AlignmentGuide[] {
  const spans = new Map<number, { start: number; end: number }>();
  for (const movingBounds of moving) {
    for (const movingValue of getAxisSnapValues(movingBounds, axis)) {
      for (const stationaryBounds of stationary) {
        for (const stationaryValue of getAxisSnapValues(
          stationaryBounds,
          axis,
        )) {
          if (Math.abs(stationaryValue - movingValue) > SNAP_ALIGN_EPSILON) {
            continue;
          }
          const existing = spans.get(stationaryValue);
          const start = Math.min(
            existing?.start ?? Infinity,
            getCrossStart(movingBounds, axis),
            getCrossStart(stationaryBounds, axis),
          );
          const end = Math.max(
            existing?.end ?? -Infinity,
            getCrossEnd(movingBounds, axis),
            getCrossEnd(stationaryBounds, axis),
          );
          spans.set(stationaryValue, { start, end });
        }
      }
    }
  }

  const orientation = axis === "x" ? "vertical" : "horizontal";
  return Array.from(spans, ([position, span]) => ({
    orientation,
    position,
    start: span.start,
    end: span.end,
  })) as AlignmentGuide[];
}

function collectRhythmGaps(
  axis: "x" | "y",
  movingBounds: FrameBounds,
  stationary: FrameBounds[],
): { gap: number; band: DistanceGuideBand }[] {
  const row = stationary
    .filter(
      (bounds) =>
        crossAxisOverlaps(axis, bounds, movingBounds) &&
        !(
          getAxisStart(bounds, axis) <= getAxisStart(movingBounds, axis) &&
          getAxisEnd(bounds, axis) >= getAxisEnd(movingBounds, axis)
        ),
    )
    .sort((a, b) => getAxisStart(a, axis) - getAxisStart(b, axis));

  const gaps: { gap: number; band: DistanceGuideBand }[] = [];
  let previous: FrameBounds | null = null;
  for (const bounds of row) {
    const gap = previous
      ? getAxisStart(bounds, axis) - getAxisEnd(previous, axis)
      : 0;
    if (previous && gap > 0 && crossAxisOverlaps(axis, previous, bounds)) {
      gaps.push({
        gap,
        band: {
          gapStart: getAxisEnd(previous, axis),
          gapEnd: getAxisStart(bounds, axis),
          crossStart: Math.max(
            getCrossStart(previous, axis),
            getCrossStart(bounds, axis),
          ),
          crossEnd: Math.min(
            getCrossEnd(previous, axis),
            getCrossEnd(bounds, axis),
          ),
        },
      });
    }
    if (!previous || getAxisEnd(bounds, axis) > getAxisEnd(previous, axis)) {
      previous = bounds;
    }
  }
  return gaps;
}

function findSpacingSnapOffset(
  axis: "x" | "y",
  movingBounds: FrameBounds,
  stationary: FrameBounds[],
  tolerance: number,
): { offset: number; side: "before" | "after" | "both" | null } {
  const candidates = collectAxisGapCandidates(axis, movingBounds, stationary);
  const before = closestGapCandidate(candidates, "before");
  const after = closestGapCandidate(candidates, "after");
  if (!before && !after) return { offset: 0, side: null };

  let offset = 0;
  let side: "before" | "after" | "both" | null = null;
  let bestDistance = Infinity;
  const consider = (value: number, matched: "before" | "after" | "both") => {
    const distance = Math.abs(value);
    if (distance > tolerance || distance >= bestDistance) return;
    bestDistance = distance;
    offset = value;
    side = matched;
  };

  if (before && after) consider((after.gap - before.gap) / 2, "both");
  for (const rhythm of collectRhythmGaps(axis, movingBounds, stationary)) {
    if (before) consider(rhythm.gap - before.gap, "before");
    if (after) consider(after.gap - rhythm.gap, "after");
  }
  return { offset, side };
}

function buildSpacingGuides(
  axis: "x" | "y",
  movingBounds: FrameBounds,
  stationary: FrameBounds[],
  tolerance: number,
  matchedSide?: "before" | "after" | "both" | null,
): EqualGapGuide[] {
  const rhythms = collectRhythmGaps(axis, movingBounds, stationary);
  const pair = buildEqualGapPair(axis, movingBounds, stationary, tolerance);
  if (pair.length) {
    const guide = pair[0];
    return [
      {
        ...guide,
        bands: [
          ...guide.bands,
          ...matchingRhythmBands(rhythms, guide.gap, tolerance),
        ],
      },
    ];
  }

  const candidates = collectAxisGapCandidates(axis, movingBounds, stationary);
  const neighbor =
    matchedSide === "after"
      ? closestGapCandidate(candidates, "after")
      : matchedSide === "before"
        ? closestGapCandidate(candidates, "before")
        : (closestGapCandidate(candidates, "before") ??
          closestGapCandidate(candidates, "after"));
  if (!neighbor) return [];

  const matched = matchingRhythmBands(rhythms, neighbor.gap, tolerance);
  if (!matched.length) return [];
  return [
    {
      orientation: axis === "x" ? "vertical" : "horizontal",
      gap: neighbor.gap,
      bands: [gapCandidateBand(neighbor), ...matched],
    },
  ];
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
    const stationaryBounds = getRotatedFrameAABB(entry.geometry);
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

interface FrameSizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
  resizeFromCenter?: boolean;
}

function applyResizeSnapOffset(
  frame: FrameGeometry,
  handle: ResizeHandle,
  axis: "x" | "y",
  offset: number,
  sizeLimits: FrameSizeLimits = {
    minWidth: MIN_CANVAS_FRAME_WIDTH,
    minHeight: MIN_CANVAS_FRAME_HEIGHT,
  },
) {
  if (axis === "x") {
    return clampFrameSize(
      handleAffectsWest(handle)
        ? { ...frame, x: frame.x + offset, width: frame.width - offset }
        : { ...frame, width: frame.width + offset },
      handle,
      sizeLimits,
    );
  }

  return clampFrameSize(
    handleAffectsNorth(handle)
      ? { ...frame, y: frame.y + offset, height: frame.height - offset }
      : { ...frame, height: frame.height + offset },
    handle,
    sizeLimits,
  );
}

function clampFrameSize(
  frame: FrameGeometry,
  handle: ResizeHandle,
  {
    minWidth = MIN_CANVAS_FRAME_WIDTH,
    minHeight = MIN_CANVAS_FRAME_HEIGHT,
    maxWidth,
    maxHeight,
    resizeFromCenter = false,
  }: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    resizeFromCenter?: boolean;
  } = {},
) {
  let next = { ...frame };
  if (next.width < minWidth) {
    if (handleAffectsWest(handle)) {
      next.x = next.x + next.width - minWidth;
    } else if (resizeFromCenter) {
      next.x -= (minWidth - next.width) / 2;
    }
    next.width = minWidth;
  }
  if (maxWidth != null && next.width > maxWidth) {
    if (handleAffectsWest(handle)) {
      next.x = next.x + next.width - maxWidth;
    } else if (resizeFromCenter) {
      next.x += (next.width - maxWidth) / 2;
    }
    next.width = maxWidth;
  }
  if (next.height < minHeight) {
    if (handleAffectsNorth(handle)) {
      next.y = next.y + next.height - minHeight;
    } else if (resizeFromCenter) {
      next.y -= (minHeight - next.height) / 2;
    }
    next.height = minHeight;
  }
  if (maxHeight != null && next.height > maxHeight) {
    if (handleAffectsNorth(handle)) {
      next.y = next.y + next.height - maxHeight;
    } else if (resizeFromCenter) {
      next.y += (next.height - maxHeight) / 2;
    }
    next.height = maxHeight;
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
