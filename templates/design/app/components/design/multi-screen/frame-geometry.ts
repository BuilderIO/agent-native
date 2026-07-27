import { DEVICE_FRAME_VIEWPORTS, type DeviceFrameType } from "../types";
import { SURFACE_PADDING } from "./overview-layout";
import type { FrameGeometry, FrameGeometryById, Point } from "./types";

const SCREEN_WIDTH = 320;
const SCREEN_GAP = 56;
const FRAME_LABEL_HEIGHT = 28;
const BREAKPOINT_FRAME_GAP = 24;

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

type ResponsiveLayoutScreen = {
  id?: string;
  metadata?: ScreenViewportSize;
  breakpointWidths?: readonly number[];
  layoutGroupId?: string;
};

export function getResponsiveScreenGroupSize(
  screen: ResponsiveLayoutScreen,
  primaryGeometry?: Partial<FrameGeometry>,
): {
  width: number;
  height: number;
} {
  const baseWidth = Math.max(1, primaryGeometry?.width ?? SCREEN_WIDTH);
  const baseHeight = Math.max(
    1,
    primaryGeometry?.height ??
      getOverviewFrameHeight(baseWidth, screen.metadata),
  );
  const sourceWidth = Math.max(1, screen.metadata?.width ?? 1280);
  const sourceHeight = Math.max(1, screen.metadata?.height ?? 2560);
  const scale = baseWidth / sourceWidth;
  const breakpoints = (screen.breakpointWidths ?? []).filter(
    (width) => Number.isFinite(width) && width > 0,
  );
  return {
    width:
      baseWidth +
      breakpoints.reduce(
        (total, width) => total + BREAKPOINT_FRAME_GAP + width * scale,
        0,
      ),
    height: Math.max(
      baseHeight,
      ...breakpoints.map(
        (width) => width * (sourceHeight / sourceWidth) * scale,
      ),
    ),
  };
}

/**
 * Bounds used by viewport culling for a screen and every responsive preview
 * painted to its right. Culling only the persisted primary frame can evict a
 * breakpoint that is still visibly on-screen after the user pans right.
 *
 * Rotated groups pivot around the primary frame, not around the wider row.
 * Return an unrotated AABB so the generic culler cannot rotate around the
 * wrong center and underestimate the painted region.
 */
export function getResponsiveScreenCullGeometry(
  screen: ResponsiveLayoutScreen,
  primaryGeometry: FrameGeometry,
): FrameGeometry {
  const size = getResponsiveScreenGroupSize(screen, primaryGeometry);
  const rotation = primaryGeometry.rotation ?? 0;
  if (!rotation) {
    return {
      ...primaryGeometry,
      width: size.width,
      height: size.height,
      rotation: undefined,
    };
  }

  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const pivot = {
    x: primaryGeometry.x + primaryGeometry.width / 2,
    y: primaryGeometry.y + primaryGeometry.height / 2,
  };
  const corners = [
    { x: primaryGeometry.x, y: primaryGeometry.y },
    { x: primaryGeometry.x + size.width, y: primaryGeometry.y },
    { x: primaryGeometry.x, y: primaryGeometry.y + size.height },
    {
      x: primaryGeometry.x + size.width,
      y: primaryGeometry.y + size.height,
    },
  ].map((point) => {
    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;
    return {
      x: pivot.x + dx * cosine - dy * sine,
      y: pivot.y + dx * sine + dy * cosine,
    };
  });
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    rotation: undefined,
    z: primaryGeometry.z,
  };
}

/** Legacy three-column lineup with each cell reserving its complete responsive
 * row. This prevents one generated variation's breakpoint frames from
 * painting over the next variation while preserving the familiar grid. */
export function getResponsiveInitialFrameGeometry(
  index: number,
  screens: readonly ResponsiveLayoutScreen[],
  primaryGeometryById: Record<string, Partial<FrameGeometry> | undefined> = {},
): FrameGeometry {
  const columnCount = Math.min(3, Math.max(1, screens.length));
  const column = index % columnCount;
  const row = Math.floor(index / columnCount);
  const primaryGeometryFor = (screen: ResponsiveLayoutScreen) =>
    screen.id ? primaryGeometryById[screen.id] : undefined;
  const sizes = screens.map((screen) =>
    getResponsiveScreenGroupSize(screen, primaryGeometryFor(screen)),
  );
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      0,
      ...sizes
        .filter((_, screenIndex) => screenIndex % columnCount === columnIndex)
        .map((size) => size.width),
    ),
  );
  const rowCount = Math.ceil(screens.length / columnCount);
  const rowHeights = Array.from({ length: rowCount }, (_, rowIndex) =>
    Math.max(
      0,
      ...sizes
        .slice(rowIndex * columnCount, (rowIndex + 1) * columnCount)
        .map((size) => size.height),
    ),
  );
  const own = screens[index];
  const ownGeometry = own ? primaryGeometryFor(own) : undefined;
  const ownWidth = Math.max(1, ownGeometry?.width ?? SCREEN_WIDTH);
  const ownHeight = Math.max(
    1,
    ownGeometry?.height ?? getOverviewFrameHeight(ownWidth, own?.metadata),
  );
  return {
    x: columnWidths
      .slice(0, column)
      .reduce((total, width) => total + width + SCREEN_GAP, 0),
    y: rowHeights
      .slice(0, row)
      .reduce(
        (total, height) => total + height + FRAME_LABEL_HEIGHT + SCREEN_GAP,
        0,
      ),
    width: ownWidth,
    height: ownHeight,
  };
}

