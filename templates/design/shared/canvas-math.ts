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
  /** Rotation in degrees, matching a CSS `rotate(deg)` applied around the
   *  frame's own center. Optional — most geometry helpers here ignore it
   *  unless documented otherwise (see the rotation-aware helpers below). */
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
}

export interface ResizeSnapOptions extends CanvasSnapOptions {
  /** When set, only the single closest-matching axis snap is applied and the
   *  other axis is rescaled to match, so a shift-held aspect-ratio resize
   *  never gets distorted by independently snapping both axes to different
   *  sibling edges. Pass the frame's aspect ratio (width / height) *before*
   *  this resize's own aspect-preserving delta was applied. */
  preserveAspectRatio?: boolean;
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
  /** Constrain to equal width/height (square/circle) while drawing — the
   *  larger of the two dragged dimensions wins, matching Figma's shift-drag
   *  behavior for rect/ellipse tools. */
  square?: boolean;
  /** Draw outward from `start` in both directions (start is the shape's
   *  center) instead of from one corner to the opposite corner. */
  fromCenter?: boolean;
}

export interface AlignmentGuide {
  orientation: "vertical" | "horizontal";
  position: number;
  start: number;
  end: number;
}

/** One equal-spacing "gap band" — the empty space between the moving frame
 *  and one neighboring stationary frame, on a given axis. `crossStart`/
 *  `crossEnd` are the band's extent on the OTHER axis (e.g. for a
 *  horizontal gap, that's the vertical span the tick marks/label should
 *  draw across), matching how `AlignmentGuide.start`/`end` describe a
 *  guide line's own extent. */
export interface DistanceGuideBand {
  gapStart: number;
  gapEnd: number;
  crossStart: number;
  crossEnd: number;
}

/** A pair of equal-sized gaps around the moving frame — Figma's "smart
 *  spacing" indicator: dragging a frame so it's evenly spaced between two
 *  neighbors (or continues an existing rhythm of equally spaced siblings)
 *  highlights both gaps with the shared distance. */
export interface EqualGapGuide {
  orientation: "vertical" | "horizontal";
  /** The shared gap size, in canvas units, both bands agree on. */
  gap: number;
  bands: [DistanceGuideBand, DistanceGuideBand];
}

