import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import type { CodeLayerNode, CodeLayerProjection } from "@shared/code-layer";
import type { DesignSourceType } from "@shared/source-mode";

import type { ScreenGeometrySelection } from "@/components/design/EditPanel";
import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type {
  ElementInfo,
  ElementSelectionIntent,
} from "@/components/design/types";
import { prettyScreenName } from "@/lib/screen-names";
import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";

import {
  clampScreenFrameSize,
  readScreenSizeConstraints,
  type ScreenSizeConstraints,
} from "../../components/design/multi-screen/screen-sizing";
import type { GeometryHistorySelection } from "./history";
import type { DesignTool, EditorMode } from "./types";

const CONTENT_SIGNATURE_CACHE_MAX = 200;
const contentSignatureCache = new Map<string, string>();
export function getContentSignature(content: string): string {
  const cached = contentSignatureCache.get(content);
  if (cached !== undefined) return cached;
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const signature = `${content.length}:${hash.toString(36)}`;
  if (contentSignatureCache.size >= CONTENT_SIGNATURE_CACHE_MAX) {
    const oldestKey = contentSignatureCache.keys().next().value;
    if (oldestKey !== undefined) contentSignatureCache.delete(oldestKey);
  }
  contentSignatureCache.set(content, signature);
  return signature;
}

export function getOverviewScreenRuntimeReplacementKey({
  screenId,
  updatedAt,
  content,
}: {
  screenId: string;
  updatedAt?: string | null;
  content: string;
}) {
  return [screenId, updatedAt ?? "", getContentSignature(content)].join(":");
}

export function getOverviewScreenContentKey({
  screenId,
  screenIsActive,
  contentRenderRevision,
  updatedAt,
  content,
  useRuntimeReplacement,
}: {
  screenId: string;
  screenIsActive: boolean;
  contentRenderRevision: number;
  updatedAt?: string | null;
  content: string;
  useRuntimeReplacement: boolean;
}): string {
  if (useRuntimeReplacement) return `${screenId}:inline-overview`;
  return screenIsActive
    ? [screenId, contentRenderRevision].join(":")
    : [screenId, updatedAt ?? "", getContentSignature(content), 0].join(":");
}

export function shouldUseOverviewRuntimeReplacement({
  sourceType,
  externalSnapshotHtml,
}: {
  sourceType?: DesignSourceType | null;
  externalSnapshotHtml?: string | null;
}) {
  return sourceType === "inline" && !externalSnapshotHtml;
}

export function shouldIncludeScreenRenameContentOverride(args: {
  fileType: string;
  sourceType: DesignSourceType;
  persistedContent: string;
  freshContent: string;
}): boolean {
  return (
    args.fileType.toLowerCase() === "html" &&
    args.sourceType === "inline" &&
    args.freshContent !== args.persistedContent
  );
}

export function dedupeStringIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export function sameStringIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function pendingEditTargetsSelectedElement(args: {
  editSourceId?: string | null;
  editSelector: string;
  selectedSourceId?: string | null;
  selectedSelector?: string | null;
}): boolean {
  if (args.editSourceId && args.selectedSourceId) {
    return args.selectedSourceId === args.editSourceId;
  }
  return Boolean(
    args.selectedSelector && args.selectedSelector === args.editSelector,
  );
}

export function isScreenRootElementInfo(info: ElementInfo | null | undefined) {
  const tagName = info?.tagName?.toUpperCase();
  return tagName === "BODY" || tagName === "HTML";
}

export function overviewSelectionTargetsElement(args: {
  selectedElement: ElementInfo | null | undefined;
  selectedLayerIds: readonly string[];
  fileIds: readonly string[];
}): boolean {
  const fileIds = new Set(args.fileIds);
  if (
    args.selectedLayerIds.some(
      (layerId) =>
        layerId && !layerId.startsWith("__") && !fileIds.has(layerId),
    )
  ) {
    return true;
  }
  return Boolean(
    args.selectedElement && !isScreenRootElementInfo(args.selectedElement),
  );
}

export function shouldMirrorSelectedElementToAgentChat(
  info: ElementInfo | null | undefined,
): info is ElementInfo {
  if (!info || isScreenRootElementInfo(info)) return false;
  const text = info.textContent?.replace(/\s+/g, " ").trim();
  if (!text) return true;
  const labelText = text.replace(/^[^A-Za-z0-9]+/, "").toLowerCase();
  return !labelText.startsWith("nothing here yet");
}

