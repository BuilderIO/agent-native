import {
  getInitialCanvasFrameGeometry,
  getOverviewFrameHeight as getSharedOverviewFrameHeight,
  getResponsiveInitialCanvasFrameGeometries,
  OVERVIEW_FRAME_LABEL_HEIGHT,
  OVERVIEW_FRAME_WIDTH,
} from "../../../../shared/canvas-frames";
import {
  BREAKPOINT_FRAME_GAP,
  deviceViewportFloorForWidth,
  getResponsiveGroupHeight,
  getResponsiveGroupRotatedBounds,
  getResponsiveGroupWidth,
  getScreenPreviewViewport,
  visibleBreakpointWidths,
} from "../../../../shared/responsive-frame-layout";
import { DEVICE_FRAME_VIEWPORTS, type DeviceFrameType } from "../types";
import { SURFACE_PADDING } from "./overview-layout";
import type { FrameGeometry, FrameGeometryById, Point } from "./types";

const SCREEN_WIDTH = OVERVIEW_FRAME_WIDTH;
const FRAME_LABEL_HEIGHT = OVERVIEW_FRAME_LABEL_HEIGHT;

export {
  BREAKPOINT_FRAME_GAP,
  deviceViewportFloorForWidth,
  getScreenPreviewViewport,
  visibleBreakpointWidths,
};

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
  id?: string | undefined;
  metadata?: ScreenViewportSize | undefined;
  breakpointWidths?: readonly number[] | undefined;
  layoutGroupId?: string | undefined;
};

export function getResponsiveScreenGroupSize(
  screen: ResponsiveLayoutScreen,
  primaryGeometry?: Partial<FrameGeometry>,
  resolveBreakpointHeightPx?: (widthPx: number) => number | undefined,
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
  const scale = getScreenPreviewViewport(
    { width: sourceWidth, height: sourceHeight },
    { width: baseWidth, height: baseHeight },
  ).scale;
  const breakpoints = visibleBreakpointWidths(
    screen.breakpointWidths,
    screen.metadata?.width ?? primaryGeometry?.width,
  );
  return {
    width: getResponsiveGroupWidth({
      primaryWidth: baseWidth,
      scale,
      visibleWidths: breakpoints,
    }),
    height: getResponsiveGroupHeight({
      primaryHeight: baseHeight,
      scale,
      sourceWidth,
      sourceHeight,
      visibleWidths: breakpoints,
      resolveBreakpointHeightPx,
    }),
  };
}

export function getResponsiveScreenCullGeometry(
  screen: ResponsiveLayoutScreen,
  primaryGeometry: FrameGeometry,
  resolveBreakpointHeightPx?: (widthPx: number) => number | undefined,
): FrameGeometry {
  const size = getResponsiveScreenGroupSize(
    screen,
    primaryGeometry,
    resolveBreakpointHeightPx,
  );
  const rotation = primaryGeometry.rotation ?? 0;
  if (!rotation) {
    return {
      ...primaryGeometry,
      width: size.width,
      height: size.height,
      rotation: undefined,
    };
  }

  const bounds = getResponsiveGroupRotatedBounds({
    x: primaryGeometry.x,
    y: primaryGeometry.y,
    primaryWidth: primaryGeometry.width,
    primaryHeight: primaryGeometry.height,
    groupWidth: size.width,
    groupHeight: size.height,
    rotation,
  });
  return {
    ...bounds,
    rotation: undefined,
    z: primaryGeometry.z,
  };
}

export function getResponsiveInitialFrameGeometry(
  index: number,
  screens: readonly ResponsiveLayoutScreen[],
  primaryGeometryById: Record<string, Partial<FrameGeometry> | undefined> = {},
): FrameGeometry {
  const screenIds = screens.map(
    (screen, screenIndex) => screen.id ?? `__screen_${screenIndex}`,
  );
  const geometryById = getResponsiveInitialFrameGeometryById(
    screens,
    primaryGeometryById,
  );
  return (
    geometryById[screenIds[index] ?? ""] ?? getInitialCanvasFrameGeometry(index)
  );
}

// One layout pass for the whole list. Callers that need several screens must
// call this once and look each one up: the shared layout is O(N), so a
// per-screen call makes the overview quadratic in screen count.
function getResponsiveInitialFrameGeometryById(
  screens: readonly ResponsiveLayoutScreen[],
  primaryGeometryById: Record<string, Partial<FrameGeometry> | undefined>,
): Record<string, FrameGeometry> {
  return getResponsiveInitialCanvasFrameGeometries(
    screens.map((screen, screenIndex) => ({
      id: screen.id ?? `__screen_${screenIndex}`,
      metadata: screen.metadata
        ? { width: screen.metadata.width, height: screen.metadata.height }
        : undefined,
      breakpointWidths: screen.breakpointWidths,
    })),
    primaryGeometryById,
  );
}