export interface EqualGapOptions {
  /** How close two gaps must be (in canvas units) to count as "equal". */
  toleranceCanvasPx?: number;
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
export const DEFAULT_CANVAS_MAX_ZOOM = 800;

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

/**
 * Rotates a group of frames together around a single shared pivot (the
 * group's own center), for multi-selection rotate: each frame's own
 * rotation increases by `deltaDegrees` (so it keeps spinning around its own
 * center visually), AND its center orbits `groupCenter` by the same delta,
 * so the whole selection rotates rigidly as one unit rather than each frame
 * spinning in place where it already sits.
 *
 * `frames` must carry each frame's ORIGINAL (drag-start) geometry — this is
 * a pure function of the origin snapshot and the total delta so far, not an
 * incremental transform, matching the convention `resizeFrameGroupFromDelta`
 * already uses for group resize.
 */
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
    square = false,
    fromCenter = false,
  }: DraftGeometryOptions = {},
): FrameGeometry {
  // When drawing from the center, `end` marks one edge/corner of the shape
  // rather than the opposite corner from `start` — the pointer's distance
  // from center is a HALF-extent, so the full width/height is double the
  // raw drag distance.
  const centerMultiplier = fromCenter ? 2 : 1;
  let rawWidth = Math.abs(end.x - start.x) * centerMultiplier;
  let rawHeight = Math.abs(end.y - start.y) * centerMultiplier;

  if (square) {
    // Figma's shift-drag: the larger dragged dimension wins, both axes match
    // it. Preserve each axis's own drag direction (handled below via
    // drawingLeft/drawingUp) — only the magnitude is unified here.
    const side = Math.max(rawWidth, rawHeight);
    rawWidth = side;
    rawHeight = side;
  }

  let width = Math.max(rawWidth || defaultWidth || 0, minWidth);
  let height = Math.max(rawHeight || defaultHeight || 0, minHeight);

  if (square && width !== height) {
    // Zero-drag (a plain click before any movement) falls through to
    // defaultWidth/defaultHeight and minWidth/minHeight independently, which
    // can disagree even though rawWidth/rawHeight were already unified
    // above. Re-unify using the larger side so a square/circle click-to-
    // place still starts out square instead of using mismatched defaults.
    const side = Math.max(width, height);
    width = side;
    height = side;
  }

  if (fromCenter) {
    // `start` is the shape's center — grow outward symmetrically in both
    // directions instead of anchoring one corner at `start`.
    return {
      x: start.x - width / 2,
      y: start.y - height / 2,
      width,
      height,
    };
  }

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
  // Use the rotated (world-space) AABB rather than the unrotated local
  // bounds, so a rotated frame snaps by its visual silhouette instead of an
  // AABB that doesn't match anything on screen.
  const stationaryBounds = stationary.map((entry) => ({
    ...entry,
    bounds: getRotatedFrameAABB(entry.geometry),
  }));

  for (const entry of moving) {
    const movingBounds = getRotatedFrameAABB(entry.geometry);
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

/**
 * Figma-style "smart spacing" guides (CV11): when a single moving frame sits
 * between two stationary neighbors with matching gaps on either side — or
 * continues that same gap on just one side — highlight both gaps with their
 * shared distance. This is purely a *display* aid (unlike computeMoveSnap,
 * it never adjusts the frame's position) so callers should compute it
 * independently of, and after, any snap offset has already been applied to
 * the moving frame's geometry.
 *
 * Only single-frame moves are supported (matching how Figma's own equal-gap
 * guides only appear while dragging one object) — pass the already-resolved
 * single moving frame, not a multi-select group.
 */
export function computeEqualGapGuides(
  moving: FrameGeometry,
  stationary: FrameEntry[],
  { toleranceCanvasPx = 1 }: EqualGapOptions = {},
): EqualGapGuide[] {
  const movingBounds = getRotatedFrameAABB(moving);
  const guides: EqualGapGuide[] = [];

  const horizontal = collectAxisGapCandidates("x", movingBounds, stationary);
  guides.push(...pairUpEqualGaps("vertical", horizontal, toleranceCanvasPx));

  const vertical = collectAxisGapCandidates("y", movingBounds, stationary);
  guides.push(...pairUpEqualGaps("horizontal", vertical, toleranceCanvasPx));

  return guides;
}

interface GapCandidate {
  /** "before" = stationary frame is to the left/above the moving frame;
   *  "after" = to the right/below. */
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
  stationary: FrameEntry[],
): GapCandidate[] {
  const candidates: GapCandidate[] = [];
  for (const entry of stationary) {
    const bounds = getRotatedFrameAABB(entry.geometry);
    // Only frames that overlap the moving frame's extent on the OTHER axis
    // produce a meaningful "gap between them" — otherwise the empty space
    // isn't really a corridor connecting the two shapes.
    const crossOverlaps =
      axis === "x"
        ? bounds.top < movingBounds.bottom && bounds.bottom > movingBounds.top
        : bounds.left < movingBounds.right && bounds.right > movingBounds.left;
    if (!crossOverlaps) continue;

    const crossStart =
      axis === "x"
        ? Math.max(bounds.top, movingBounds.top)
        : Math.max(bounds.left, movingBounds.left);
    const crossEnd =
      axis === "x"
        ? Math.min(bounds.bottom, movingBounds.bottom)
        : Math.min(bounds.right, movingBounds.right);

    if (axis === "x") {
      if (bounds.right <= movingBounds.left) {
        candidates.push({
          side: "before",
          gap: movingBounds.left - bounds.right,
          gapStart: bounds.right,
          gapEnd: movingBounds.left,
          crossStart,
          crossEnd,
        });
      } else if (bounds.left >= movingBounds.right) {
        candidates.push({
          side: "after",
          gap: bounds.left - movingBounds.right,
          gapStart: movingBounds.right,
          gapEnd: bounds.left,
          crossStart,
          crossEnd,
        });
      }
    } else {
      if (bounds.bottom <= movingBounds.top) {
        candidates.push({
          side: "before",
          gap: movingBounds.top - bounds.bottom,
          gapStart: bounds.bottom,
          gapEnd: movingBounds.top,
          crossStart,
          crossEnd,
        });
      } else if (bounds.top >= movingBounds.bottom) {
        candidates.push({
          side: "after",
          gap: bounds.top - movingBounds.bottom,
          gapStart: movingBounds.bottom,
          gapEnd: bounds.top,
          crossStart,
          crossEnd,
        });
      }
    }
  }
  return candidates;
}

function pairUpEqualGaps(
  orientation: "vertical" | "horizontal",
  candidates: GapCandidate[],
  toleranceCanvasPx: number,
): EqualGapGuide[] {
  const before = candidates.filter((c) => c.side === "before");
  const after = candidates.filter((c) => c.side === "after");
  const guides: EqualGapGuide[] = [];

  // Closest gap on each side is the one a user is most likely dragging
  // toward, so only pair the single closest "before" candidate against the
  // single closest "after" candidate — otherwise a busy canvas would surface
  // every combinatorial pair of same-ish gaps at once.
  const closestBefore = before.reduce<GapCandidate | null>(
    (best, c) => (!best || c.gap < best.gap ? c : best),
    null,
  );
  const closestAfter = after.reduce<GapCandidate | null>(
    (best, c) => (!best || c.gap < best.gap ? c : best),
    null,
  );

  if (
    closestBefore &&
    closestAfter &&
    Math.abs(closestBefore.gap - closestAfter.gap) <= toleranceCanvasPx
  ) {
    guides.push({
      orientation,
      gap: (closestBefore.gap + closestAfter.gap) / 2,
      bands: [
        {
          gapStart: closestBefore.gapStart,
          gapEnd: closestBefore.gapEnd,
          crossStart: closestBefore.crossStart,
          crossEnd: closestBefore.crossEnd,
        },
        {
          gapStart: closestAfter.gapStart,
          gapEnd: closestAfter.gapEnd,
          crossStart: closestAfter.crossStart,
          crossEnd: closestAfter.crossEnd,
        },
      ],
    });
  }

  return guides;
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

  const preClampWidth = width;
  const preClampHeight = height;
  width = Math.max(options.minWidth ?? MIN_CANVAS_FRAME_WIDTH, width);
  height = Math.max(options.minHeight ?? MIN_CANVAS_FRAME_HEIGHT, height);

  if (options.preserveAspectRatio) {
    const widthClamped = width > preClampWidth;
    const heightClamped = height > preClampHeight;
    if (widthClamped && !heightClamped) {
      height = width / ratio;
    } else if (heightClamped && !widthClamped) {
      width = height * ratio;
    } else if (widthClamped && heightClamped) {
      // Both axes hit their minimum; width wins as the primary authority
      height = width / ratio;
    }
  }

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

/**
 * Rotates `point` around `center` by `degrees` in the *forward* direction —
 * i.e. the same direction as a CSS `transform: rotate(degrees deg)` applied
 * to an element whose `transform-origin` is `center`. Use this to map a
 * frame-local (unrotated) point into world space.
 *
 * Pass `-degrees` to do the inverse mapping (world space into a frame's local
 * unrotated space).
 */
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

/** Rotates a free vector (no translation component) by `degrees`. Use this to
 *  map a world-space pointer delta into a rotated frame's local axes (pass
 *  `-degrees`), or a local delta back into world space (pass `+degrees`). */
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

/** Returns the four corners of `geometry`'s rotated bounding box, in world
 *  space, in top-left/top-right/bottom-right/bottom-left order. */
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

/** Returns the axis-aligned bounding box that encloses `geometry` after its
 *  rotation is applied — i.e. the world-space AABB of the rotated rect,
 *  rather than the unrotated local rect. Frames with no rotation return their
 *  own bounds unchanged. Use this for snap-candidate generation and marquee
 *  hit-testing against rotated frames instead of the unrotated `FrameBounds`. */
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

/** An axis-aligned rectangle in `{x, y, width, height}` form, as used by a
 *  marquee-selection drag rect. */
export interface AxisRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An axis-aligned bounds rect in `{left, top, right, bottom}` form. */
export interface AxisBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Tests whether an axis-aligned rect (e.g. a marquee-selection drag rect)
 * intersects `bounds` (an unrotated rect) after `bounds` is rotated by
 * `degrees` around `center`.
 *
 * `center` defaults to the center of `bounds` itself — the common case of a
 * single rotated frame. Pass an explicit `center` when `bounds` describes a
 * child element that rotates rigidly with an ancestor frame around the
 * frame's own center rather than its own (e.g. layer-marquee hit-testing
 * against an element inside a rotated screen frame).
 *
 * A corner-containment check alone (only asking "is a corner of A inside B,
 * or a corner of B inside A") misses cases where the two rects cross like a
 * plus/hash sign — each one's edges pierce through the other without either
 * shape's corners landing inside the other, e.g. a thin marquee crossing the
 * middle of a thin rotated frame. This uses the Separating Axis Theorem
 * (SAT): two convex polygons do NOT intersect if and only if there exists an
 * axis (from either polygon's edge normals) onto which their projections
 * don't overlap. For an axis-aligned rect vs. a rotated rect there are
 * exactly 4 candidate axes to test — the rect's own x/y axes, and the
 * rotated rect's two (perpendicular) edge directions.
 */
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
  // The rotated rect's two perpendicular edge directions, plus the axis
  // rect's own x/y axes, are the full set of SAT candidate axes for two
  // rectangles (each rectangle only contributes 2 unique edge normals).
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

/**
 * Resize-aware transform for a single rotated frame, so dragging a resize
 * handle behaves the way it looks: the handle direction follows the frame's
 * own rotated axes, and the opposite anchor edge/corner stays visually fixed
 * in world space (not just in unrotated local space).
 *
 * `worldDx`/`worldDy` are the raw pointer delta in world (canvas) space, the
 * same values `resizeFrameFromDelta` normally takes directly. This wrapper:
 *  1. Rotates the world delta into the frame's local (unrotated) axes.
 *  2. Runs the existing unrotated `resizeFrameFromDelta` in that local space.
 *  3. Re-anchors the result so the corner/edge the handle keeps fixed in
 *     local space also stays fixed in world space, by translating the new
 *     geometry so its own rotation (around its own new center) reproduces the
 *     original world-space anchor point.
 *
 * For `origin.rotation` falsy this is identical to calling
 * `resizeFrameFromDelta` directly.
 */
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

  const originCenter = {
    x: origin.x + origin.width / 2,
    y: origin.y + origin.height / 2,
  };
  // Alt/option resize (`resizeFromCenter`) already grows the frame
  // symmetrically about its own center in LOCAL space (resizeFrameFromDelta
  // below keeps the center fixed on both axes for that mode). To keep that
  // center fixed in WORLD space too — matching Figma, where alt-resizing a
  // rotated frame grows around its visual center rather than pivoting off an
  // opposite corner — the re-anchor step below must use the center as its
  // fixed point instead of the handle's opposite corner/edge. Using the
  // center as the anchor is a no-op for the rotation (a point rotates around
  // itself unchanged), so it stays put in world space by construction.
  // Non-center (default) resizes keep anchoring on the opposite corner/edge
  // so that world-fixed-anchor behavior is unchanged.
  const anchorLocalBefore = options.resizeFromCenter
    ? originCenter
    : getResizeAnchorPoint(origin, handle);
  const anchorWorld = rotatePoint(anchorLocalBefore, originCenter, degrees);

  // Map the world-space pointer delta into the frame's own unrotated axes so
  // dragging "outward along the handle" behaves the same regardless of how
  // the frame is rotated.
  const localDelta = rotateVector({ x: worldDx, y: worldDy }, -degrees);

  const resizedLocal = resizeFrameFromDelta(
    { ...origin, rotation: undefined },
    handle,
    localDelta.x,
    localDelta.y,
    options,
  );

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

/** The local (unrotated) point that a given resize handle keeps fixed: the
 *  edge/corner opposite the handle, or the center of an axis the handle
 *  doesn't affect at all (e.g. "n" leaves the horizontal axis untouched). */
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

/** Unrotated visual angle of each resize handle, in degrees, matching CSS
 *  cursor convention (0 = east/right, increasing clockwise since canvas y
 *  grows downward) — "e" points right, "se" points down-right, etc. */
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

/**
 * Returns the resize cursor for `handle` on a frame rotated by `rotationDeg`
 * degrees, so the cursor always matches how the handle actually looks and
 * moves on screen instead of a static per-handle cursor that's only correct
 * when the frame isn't rotated.
 *
 * Cursor CSS only offers 4 distinct resize cursors, each valid across a pair
 * of opposite directions (`ew-resize` covers both due east and due west).
 * This adds the handle's own unrotated angle to the frame's rotation and
 * quantizes to the nearest 45 degrees to pick which of the 4 to use.
 */
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

  if (options.preserveAspectRatio) {
    return computeAspectPreservingResizeSnap(
      frame,
      stationary,
      handle,
      threshold,
    );
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

/**
 * Aspect-ratio-safe variant of the independent-axis snap above. Snapping x
 * and y independently can each pull toward a different sibling edge, which
 * distorts a shift-held (aspect-locked) resize away from its ratio. Instead:
 * evaluate both axes' snap candidates, apply only the single closest one,
 * then rescale the other axis from `frame`'s own aspect ratio so the shape
 * stays locked to it.
 */
function computeAspectPreservingResizeSnap(
  frame: FrameGeometry,
  stationary: FrameEntry[],
  handle: ResizeHandle,
  threshold: number,
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
    );
    const nextHeight = snappedX.width / ratio;
    // Matches resizeFrameFromDelta's own convention: when a handle that
    // doesn't touch the vertical axis (e.g. "e") grows height only because
    // aspect-ratio derives it, that growth is centered vertically rather
    // than anchored to the original y.
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
    // Rotated (world-space) AABB, not the unrotated local bounds, so
    // resizing snaps against a rotated sibling's visual silhouette.
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