export function shouldIgnoreOverviewLayerCreationEcho(args: {
  pendingLayerId: string | null | undefined;
  pendingScreenId: string | null | undefined;
  screenId: string;
  info?: ElementInfo | null;
  resolvedLayerId?: string | null;
  event: "select" | "clear";
}) {
  if (!args.pendingLayerId) return false;
  if (args.pendingScreenId && args.pendingScreenId !== args.screenId) {
    return false;
  }
  if (args.event === "clear" || isScreenRootElementInfo(args.info)) {
    return true;
  }
  const echoedLayerId =
    args.info?.sourceId ?? args.info?.id ?? args.info?.pendingNodeId;
  return (
    args.resolvedLayerId === args.pendingLayerId ||
    (args.pendingScreenId === args.screenId &&
      echoedLayerId === args.pendingLayerId)
  );
}

export function getSelectedScreenIdsForEditorState(args: {
  activeFileId: string | null | undefined;
  overviewSelectedScreenIds: string[];
  viewMode: "single" | "overview";
}) {
  const { activeFileId, overviewSelectedScreenIds, viewMode } = args;
  if (viewMode === "overview") {
    return overviewSelectedScreenIds.length
      ? overviewSelectedScreenIds
      : activeFileId
        ? [activeFileId]
        : [];
  }
  return activeFileId ? [activeFileId] : [];
}

export function resolveAvailableActiveFileId(args: {
  activeFileId: string | null | undefined;
  availableFileIds: Iterable<string>;
  defaultFileId: string | null | undefined;
}): string | null {
  const availableFileIds = new Set(args.availableFileIds);
  if (args.activeFileId && availableFileIds.has(args.activeFileId)) {
    return args.activeFileId;
  }
  return args.defaultFileId && availableFileIds.has(args.defaultFileId)
    ? args.defaultFileId
    : null;
}

export interface OverviewScreenGeometrySource {
  id: string;
  width?: number;
  height?: number;
  heightMode?: ScreenGeometrySelection["heightMode"];
  sizeConstraints?: ScreenSizeConstraints;
}

type ResolvedScreenFrameGeometry = CanvasFrameGeometry &
  Required<Pick<CanvasFrameGeometry, "x" | "y" | "width" | "height">>;

export function resolveOverviewScreenFrameGeometry(args: {
  screen: OverviewScreenGeometrySource;
  screenIndex: number;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  naturalHeight?: number;
  sizeConstraints?: ScreenSizeConstraints;
}): ResolvedScreenFrameGeometry {
  const fallbackGeometry = getInitialFrameGeometry(args.screenIndex, {
    width: args.screen.width ?? 1280,
    height: args.screen.height ?? 2560,
  });
  const persistedGeometry = args.canvasFrameGeometryById[args.screen.id] ?? {};
  const geometry = {
    ...fallbackGeometry,
    ...persistedGeometry,
    x: persistedGeometry.x ?? fallbackGeometry.x,
    y: persistedGeometry.y ?? fallbackGeometry.y,
    width: persistedGeometry.width ?? fallbackGeometry.width,
    height: persistedGeometry.height ?? fallbackGeometry.height,
  };
  if (
    args.screen.heightMode === "hug" &&
    typeof args.naturalHeight === "number" &&
    Number.isFinite(args.naturalHeight) &&
    args.naturalHeight > 0
  ) {
    geometry.height = args.naturalHeight;
  }
  return args.sizeConstraints
    ? clampScreenFrameSize(geometry, args.sizeConstraints)
    : geometry;
}

export function getOverviewScreenExportGeometryById(args: {
  overviewScreens: OverviewScreenGeometrySource[];
  canvasFrameGeometryById: CanvasFrameGeometryById;
  naturalHeightsById?: Record<string, number>;
  screenRootComputedStylesById?: Record<string, Record<string, string>>;
}): CanvasFrameGeometryById {
  const geometryById: CanvasFrameGeometryById = {};
  args.overviewScreens.forEach((screen, screenIndex) => {
    geometryById[screen.id] = resolveOverviewScreenFrameGeometry({
      screen,
      screenIndex,
      canvasFrameGeometryById: args.canvasFrameGeometryById,
      naturalHeight: args.naturalHeightsById?.[screen.id],
      sizeConstraints: readScreenSizeConstraints(
        args.screenRootComputedStylesById?.[screen.id],
      ),
    });
  });
  return geometryById;
}