const GENERATED_VARIANT_GAP = 96;

/** The present-design-variants action's historical three-column placement.
 * Matching this exactly distinguishes untouched generated lineups from a
 * designer's intentional custom arrangement. */
function getGeneratedVariantInitialFrameGeometry(
  index: number,
  screens: readonly ResponsiveLayoutScreen[],
): FrameGeometry {
  const columnCount = Math.min(3, Math.max(1, screens.length));
  const column = index % columnCount;
  const row = Math.floor(index / columnCount);
  const sizes = screens.map((screen) => ({
    width: Math.max(1, screen.metadata?.width ?? 1280),
    height: Math.max(1, screen.metadata?.height ?? 900),
  }));
  const rowStart = row * columnCount;
  const own = sizes[index]!;
  return {
    x: sizes
      .slice(rowStart, rowStart + column)
      .reduce((total, size) => total + size.width + GENERATED_VARIANT_GAP, 0),
    y: Array.from({ length: row }, (_, rowIndex) =>
      Math.max(
        0,
        ...sizes
          .slice(rowIndex * columnCount, (rowIndex + 1) * columnCount)
          .map((size) => size.height),
      ),
    ).reduce((total, height) => total + height + GENERATED_VARIANT_GAP, 0),
    width: own.width,
    height: own.height,
  };
}

