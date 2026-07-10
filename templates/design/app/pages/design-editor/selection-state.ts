import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { CodeLayerProjection } from "@shared/code-layer";
import type { DesignSourceType } from "@shared/source-mode";

import type { ScreenGeometrySelection } from "@/components/design/EditPanel";
import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { ElementInfo } from "@/components/design/types";
import { prettyScreenName } from "@/lib/screen-names";

import type { DesignTool, EditorMode } from "./types";

// PF11: cache the FNV hash by content-string value. Two calls with an equal
// (===, i.e. SameValueZero) content string always hash to the same
// signature, so a plain value-keyed Map is a correct cache — no need for
// reference-identity tricks. Bounded LRU-ish eviction (drop oldest entry)
// keeps this from growing unboundedly across a long editing session with
// many distinct HTML revisions.
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

export function shouldUseOverviewRuntimeReplacement({
  sourceType,
  externalSnapshotHtml,
}: {
  sourceType?: DesignSourceType | null;
  externalSnapshotHtml?: string | null;
}) {
  return sourceType === "inline" && !externalSnapshotHtml;
}

/**
 * Only inline HTML screens may contribute a fresh client snapshot to the
 * atomic screen-rename action. Localhost/fusion design_files rows intentionally
 * store a route URL marker rather than the rendered preview HTML; sending that
 * live snapshot as an override would silently convert the screen to inline
 * source and break /visual-edit.
 */
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

export function isScreenRootElementInfo(info: ElementInfo | null | undefined) {
  const tagName = info?.tagName?.toUpperCase();
  return tagName === "BODY" || tagName === "HTML";
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
  event: "select" | "clear";
}) {
  if (!args.pendingLayerId) return false;
  if (args.pendingScreenId && args.pendingScreenId !== args.screenId) {
    return false;
  }
  return args.event === "clear" || isScreenRootElementInfo(args.info);
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

export function getSelectedScreenGeometryForInspector(args: {
  selectedInspectorElementCount: number;
  selectedScreenIds: string[];
  overviewScreens: Array<{
    id: string;
    filename: string;
    title?: string;
    width?: number;
    height?: number;
  }>;
  canvasFrameGeometryById: CanvasFrameGeometryById;
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
  const fallbackGeometry = getInitialFrameGeometry(screenIndex, {
    width: screen.width ?? 1280,
    height: screen.height ?? 2560,
  });
  const persistedGeometry = args.canvasFrameGeometryById[screenId] ?? {};
  const geometry = {
    ...fallbackGeometry,
    ...persistedGeometry,
  };
  return {
    id: screen.id,
    title: screen.title ?? prettyScreenName(screen.filename),
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
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
  const {
    currentViewMode,
    ownerFileId,
    overviewSelectedScreenIds,
    screenFileIds,
  } = args;
  const ownerScreenId =
    ownerFileId && (!screenFileIds || screenFileIds.includes(ownerFileId))
      ? ownerFileId
      : null;
  return {
    viewMode: currentViewMode,
    overviewSelectedScreenIds:
      currentViewMode === "overview" && ownerScreenId
        ? [ownerScreenId]
        : currentViewMode === "overview" && ownerFileId
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

/**
 * B5-1: an empty-canvas click (a marquee/hit-test that resolved to zero
 * elements) must deselect ANY current selection kind — a selected
 * overview screen frame AND a selected element inside a screen (set via the
 * iframe bridge). `handleLayerMarqueeSelectionChange` already clears the
 * host-side `selectedElement` state when nothing was hit and the gesture
 * isn't additive; this helper decides whether it must ALSO signal the
 * iframe/bridge overlays to clear their own selection highlight
 * (`overviewClearSelectionRequest`) — otherwise a previously-selected
 * in-screen element keeps showing its selection chrome inside the iframe
 * even though the host's `selectedElement` is already null. True whenever
 * the resolved hit-set is empty and the gesture isn't additive (an additive
 * click/shift-click on empty space is a no-op, matching Escape and the
 * MultiScreenCanvas-level `shouldClearSelectionOnEmptyCanvasClick`).
 *
 * Exported for unit testing.
 */
export function shouldClearBridgeSelectionOnEmptyMarquee(args: {
  resolvedCount: number;
  additive: boolean | undefined;
}): boolean {
  return args.resolvedCount === 0 && !args.additive;
}

/**
 * Build the set of all node ids (both projection ids and data-agent-native-node-id
 * attribute values) that exist in the given projection. Used by handleGroupSelection
 * and handleUngroupSelection to filter selectedLayerIdsState to the active file's
 * nodes before passing them to wrapNodes / unwrap, preventing cross-file stale ids
 * from causing spurious "conflict" errors.
 *
 * Exported for unit testing.
 */
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