export function getSelectedScreenGeometryForInspector(args: {
  selectedInspectorElementCount: number;
  selectedScreenIds: string[];
  overviewScreens: Array<{
    id: string;
    filename: string;
    title?: string;
    width?: number;
    height?: number;
    heightMode?: ScreenGeometrySelection["heightMode"];
  }>;
  canvasFrameGeometryById: CanvasFrameGeometryById;
  naturalHeightsById?: Record<string, number>;
  screenRootComputedStylesById?: Record<string, Record<string, string>>;
}): ScreenGeometrySelection | null {
  if (args.selectedInspectorElementCount > 0) return null;
  if (args.selectedScreenIds.length !== 1) return null;
  const screenId = args.selectedScreenIds[0];
  if (!screenId) return null;
  const screenIndex = args.overviewScreens.findIndex(
    (screen) => screen.id === screenId,
  );
  if (screenIndex < 0) return null;
  const screen = args.overviewScreens[screenIndex];
  if (!screen) return null;
  const geometry = resolveOverviewScreenFrameGeometry({
    screen,
    screenIndex,
    canvasFrameGeometryById: args.canvasFrameGeometryById,
    naturalHeight: args.naturalHeightsById?.[screenId],
    sizeConstraints: readScreenSizeConstraints(
      args.screenRootComputedStylesById?.[screenId],
    ),
  });
  return {
    id: screen.id,
    title: screen.title ?? prettyScreenName(screen.filename),
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    heightMode: screen.heightMode,
    sizeConstraints: readScreenSizeConstraints(
      args.screenRootComputedStylesById?.[screenId],
    ),
  };
}

function fileIdFromLayerSelectionId(
  layerId: string,
  fileIds: Set<string>,
): string | null {
  const normalized = layerId.startsWith("code:")
    ? layerId.slice("code:".length)
    : layerId;
  return fileIds.has(normalized) ? normalized : null;
}

export function getOverviewScreenIdsFromLayerSelection(args: {
  fileIds: string[];
  layerIds: string[];
}) {
  const fileIds = new Set(args.fileIds);
  const seen = new Set<string>();
  const selectedScreenIds: string[] = [];
  args.layerIds.forEach((layerId) => {
    const fileId = fileIdFromLayerSelectionId(layerId, fileIds);
    if (!fileId || seen.has(fileId)) return;
    seen.add(fileId);
    selectedScreenIds.push(fileId);
  });
  return selectedScreenIds;
}

export function getOverviewEnterTarget(args: {
  activeFileId: string | null | undefined;
  overviewSelectedScreenIds: string[];
}) {
  const { activeFileId, overviewSelectedScreenIds } = args;
  if (overviewSelectedScreenIds.length === 0) {
    return activeFileId ?? null;
  }
  if (activeFileId && overviewSelectedScreenIds.includes(activeFileId)) {
    return activeFileId;
  }
  return (
    overviewSelectedScreenIds[overviewSelectedScreenIds.length - 1] ?? null
  );
}

export function getSidebarCodeLayerSelectionState(args: {
  currentViewMode: "single" | "overview";
  ownerFileId?: string | null;
  overviewSelectedScreenIds: string[];
  screenFileIds?: string[];
}) {
  const { ownerFileId, overviewSelectedScreenIds, screenFileIds } = args;
  const ownerScreenId =
    ownerFileId && (!screenFileIds || screenFileIds.includes(ownerFileId))
      ? ownerFileId
      : null;
  return {
    viewMode: "overview" as const,
    overviewSelectedScreenIds: ownerScreenId
      ? [ownerScreenId]
      : ownerFileId
        ? []
        : overviewSelectedScreenIds,
  };
}

export function shouldLimitEditorChromeUntilContentReady(args: {
  fileCount: number;
  hasActiveCanvasContent: boolean;
  generating: boolean;
  pendingGenerationActive: boolean;
}) {
  const {
    fileCount,
    generating,
    hasActiveCanvasContent,
    pendingGenerationActive,
  } = args;
  return (
    (fileCount === 0 || !hasActiveCanvasContent) &&
    (generating || pendingGenerationActive)
  );
}

export function shouldEscapeToOverview(args: {
  activeTool: DesignTool;
  drawMode: boolean;
  mode: EditorMode;
  pinMode: boolean;
  selectedElement: ElementInfo | null;
  viewMode: "single" | "overview";
}) {
  const { activeTool, drawMode, mode, pinMode, selectedElement, viewMode } =
    args;
  return (
    viewMode === "single" &&
    !selectedElement &&
    !drawMode &&
    !pinMode &&
    mode === "edit" &&
    activeTool === "move"
  );
}