const GENERATED_VARIANT_GAP = 96;

interface LayoutGroupMember<T extends ResponsiveLayoutScreen & { id: string }> {
  screen: T;
  responsiveInitial: FrameGeometry;
  generatedInitial: FrameGeometry;
}

function getLayoutGroupMembers<
  T extends ResponsiveLayoutScreen & { id: string },
>(
  screens: readonly T[],
  primaryGeometryById: Record<string, Partial<FrameGeometry> | undefined>,
): LayoutGroupMember<T>[] {
  const responsiveById = getResponsiveInitialFrameGeometryById(
    screens,
    primaryGeometryById,
  );
  const columnCount = Math.min(3, Math.max(1, screens.length));
  const members: LayoutGroupMember<T>[] = [];
  let rowY = 0;
  for (let rowStart = 0; rowStart < screens.length; rowStart += columnCount) {
    let x = 0;
    let rowHeight = 0;
    screens
      .slice(rowStart, rowStart + columnCount)
      .forEach((screen, column) => {
        const width = Math.max(1, screen.metadata?.width ?? 1280);
        const height = Math.max(1, screen.metadata?.height ?? 900);
        members.push({
          screen,
          responsiveInitial:
            responsiveById[screen.id] ??
            getInitialCanvasFrameGeometry(rowStart + column),
          generatedInitial: { x, y: rowY, width, height },
        });
        x = x + width + GENERATED_VARIANT_GAP;
        rowHeight = Math.max(rowHeight, height);
      });
    rowY = rowY + rowHeight + GENERATED_VARIANT_GAP;
  }
  return members;
}

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
  contentHeightPx?: number;
  pinnedHeightPx?: number;
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
  const measured =
    args.contentHeightPx && args.contentHeightPx > 0
      ? Math.round(args.contentHeightPx)
      : undefined;
  const pinned =
    args.pinnedHeightPx && args.pinnedHeightPx > 0
      ? Math.round(args.pinnedHeightPx)
      : undefined;
  const naturalHeight =
    pinned !== undefined
      ? pinned
      : measured !== undefined
        ? Math.max(deviceViewportFloorForWidth(args.widthPx), measured)
        : Math.round(args.widthPx * Math.max(0.01, args.naturalAspect));
  const frameWidth = Math.round(args.widthPx * scale);
  const frameHeight = Math.round(naturalHeight * scale);
  return { frameWidth, frameHeight, naturalHeight, scale };
}

export function getInitialFrameGeometry(
  index: number,
  metadata?: ScreenViewportSize,
): FrameGeometry {
  return getInitialCanvasFrameGeometry(index, metadata);
}

