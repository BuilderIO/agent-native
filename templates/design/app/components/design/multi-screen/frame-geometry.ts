import { DEVICE_FRAME_VIEWPORTS, type DeviceFrameType } from "../types";
import { SURFACE_PADDING } from "./overview-layout";
import type { FrameGeometry, FrameGeometryById, Point } from "./types";

const SCREEN_WIDTH = 320;
const SCREEN_GAP = 56;
const FRAME_LABEL_HEIGHT = 28;

export interface BoundsRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ScreenViewportSize {
  width: number;
  height: number;
}

export function getBreakpointFrameGeometry(args: {
  widthPx: number;
  naturalAspect: number;
  primaryScale: number;
}): {
  frameWidth: number;
  frameHeight: number;
  naturalHeight: number;
  scale: number;
} {
  const scale =
    Number.isFinite(args.primaryScale) && args.primaryScale > 0
      ? args.primaryScale
      : 1;
  const naturalHeight = Math.round(
    args.widthPx * Math.max(0.01, args.naturalAspect),
  );
  const frameWidth = Math.round(args.widthPx * scale);
  const frameHeight = Math.round(naturalHeight * scale);
  return { frameWidth, frameHeight, naturalHeight, scale };
}

export function getInitialFrameGeometry(
  index: number,
  metadata?: ScreenViewportSize,
): FrameGeometry {
  const column = index % 3;
  const row = Math.floor(index / 3);
  const height = getOverviewFrameHeight(SCREEN_WIDTH, metadata);
  return {
    x: column * (SCREEN_WIDTH + SCREEN_GAP),
    y: row * (height + FRAME_LABEL_HEIGHT + SCREEN_GAP),
    width: SCREEN_WIDTH,
    height,
  };
}

export function getOverviewFrameHeight(
  width: number,
  metadata?: ScreenViewportSize,
) {
  const sourceWidth =
    metadata?.width && metadata.width > 0 ? metadata.width : 1280;
  const sourceHeight =
    metadata?.height && metadata.height > 0 ? metadata.height : 2560;
  return Math.max(80, Math.round((width * sourceHeight) / sourceWidth));
}

export function sameFrameGeometry(a: FrameGeometry, b: FrameGeometry): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    (a.rotation ?? 0) === (b.rotation ?? 0) &&
    (a.z ?? 0) === (b.z ?? 0)
  );
}

export function resolveFrameGeometrySync(args: {
  screens: ReadonlyArray<{ id: string; metadata?: ScreenViewportSize }>;
  currentGeometryById: FrameGeometryById;
  persistedGeometryById:
    | Record<string, Partial<FrameGeometry> | undefined>
    | undefined;
}): {
  next: FrameGeometryById;
  changed: boolean;
  shouldNotifyParent: boolean;
} {
  const { screens, currentGeometryById, persistedGeometryById } = args;
  const currentIds = new Set(screens.map((screen) => screen.id));
  let shouldNotifyParent = Object.keys(currentGeometryById).some(
    (id) => !currentIds.has(id),
  );
  const next: FrameGeometryById = {};
  let changed = shouldNotifyParent;

  screens.forEach((screen, index) => {
    const existing = currentGeometryById[screen.id];
    const persisted = persistedGeometryById?.[screen.id];
    const resolved = {
      ...getInitialFrameGeometry(index, screen.metadata),
      ...persisted,
    } as FrameGeometry;
    next[screen.id] = persisted ? resolved : (existing ?? resolved);
    if (!existing) changed = true;
    if (persisted && !sameFrameGeometry(existing ?? resolved, resolved)) {
      changed = true;
      shouldNotifyParent = true;
    }
  });

  return { next, changed, shouldNotifyParent };
}

export function getPreviewDeviceFrameGeometry({
  currentGeometry,
  metadata,
  previewDeviceFrame,
}: {
  currentGeometry: FrameGeometry;
  metadata?: ScreenViewportSize;
  previewDeviceFrame: DeviceFrameType;
}): FrameGeometry {
  if (previewDeviceFrame === "none") {
    return {
      ...currentGeometry,
      height: getOverviewFrameHeight(currentGeometry.width, metadata),
    };
  }
  const viewport = DEVICE_FRAME_VIEWPORTS[previewDeviceFrame];
  return {
    ...currentGeometry,
    width: Math.max(1, Math.round(metadata?.width ?? viewport.width)),
    height: Math.max(1, Math.round(metadata?.height ?? viewport.height)),
  };
}

