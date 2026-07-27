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

/** Keep inline overview iframe identity stable across active-screen switches
 * and content/history updates. Inline overview screens have the bridge-backed
 * full-document replacement channel, so content changes belong in
 * `runtimeReplacementKey`, never in the iframe's srcdoc identity key. Other
 * source types retain the legacy remount fallback because they may not expose
 * an in-place document replacement bridge. */
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

/**
 * Undo/redo inspector-panel resync — decides whether a pending live edit
 * being reverted/replayed (by handleUndo's pendingStyleUndo/
 * pendingNonStyleUndo branches, or handleRedo's pendingTextRedo/
 * pendingLiveRedo branches) targets the SAME element as the current
 * `selectedElement`. Undo/redo aren't guaranteed to be undoing the
 * currently-selected element (the user may have re-selected something else
 * since the edit was made), so the panel should only be patched with the
 * revert/redo payload when this returns true — otherwise a background
 * undo would incorrectly clobber whatever the user has selected right now.
 * Matches by sourceId when BOTH sides carry one (the stable, authoritative
 * identity across re-renders) — a sourceId mismatch there means a different
 * element even if their selectors coincidentally collide (e.g. repeated
 * list items sharing one CSS selector). Falls back to the CSS selector only
 * when a sourceId comparison isn't possible on at least one side.
 *
 * Exported for unit testing.
 */
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
  // Layers-panel selection is applied optimistically in the host, then the
  // selected selector is mirrored into the overview iframe. The bridge echoes
  // that exact layer back as an ordinary element-select a frame later. Without
  // recognizing the matching id here, a Cmd/Ctrl toggle or Shift range briefly
  // renders the correct multi-selection and is then collapsed to the echoed
  // primary layer. Only ignore the exact pending layer; a real canvas click on
  // any other element must still replace the panel selection immediately.
  const echoedLayerId =
    args.info?.sourceId ?? args.info?.id ?? args.info?.pendingNodeId;
  return (
    args.resolvedLayerId === args.pendingLayerId ||
    echoedLayerId === args.pendingLayerId
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
 * A node's `parentId` in the FLAT code-layer ownership map
 * (`codeLayerOwnerByNodeId` / `codeLayerOwnerByNodeIdRef` in DesignEditor.tsx)
 * still points at `<html>`/`<body>` even though the VISUAL layers tree
 * collapses those document-shell nodes away (see shared/code-layer.ts's
 * `isCollapsibleDocumentShellNode` / `compactCodeLayerTreeNodes`) — the flat
 * map is built straight from `projection.nodes`, which is never filtered.
 * Mirrors `isCollapsibleDocumentShellNode`'s own check (tag is html/body AND
 * the layer name came from the tag itself, i.e. nothing more specific named
 * it) against the flat `CodeLayerNode`'s own fields directly, since the flat
 * node already carries `tag`/`layerNameSource` without needing a separate
 * lookup map.
 *
 * Both the Escape pop-one-level walk (`resolveEscapePopSelectionAction`) and
 * the shared Shift+Enter / "\\" select-parent walk (`handleSelectParentLayer`
 * in DesignEditor.tsx) must treat a parent that resolves to a document-shell
 * node as NO parent at all — otherwise popping from a top-level layer selects
 * the raw `<body>`/`<html>` DOM nodes instead of stopping at the screen/frame
 * level (or fully deselecting), which produces a permanently broken 0x0
 * inspector with no way back to a deselected state.
 *
 * Exported for unit testing.
 */
export function isDocumentShellCodeLayerNode(node: {
  tag: string;
  layerNameSource: string;
}): boolean {
  return (
    (node.tag === "html" || node.tag === "body") &&
    node.layerNameSource === "tag"
  );
}

/**
 * True only when `parentNode` exists AND is not a document-shell node — see
 * `isDocumentShellCodeLayerNode`. Callers walking the flat code-layer
 * ownership map (Escape pop-one-level, Shift+Enter select-parent) must use
 * this instead of a bare `Boolean(parentNode)` truthiness check, or a
 * top-level layer's collapsed `<body>`/`<html>` ancestor gets treated as a
 * selectable parent layer.
 *
 * Exported for unit testing.
 */
export function hasSelectableCodeLayerParent(args: {
  parentNode: { tag: string; layerNameSource: string } | null | undefined;
}): boolean {
  return (
    args.parentNode != null && !isDocumentShellCodeLayerNode(args.parentNode)
  );
}

export type EscapePopSelectionAction =
  | { kind: "pop-to-parent-layer" }
  | { kind: "pop-to-screen-frame" }
  | { kind: "deselect" };

/**
 * Figma parity — Escape on a plain canvas selection pops one level at a
 * time (child layer -> parent layer -> containing screen/frame -> fully
 * deselected) instead of deselecting everything on the first press.
 *
 * - A selected layer that has a code-layer parent (`hasLayerParent`) pops to
 *   that parent, reusing the same ancestor-walk `handleSelectParentLayer`
 *   (Shift+Enter / "\\") already uses via `codeLayerOwnerByNodeIdRef`.
 * - A selected TOP-level layer (no code-layer parent) in overview mode pops
 *   to selecting its containing screen/frame — the same selection kind
 *   (`overviewSelectedScreenIds`) clicking a frame directly in overview
 *   already produces.
 * - Anything else — nothing selected, or a top-level layer in single-screen
 *   mode where there's no separate "frame" to pop to (the screen already
 *   fills the view, so top-level already reads as "the frame boundary") —
 *   falls straight through to a full deselect, matching the previous
 *   unconditional Escape behavior.
 *
 * Callers must have already handled every higher-priority Escape consumer
 * (an in-progress marquee/drag, an active breakpoint edit target,
 * `shouldEscapeToOverview`'s zoom-out-to-overview case) before calling this
 * — it only decides the remaining plain-canvas-selection case.
 *
 * Exported for unit testing.
 */
export function resolveEscapePopSelectionAction(args: {
  hasSelectedLayer: boolean;
  hasLayerParent: boolean;
  viewMode: "single" | "overview";
}): EscapePopSelectionAction {
  if (args.hasSelectedLayer) {
    if (args.hasLayerParent) return { kind: "pop-to-parent-layer" };
    if (args.viewMode === "overview") return { kind: "pop-to-screen-frame" };
  }
  return { kind: "deselect" };
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

/** Clear element context only when a selected review thread changes screens. */
export function shouldClearSelectionForReviewThreadTarget(args: {
  activeFileId?: string | null;
  targetId?: string | null;
}): boolean {
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