export function isDocumentShellCodeLayerNode(node: {
  tag: string;
  layerNameSource: string;
}): boolean {
  return (
    (node.tag === "html" || node.tag === "body") &&
    node.layerNameSource === "tag"
  );
}

export function hasSelectableCodeLayerParent(args: {
  parentNode: { tag: string; layerNameSource: string } | null | undefined;
}): boolean {
  return (
    args.parentNode != null && !isDocumentShellCodeLayerNode(args.parentNode)
  );
}

export function shouldClearBridgeSelectionOnEmptyMarquee(args: {
  resolvedCount: number;
  additive: boolean | undefined;
}): boolean {
  return args.resolvedCount === 0 && !args.additive;
}

export function resolveMarqueeAdditive(
  intent: ElementSelectionIntent | undefined,
): boolean {
  return Boolean(intent?.additive || intent?.range || intent?.shiftKey);
}

export function shouldClearSelectionForReviewThreadTarget(args: {
  activeFileId?: string | null;
  targetId?: string | null;
  boardFileId?: string | null;
}): boolean {
  if (args.targetId === null) {
    return Boolean(args.boardFileId && args.activeFileId !== args.boardFileId);
  }
  return Boolean(args.targetId && args.targetId !== args.activeFileId);
}

/**
 * PICK-RACE: MultiScreenCanvas's `onPick` prop is `(id: string) => void` — no
 * modifier/event info — even though a shift-click there already toggled a
 * full multi-id array internally (handleFrameClick's own `selectedIds`
 * state) before calling `onPick` with just the resulting PRIMARY id. That
 * full array only reaches DesignEditor a render later, via the
 * `onScreenSelectionChange` effect (MultiScreenCanvas reports its
 * `selectedIds` from a `useEffect` that commits after this synchronous
 * `onPick` call already ran).
 *
 * Forcing `selectedLayerIdsState` down to `[pickedId]` in
 * `handleOverviewScreenPick` is wrong for BOTH shift-click cases: adding a
 * screen would drop every other already-selected screen, and removing one
 * would replace the whole array with just the new primary — there is no way
 * to reconstruct the correct multi-id array from a single id. So: while
 * Shift is held, this returns the CURRENT selection unchanged instead of a
 * wrong singleton, and lets `overviewSelectedScreenIds` (which the
 * `selectedLayerIds` derivation already prefers whenever non-empty) be the
 * sole source of truth once that effect settles. When Shift isn't held this
 * is a plain single-screen pick, matching the previous unconditional
 * behavior.
 *
 * Exported for unit testing.
 */
export function computeOverviewScreenPickSelectionIds(args: {
  pickedId: string;
  shiftKeyHeld: boolean;
  currentSelectedLayerIds: string[];
}): string[] {
  return args.shiftKeyHeld ? args.currentSelectedLayerIds : [args.pickedId];
}

export function buildActiveFileNodeIdSet(
  projection: CodeLayerProjection,
): Set<string> {
  const ids = new Set<string>();
  for (const n of projection.nodes) {
    ids.add(n.id);
    const attrId = n.dataAttributes["data-agent-native-node-id"];
    if (attrId) ids.add(attrId);
  }
  return ids;
}

export function isUserOriginatedSelectionIntent(
  intent: ElementSelectionIntent | undefined,
): boolean {
  return Boolean(intent);
}

export function selectionHistorySnapshotsEqual(
  a: GeometryHistorySelection,
  b: GeometryHistorySelection,
): boolean {
  return (
    a.activeFileId === b.activeFileId &&
    sameStringIds(a.overviewSelectedScreenIds, b.overviewSelectedScreenIds) &&
    sameStringIds(a.selectedLayerIds, b.selectedLayerIds)
  );
}

export function elementInfoForSelectionSnapshot(
  selection: GeometryHistorySelection,
  codeLayerOwnerByNodeId: ReadonlyMap<string, { node: CodeLayerNode }>,
): ElementInfo | null {
  if (selection.selectedLayerIds.length !== 1) return null;
  const owner = codeLayerOwnerByNodeId.get(selection.selectedLayerIds[0]!);
  return owner ? elementInfoFromCodeLayerNode(owner.node) : null;
}

export function resolveEffectiveSelectedLayerIds(
  filtered: string[],
  selectedElementLayerId: string | null,
): string[] {
  if (selectedElementLayerId && !filtered.includes(selectedElementLayerId)) {
    return filtered.length > 1
      ? [...filtered, selectedElementLayerId]
      : [selectedElementLayerId];
  }
  return filtered;
}