function getResponsiveVariantGroupOriginY(
  groupId: string,
  screens: readonly (ResponsiveLayoutScreen & { id: string })[],
  primaryGeometryById: Record<string, Partial<FrameGeometry> | undefined>,
): number {
  const groupIds = Array.from(
    new Set(
      screens
        .map((screen) => screen.layoutGroupId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  let originY = 0;
  for (const candidateGroupId of groupIds) {
    if (candidateGroupId === groupId) return originY;
    const groupScreens = screens.filter(
      (screen) => screen.layoutGroupId === candidateGroupId,
    );
    const groupBottom = groupScreens.reduce((bottom, screen, index) => {
      const frame = getResponsiveInitialFrameGeometry(
        index,
        groupScreens,
        primaryGeometryById,
      );
      const groupSize = getResponsiveScreenGroupSize(
        screen,
        primaryGeometryById[screen.id],
      );
      return Math.max(bottom, frame.y + groupSize.height);
    }, 0);
    originY += groupBottom + FRAME_LABEL_HEIGHT + GENERATED_VARIANT_GAP;
  }
  return originY;
}

/** Canonical bottom-to-top screen stack. Persisted frame `z` wins; screens
 * without one retain their source order, which is also the canvas DOM paint
 * order. This is shared by the overview canvas and Layers projection so the
 * two surfaces can never disagree about which screen is above another. */
export function getCanonicalScreenStack(
  screens: ReadonlyArray<{ id: string }>,
  geometryById: Record<string, Partial<FrameGeometry> | undefined>,
): string[] {
  return screens
    .map((screen, index) => ({
      id: screen.id,
      index,
      z: Number.isFinite(geometryById[screen.id]?.z)
        ? geometryById[screen.id]!.z!
        : index,
    }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map(({ id }) => id);
}

/** Reorders a canonical bottom-to-top stack using DOM placement semantics:
 * `before` paints below the target and `after` paints above it. `inside` is
 * not a screen-stack operation (it remains the layer-into-screen drop path). */
export function reorderCanonicalScreenStack(args: {
  orderedIds: readonly string[];
  draggedIds: readonly string[];
  targetId: string;
  placement: "before" | "after" | "inside";
}): string[] | null {
  if (args.placement === "inside") return null;
  const orderedIds = Array.from(new Set(args.orderedIds));
  const orderedIdSet = new Set(orderedIds);
  if (!orderedIdSet.has(args.targetId)) return null;
  const draggedIdSet = new Set(
    args.draggedIds.filter(
      (id) => orderedIdSet.has(id) && id !== args.targetId,
    ),
  );
  if (draggedIdSet.size === 0) return null;
  const moving = orderedIds.filter((id) => draggedIdSet.has(id));
  const remaining = orderedIds.filter((id) => !draggedIdSet.has(id));
  const targetIndex = remaining.indexOf(args.targetId);
  if (targetIndex < 0) return null;
  const insertionIndex =
    args.placement === "before" ? targetIndex : targetIndex + 1;
  const next = [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ];
  return next.every((id, index) => id === orderedIds[index]) ? null : next;
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
  screens: ReadonlyArray<{
    id: string;
    metadata?: ScreenViewportSize;
    breakpointWidths?: readonly number[];
    layoutGroupId?: string;
  }>;
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

  const baseGeometryById = Object.fromEntries(
    screens.map((screen) => [
      screen.id,
      persistedGeometryById?.[screen.id] ?? currentGeometryById[screen.id],
    ]),
  );

  screens.forEach((screen, index) => {
    const existing = currentGeometryById[screen.id];
    const persisted = persistedGeometryById?.[screen.id];
    const legacyInitial = getInitialFrameGeometry(index, screen.metadata);
    const layoutGroupScreens = screen.layoutGroupId
      ? screens.filter(
          (candidate) => candidate.layoutGroupId === screen.layoutGroupId,
        )
      : null;
    const layoutGroupIndex = layoutGroupScreens?.findIndex(
      (candidate) => candidate.id === screen.id,
    );
    const generatedGroupUntouched = Boolean(
      layoutGroupScreens?.every((candidate, candidateIndex) => {
        const baseline = getGeneratedVariantInitialFrameGeometry(
          candidateIndex,
          layoutGroupScreens,
        );
        const candidateGeometry =
          persistedGeometryById?.[candidate.id] ??
          currentGeometryById[candidate.id];
        return (
          candidateGeometry?.x === baseline.x &&
          candidateGeometry?.y === baseline.y
        );
      }),
    );
    const variantGroupOriginY = screen.layoutGroupId
      ? getResponsiveVariantGroupOriginY(
          screen.layoutGroupId,
          screens,
          baseGeometryById,
        )
      : 0;
    const responsiveInitial =
      layoutGroupScreens &&
      layoutGroupIndex !== undefined &&
      layoutGroupIndex >= 0
        ? {
            ...getResponsiveInitialFrameGeometry(
              layoutGroupIndex,
              layoutGroupScreens,
              baseGeometryById,
            ),
            y:
              getResponsiveInitialFrameGeometry(
                layoutGroupIndex,
                layoutGroupScreens,
                baseGeometryById,
              ).y + variantGroupOriginY,
          }
        : getResponsiveInitialFrameGeometry(index, screens, baseGeometryById);
    const generatedVariantInitial =
      layoutGroupScreens &&
      layoutGroupIndex !== undefined &&
      layoutGroupIndex >= 0
        ? getGeneratedVariantInitialFrameGeometry(
            layoutGroupIndex,
            layoutGroupScreens,
          )
        : null;
    const persistedUsesGeneratedVariantLineup =
      Boolean(screen.breakpointWidths?.length) &&
      generatedGroupUntouched &&
      generatedVariantInitial !== null &&
      persisted?.x === generatedVariantInitial.x &&
      persisted?.y === generatedVariantInitial.y &&
      (responsiveInitial.x !== generatedVariantInitial.x ||
        responsiveInitial.y !== generatedVariantInitial.y);
    const existingUsesGeneratedVariantLineup =
      !persisted &&
      Boolean(screen.breakpointWidths?.length) &&
      generatedGroupUntouched &&
      generatedVariantInitial !== null &&
      existing?.x === generatedVariantInitial.x &&
      existing?.y === generatedVariantInitial.y &&
      (responsiveInitial.x !== generatedVariantInitial.x ||
        responsiveInitial.y !== generatedVariantInitial.y);
    const persistedUsesLegacyLineup =
      Boolean(screen.breakpointWidths?.length) &&
      (responsiveInitial.x !== legacyInitial.x ||
        responsiveInitial.y !== legacyInitial.y) &&
      persisted?.x === legacyInitial.x &&
      persisted?.y === legacyInitial.y;
    const existingUsesLegacyLineup =
      !persisted &&
      Boolean(screen.breakpointWidths?.length) &&
      (responsiveInitial.x !== legacyInitial.x ||
        responsiveInitial.y !== legacyInitial.y) &&
      existing?.x === legacyInitial.x &&
      existing?.y === legacyInitial.y;
    const resolved = {
      ...responsiveInitial,
      ...persisted,
      ...(persistedUsesLegacyLineup || persistedUsesGeneratedVariantLineup
        ? { x: responsiveInitial.x, y: responsiveInitial.y }
        : null),
    } as FrameGeometry;
    next[screen.id] = persisted
      ? resolved
      : existingUsesLegacyLineup || existingUsesGeneratedVariantLineup
        ? { ...existing, x: responsiveInitial.x, y: responsiveInitial.y }
        : (existing ?? resolved);
    if (!existing) changed = true;
    if (
      persistedUsesLegacyLineup ||
      existingUsesLegacyLineup ||
      persistedUsesGeneratedVariantLineup ||
      existingUsesGeneratedVariantLineup
    ) {
      changed = true;
      shouldNotifyParent = true;
    }
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