export function getOverviewFrameHeight(
  width: number,
  metadata?: ScreenViewportSize,
) {
  return getSharedOverviewFrameHeight(width, metadata);
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

export interface FrameGeometryInputScreen {
  id: string;
  metadata?: ScreenViewportSize | undefined;
  breakpointWidths?: readonly number[] | undefined;
  layoutGroupId?: string | undefined;
}

function sameOrigin(
  geometry: Partial<FrameGeometry> | undefined,
  origin: Point,
): boolean {
  return (
    geometry !== undefined && geometry.x === origin.x && geometry.y === origin.y
  );
}

function sameNumberList(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

/**
 * Returns `previous` when `next` carries the same geometry inputs, so a
 * content-only screen change keeps the array identity that frame geometry
 * resolution is keyed on.
 */
export function reuseFrameGeometryInputs(
  previous: readonly FrameGeometryInputScreen[] | undefined,
  next: readonly FrameGeometryInputScreen[],
): readonly FrameGeometryInputScreen[] {
  if (!previous || previous.length !== next.length) return next;
  const nextScreens = next.values();
  const same = previous.every((prior) => {
    const entry = nextScreens.next();
    if (entry.done) return false;
    const screen = entry.value;
    return (
      prior.id === screen.id &&
      prior.layoutGroupId === screen.layoutGroupId &&
      Object.is(prior.metadata?.width, screen.metadata?.width) &&
      Object.is(prior.metadata?.height, screen.metadata?.height) &&
      sameNumberList(prior.breakpointWidths, screen.breakpointWidths)
    );
  });
  return same ? previous : next;
}

export function resolveFrameGeometrySync(args: {
  screens: readonly FrameGeometryInputScreen[];
  currentGeometryById: FrameGeometryById;
  persistedGeometryById:
    | Record<string, Partial<FrameGeometry> | undefined>
    | undefined;
  geometryOverridesById?: Record<string, FrameGeometry | undefined>;
}): {
  next: FrameGeometryById;
  changed: boolean;
  shouldNotifyParent: boolean;
} {
  const {
    screens,
    currentGeometryById,
    persistedGeometryById,
    geometryOverridesById,
  } = args;
  const effectivePersistedGeometryById = { ...persistedGeometryById };
  for (const [id, geometry] of Object.entries(geometryOverridesById ?? {})) {
    if (geometry) effectivePersistedGeometryById[id] = geometry;
  }
  const currentIds = new Set(screens.map((screen) => screen.id));
  let shouldNotifyParent = Object.keys(currentGeometryById).some(
    (id) => !currentIds.has(id),
  );
  const next: FrameGeometryById = {};
  let changed = shouldNotifyParent;

  const baseGeometryById = Object.fromEntries(
    screens.map((screen) => [
      screen.id,
      effectivePersistedGeometryById[screen.id] ??
        currentGeometryById[screen.id],
    ]),
  );

  const layoutGroupScreens = new Map<string, (typeof screens)[number][]>();
  for (const screen of screens) {
    if (!screen.layoutGroupId) continue;
    const groupScreens = layoutGroupScreens.get(screen.layoutGroupId) ?? [];
    groupScreens.push(screen);
    layoutGroupScreens.set(screen.layoutGroupId, groupScreens);
  }
  const layoutGroups = new Map<
    string,
    {
      memberById: Map<string, LayoutGroupMember<(typeof screens)[number]>>;
      untouched: boolean;
      originY: number;
    }
  >();
  let groupOriginY = 0;
  for (const [groupId, groupScreens] of layoutGroupScreens) {
    const members = getLayoutGroupMembers(groupScreens, baseGeometryById);
    const memberById = new Map<
      string,
      LayoutGroupMember<(typeof screens)[number]>
    >();
    for (const member of members) {
      if (!memberById.has(member.screen.id)) {
        memberById.set(member.screen.id, member);
      }
    }
    const untouched = members.every(({ screen, generatedInitial }) =>
      sameOrigin(
        effectivePersistedGeometryById[screen.id] ??
          currentGeometryById[screen.id],
        generatedInitial,
      ),
    );
    layoutGroups.set(groupId, { memberById, untouched, originY: groupOriginY });
    const groupBottom = members.reduce(
      (bottom, { screen, responsiveInitial }) => {
        const groupSize = getResponsiveScreenGroupSize(
          screen,
          baseGeometryById[screen.id],
        );
        return Math.max(bottom, responsiveInitial.y + groupSize.height);
      },
      0,
    );
    groupOriginY += groupBottom + FRAME_LABEL_HEIGHT + GENERATED_VARIANT_GAP;
  }
  const ungroupedResponsiveInitialById = getResponsiveInitialFrameGeometryById(
    screens,
    baseGeometryById,
  );

  screens.forEach((screen, index) => {
    const existing = currentGeometryById[screen.id];
    const persisted = effectivePersistedGeometryById[screen.id];
    const legacyInitial = getInitialFrameGeometry(index, screen.metadata);
    const layoutGroup = screen.layoutGroupId
      ? layoutGroups.get(screen.layoutGroupId)
      : undefined;
    const layoutGroupMember = layoutGroup?.memberById.get(screen.id);
    const generatedGroupUntouched = layoutGroup?.untouched ?? false;
    const responsiveInitial =
      layoutGroup && layoutGroupMember
        ? {
            ...layoutGroupMember.responsiveInitial,
            y: layoutGroupMember.responsiveInitial.y + layoutGroup.originY,
          }
        : (ungroupedResponsiveInitialById[screen.id] ??
          getInitialCanvasFrameGeometry(index));
    const generatedVariantInitial = layoutGroupMember?.generatedInitial ?? null;
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

export function resolveHitTestForegroundId(options: {
  selectedIds: readonly string[];
  hasGeometry: (id: string) => boolean;
  activeId: string | null | undefined;
  firstScreenId: string | undefined;
}): string | undefined {
  const selected = options.selectedIds.find((id) => options.hasGeometry(id));
  if (selected !== undefined) return selected;
  if (options.activeId && options.hasGeometry(options.activeId)) {
    return options.activeId;
  }
  return options.firstScreenId;
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