export function getScreenPreviewViewport(
  metadata: ScreenViewportSize,
  geometry: ScreenViewportSize,
) {
  const metadataWidth = Math.max(1, Math.round(metadata.width));
  const metadataHeight = Math.max(1, Math.round(metadata.height));
  const geometryWidth = Math.max(1, Math.round(geometry.width));
  const geometryHeight = Math.max(1, Math.round(geometry.height));
  const metadataAspect = metadataWidth / metadataHeight;
  const geometryAspect = geometryWidth / geometryHeight;
  const aspectMatches = Math.abs(metadataAspect - geometryAspect) < 0.005;

  if (aspectMatches) {
    return {
      viewportWidth: metadataWidth,
      viewportHeight: metadataHeight,
      displayWidth: metadataWidth,
      displayHeight: metadataHeight,
      scale:
        Math.abs(metadataWidth - geometryWidth) < 0.5 &&
        Math.abs(metadataHeight - geometryHeight) < 0.5
          ? 1
          : geometryWidth / metadataWidth,
    };
  }

  return {
    viewportWidth: geometryWidth,
    viewportHeight: geometryHeight,
    displayWidth: geometryWidth,
    displayHeight: geometryHeight,
    scale: 1,
  };
}

export function cloneFrameGeometryById(
  geometryById: FrameGeometryById,
): FrameGeometryById {
  return Object.fromEntries(
    Object.entries(geometryById).map(([id, geometry]) => [id, { ...geometry }]),
  );
}

export function frameGeometryWithOverrides(
  base: FrameGeometryById,
  overrides: FrameGeometryById,
): FrameGeometryById {
  const next = cloneFrameGeometryById(base);
  Object.entries(overrides).forEach(([id, geometry]) => {
    next[id] = { ...geometry };
  });
  return next;
}

export function getFrameCenter(frame: FrameGeometry): Point {
  return {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
}

export function angleBetween(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

export function getSelectableBounds(
  geometry: FrameGeometry,
  chromeScale = 1,
): BoundsRect {
  return {
    left: geometry.x,
    top: geometry.y - FRAME_LABEL_HEIGHT * chromeScale,
    right: geometry.x + geometry.width,
    bottom: geometry.y + geometry.height,
  };
}

export function getLayerSelectableBounds(geometry: FrameGeometry): BoundsRect {
  return {
    left: geometry.x,
    top: geometry.y,
    right: geometry.x + geometry.width,
    bottom: geometry.y + geometry.height,
  };
}

export function frameStyleLeftTop(
  geometry: { x: number; y: number },
  labelHeight = 0,
): { left: number; top: number } {
  return {
    left: SURFACE_PADDING + geometry.x,
    top: SURFACE_PADDING + geometry.y - labelHeight,
  };
}

export function rectContainsPoint(bounds: BoundsRect, point: Point): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

export function rotatePointAroundCenter(
  point: Point,
  center: Point,
  degrees: number,
): Point {
  if (!degrees) return point;
  const rad = (-degrees * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function geometryContainsPoint(
  geometry: FrameGeometry,
  point: Point,
): boolean {
  const local = rotatePointAroundCenter(
    point,
    getFrameCenter(geometry),
    geometry.rotation ?? 0,
  );
  return rectContainsPoint(
    {
      left: geometry.x,
      top: geometry.y,
      right: geometry.x + geometry.width,
      bottom: geometry.y + geometry.height,
    },
    local,
  );
}

export function geometryCorners(geometry: FrameGeometry): Point[] {
  const center = getFrameCenter(geometry);
  const rotation = geometry.rotation ?? 0;
  return [
    { x: geometry.x, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y },
    { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
    { x: geometry.x, y: geometry.y + geometry.height },
  ].map((point) => rotatePointAroundCenter(point, center, -rotation));
}

export function geometryContainsGeometry(
  outer: FrameGeometry,
  inner: FrameGeometry,
): boolean {
  return geometryCorners(inner).every((point) =>
    geometryContainsPoint(outer, point),
  );
}

export function findTopFrameEntryAtPoint<
  T extends { id: string; geometry: FrameGeometry },
>(
  entries: readonly T[],
  point: Point,
  options: { foregroundId?: string } = {},
): T | undefined {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const bounds = {
        left: entry.geometry.x,
        top: entry.geometry.y,
        right: entry.geometry.x + entry.geometry.width,
        bottom: entry.geometry.y + entry.geometry.height,
      };
      const local = rotatePointAroundCenter(
        point,
        getFrameCenter(entry.geometry),
        entry.geometry.rotation ?? 0,
      );
      return rectContainsPoint(bounds, local);
    })
    .sort(
      (a, b) =>
        Number(b.entry.id === options.foregroundId) -
          Number(a.entry.id === options.foregroundId) ||
        (b.entry.geometry.z ?? 0) - (a.entry.geometry.z ?? 0) ||
        b.index - a.index,
    )[0]?.entry;
}

export function getOutsideFrameDraftFallback<T>(
  entries: readonly T[],
  options: { hasBoardDrawHandler: boolean },
): T | undefined {
  if (entries.length === 0) return undefined;
  if (options.hasBoardDrawHandler) return undefined;
  return entries[0];
}
