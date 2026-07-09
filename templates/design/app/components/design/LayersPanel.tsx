import { useT } from "@agent-native/core/client";
import {
  IconChevronDown,
  IconChevronRight,
  IconClipboard,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFrame,
  IconLayersSubtract,
  IconLayersUnion,
  IconLock,
  IconLockOpen,
  IconLayoutGrid,
  IconPencil,
  IconPlus,
  IconSearch,
  IconStackBack,
  IconStackFront,
} from "@tabler/icons-react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type LayersPanelNodeType =
  | "file"
  | "screen"
  | "frame"
  | "group"
  | "component"
  | "instance"
  | "section"
  | "shape"
  | "ellipse"
  | "rectangle"
  | "vector"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "text"
  | "image"
  | "code"
  | "element"
  | "board-element"
  | "unknown";

export interface LayersPanelNode {
  id: string;
  name: string;
  type?: LayersPanelNodeType;
  tagName?: string;
  layout?: {
    display?: string;
    flexDirection?: string;
    alignItems?: string;
    justifyContent?: string;
    isFlexContainer?: boolean;
    isGridContainer?: boolean;
  };
  children?: LayersPanelNode[];
  detail?: string;
  badge?: string | number;
  hidden?: boolean;
  locked?: boolean;
  selectable?: boolean;
  renamable?: boolean;
  lockable?: boolean;
  hideable?: boolean;
  icon?: ReactNode;
}

export interface LayersPanelScreen extends Omit<
  LayersPanelNode,
  "children" | "type"
> {
  type?: "screen" | "frame";
  layers?: LayersPanelNode[];
}

export interface LayersPanelFile extends Omit<
  LayersPanelNode,
  "children" | "type"
> {
  type?: "file";
  filename?: string;
  fileType?: string;
  screens?: LayersPanelScreen[];
  layers?: LayersPanelNode[];
}

export interface LayersPanelSelectionIntent {
  id: string;
  selectedIds: string[];
  additive: boolean;
  currentSelectedIds?: string[];
  range: boolean;
  source: "keyboard" | "pointer";
}

export interface LayersPanelMoveIntent {
  draggedIds: string[];
  targetId: string;
  placement: "before" | "after" | "inside";
}

export interface LayersPanelLabels {
  title: string;
  screens: string;
  allScreens: string;
  screenOverview: string;
  addScreen: string;
  searchPlaceholder: string;
  empty: string;
  noMatches: string;
  designLayers: string;
  codeLayers: string;
  elementLayers: string;
  collapse: string;
  expand: string;
  lock: string;
  unlock: string;
  hide: string;
  show: string;
  rename: string;
  copy: string;
  pasteToReplace: string;
  group: string;
  ungroup: string;
  frameSelection: string;
  bringToFront: string;
  sendToBack: string;
  flipHorizontal: string;
  flipVertical: string;
}

export interface LayersPanelProps {
  screens?: LayersPanelFile[];
  activeScreenId?: string;
  screenOverviewActive?: boolean;
  files?: LayersPanelFile[];
  layers?: LayersPanelNode[];
  codeLayers?: LayersPanelNode[];
  elementLayers?: LayersPanelNode[];
  selectedIds: readonly string[];
  expandedIds: readonly string[];
  searchQuery: string;
  className?: string;
  footer?: ReactNode;
  labels?: Partial<LayersPanelLabels>;
  onSearchQueryChange: (query: string) => void;
  onScreenSelect?: (id: string) => void;
  onScreenOverview?: () => void;
  onAddScreen?: () => void;
  onExpandedIdsChange: (ids: string[]) => void;
  onSelectionChange: (
    ids: string[],
    intent: LayersPanelSelectionIntent,
  ) => void;
  onRename?: (id: string, name: string) => void;
  onToggleLocked?: (id: string, locked: boolean) => void;
  onToggleHidden?: (id: string, hidden: boolean) => void;
  onHoverLayer?: (id: string) => void;
  onLeaveLayer?: (id: string) => void;
  onMoveLayer?: (intent: LayersPanelMoveIntent) => void;
  canMoveLayer?: (intent: LayersPanelMoveIntent) => boolean;
  // Board elements — top-level layer nodes projected from the board file.
  // When absent the panel is unchanged.
  boardElements?: LayersPanelNode[];
  // Id of a layer currently hovered elsewhere (e.g. on the canvas). When set,
  // the matching row gets a subtle hover-highlight background, visually
  // distinct from selection. This is display-only: it never triggers the
  // row's scroll-into-view behavior (that only follows selectedIds), and it
  // never affects keyboard focus. Optional — the panel is unchanged when
  // absent.
  hoveredLayerId?: string | null;
  // Figma-parity row context-menu actions beyond rename/lock/hide. Each item
  // renders only when its callback prop is provided, so the panel keeps
  // working correctly before every callback is wired up from the caller. See
  // the LayerRow context menu below for the exact order/separators/shortcut
  // hints — LIVE-VERIFIED against real Figma's layer-row menu: Copy, Paste
  // to replace, Bring to front, Send to back, Group selection, Frame
  // selection, Rename, Show/Hide, Lock/Unlock, Flip horizontal, Flip
  // vertical. Real Figma has NO Duplicate/Delete/Paste-here on this menu
  // (those are keyboard-only there), and NO Ungroup on a plain row — only on
  // a container row (see onUngroupSelection below).
  onCopyLayer?: (ids: string[]) => void;
  // Kept for callers that still wire it (e.g. a future keyboard shortcut or
  // a different surface); intentionally never rendered in the row menu
  // itself, matching Figma (no "Paste here" on layer rows).
  onPasteHere?: (targetId: string) => void;
  onPasteToReplace?: (ids: string[]) => void;
  // Kept for callers/back-compat; intentionally never rendered in the row
  // menu itself, matching Figma (Duplicate is keyboard-only there).
  onDuplicateLayer?: (ids: string[]) => void;
  // Kept for callers/back-compat; intentionally never rendered in the row
  // menu itself, matching Figma (Delete is keyboard-only there).
  onDeleteLayer?: (ids: string[]) => void;
  onGroupSelection?: (ids: string[]) => void;
  onFrameSelection?: (ids: string[]) => void;
  // Real Figma only offers Ungroup on a CONTAINER row (a group/frame you can
  // ungroup), not on a plain leaf row. The row gates rendering this on
  // `row.canAcceptChildren` (see showContextMenu/LayerRow below) in addition
  // to this callback being provided.
  onUngroupSelection?: (ids: string[]) => void;
  onReorderLayer?: (
    ids: string[],
    direction: "front" | "forward" | "backward" | "back",
  ) => void;
  onFlipHorizontal?: (ids: string[]) => void;
  onFlipVertical?: (ids: string[]) => void;
}

// L12: imperative handle so an external trigger (Cmd+R hotkey, canvas
// context-menu Rename item) can start the panel's inline rename editor on a
// specific layer, matching Figma. See beginRename below for what it does.
export interface LayersPanelHandle {
  /**
   * Starts inline rename for the given layer id. Returns false (and does
   * nothing) when the id doesn't resolve to a renamable row — i.e. it isn't
   * in the current tree, or the node has `renamable === false`. On success,
   * expands the layer's collapsed ancestors so the row is visible, scrolls
   * it into view, and focuses+selects the rename input once it mounts.
   */
  beginRename: (layerId: string) => boolean;
  /** Opens the existing layers search row and focuses its input. */
  focusSearch: () => void;
}

export interface FlatLayerRow {
  node: LayersPanelNode;
  rowKey: string;
  depth: number;
  ancestorIds: string[];
  hasChildren: boolean;
  canAcceptChildren: boolean;
}

// Node types that can contain children even when currently empty.
// Leaf / void types (text, image, shape, rectangle) are excluded so we don't
// offer an "inside" drop zone on genuinely non-container elements.
const CONTAINER_TYPES = new Set<LayersPanelNodeType | undefined>([
  "file",
  "screen",
  "frame",
  "group",
  "section",
  "component",
  "instance",
  "code",
  "element",
]);

const SECTION_CODE_ID = "__design_layers_code__";
const SECTION_ELEMENT_ID = "__design_layers_elements__";

// Module-level drag state: dataTransfer.getData() returns "" during dragover
// per spec; the source row stores the drag payload here on dragstart instead.
let activeDragState: { sourceId: string; draggedIds: string[] } | null = null;
let activeDropIntent: LayersPanelMoveIntent | null = null;

const ROW_BASE_INDENT = 4;
const ROW_INDENT_STEP = 28;

// No indent cap: deeply nested trees (Figma-style component instances easily
// exceed 4 levels) must stay visually distinguishable by depth. A previous
// 96px cap made every row at depth >= 4 render at the same indent, making
// nested structure ambiguous in the panel.
function rowIndent(depth: number): number {
  return ROW_BASE_INDENT + depth * ROW_INDENT_STEP;
}

function defaultLabels(t: ReturnType<typeof useT>): LayersPanelLabels {
  return {
    title: t("layersPanel.title"),
    screens: t("layersPanel.screens"),
    allScreens: t("layersPanel.allScreens"),
    screenOverview: t("designEditor.screenOverview"),
    addScreen: t("layersPanel.addScreen"),
    searchPlaceholder: t("layersPanel.searchPlaceholder"),
    empty: t("layersPanel.empty"),
    noMatches: t("layersPanel.noMatches"),
    designLayers: t("layersPanel.designLayers"),
    codeLayers: t("layersPanel.codeLayers"),
    elementLayers: t("layersPanel.elementLayers"),
    collapse: t("layersPanel.collapse"),
    expand: t("layersPanel.expand"),
    lock: t("layersPanel.lock"),
    unlock: t("layersPanel.unlock"),
    hide: t("layersPanel.hide"),
    show: t("layersPanel.show"),
    rename: t("layersPanel.rename"),
    copy: t("layersPanel.copy"),
    pasteToReplace: t("layersPanel.pasteToReplace"),
    group: t("layersPanel.group"),
    ungroup: t("layersPanel.ungroup"),
    frameSelection: t("layersPanel.frameSelection"),
    bringToFront: t("layersPanel.bringToFront"),
    sendToBack: t("layersPanel.sendToBack"),
    flipHorizontal: t("layersPanel.flipHorizontal"),
    flipVertical: t("layersPanel.flipVertical"),
  };
}

function mergeLabels(
  labels: LayersPanelProps["labels"],
  t: ReturnType<typeof useT>,
): LayersPanelLabels {
  return { ...defaultLabels(t), ...labels };
}

function asFileNode(file: LayersPanelFile): LayersPanelNode {
  const screens = file.screens?.map(asScreenNode) ?? [];
  return {
    ...file,
    type: "file",
    name: file.name || file.filename || "Untitled file",
    detail: file.detail ?? file.fileType,
    children: [...screens, ...(file.layers ?? [])],
  };
}

function asScreenNode(screen: LayersPanelScreen): LayersPanelNode {
  return {
    ...screen,
    type: screen.type ?? "screen",
    children: screen.layers ?? [],
  };
}

function sectionNode(
  id: string,
  name: string,
  children: LayersPanelNode[] | undefined,
): LayersPanelNode | null {
  if (!children?.length) return null;
  return {
    id,
    name,
    type: "section",
    selectable: false,
    renamable: false,
    lockable: false,
    hideable: false,
    children,
  };
}

function buildRootNodes({
  files,
  layers,
  codeLayers,
  elementLayers,
  boardElements,
  labels,
}: Pick<
  LayersPanelProps,
  "files" | "layers" | "codeLayers" | "elementLayers" | "boardElements"
> & {
  labels: LayersPanelLabels;
}) {
  const roots: LayersPanelNode[] = [
    ...(boardElements ?? []),
    ...(files?.map(asFileNode) ?? []),
    ...(layers ?? []),
  ];
  const codeSection = sectionNode(
    SECTION_CODE_ID,
    labels.codeLayers,
    codeLayers,
  );
  const elementSection = sectionNode(
    SECTION_ELEMENT_ID,
    labels.elementLayers,
    elementLayers,
  );

  if (codeSection) roots.push(codeSection);
  if (elementSection) roots.push(elementSection);
  return roots;
}

function nodeMatches(node: LayersPanelNode, query: string) {
  if (!query) return true;
  const haystack = [node.name, node.detail, node.type, node.badge]
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function filterNode(
  node: LayersPanelNode,
  query: string,
): LayersPanelNode | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return node;

  const children = node.children
    ?.map((child) => filterNode(child, normalized))
    .filter((child): child is LayersPanelNode => Boolean(child));

  if (nodeMatches(node, normalized) || children?.length) {
    return { ...node, children };
  }
  return null;
}

// ORDER CONVENTION (L5): the panel's top row within a sibling group is the
// topmost-RENDERED layer, matching Figma. LayersPanelNode.children arrives in
// DOM order (first array element = first DOM child = bottom of the paint
// stack for overlapping siblings; last DOM child = topmost paint). So the
// panel must display each sibling group in REVERSE DOM order. This is the
// single place that convention is applied — everything else (drop-placement
// mapping in dropPlacementForEvent/handleDrop callers, and the CL:2769
// moveNode "inside" insertion point) is written to agree with it:
//   - drop "above row X" (before X in the reversed panel list) => DOM order
//     "after" X (closer to the paint-top), i.e. inserted after X in the DOM.
//   - drop "below row X" (after X in the reversed panel list) => DOM order
//     "before" X, i.e. inserted before X in the DOM.
//   - "inside" a container drops at the END of the panel's child list, i.e.
//     the FIRST DOM child position (contentStart), so the dropped node
//     becomes the bottom-most-painted / top-of-panel-list child. See
//     mapPanelPlacementToDomPlacement below and its use at the LP/DE drop
//     boundary.
export function flattenRows(
  nodes: LayersPanelNode[],
  expandedIds: ReadonlySet<string>,
  forceExpanded: boolean,
  depth = 0,
  parentKey = "root",
  ancestorIds: string[] = [],
  rows: FlatLayerRow[] = [],
) {
  const displayOrder = [...nodes].reverse();
  displayOrder.forEach((node, index) => {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const canAcceptChildren = CONTAINER_TYPES.has(node.type);
    const rowKey = `${parentKey}/${node.id}:${index}`;
    rows.push({
      node,
      rowKey,
      depth,
      ancestorIds,
      hasChildren,
      canAcceptChildren,
    });
    if (hasChildren && (forceExpanded || expandedIds.has(node.id))) {
      flattenRows(
        children,
        expandedIds,
        forceExpanded,
        depth + 1,
        rowKey,
        [...ancestorIds, node.id],
        rows,
      );
    }
  });
  return rows;
}

/**
 * Maps a panel-order drop placement (computed from where the user dropped
 * relative to a row's position in the reversed, top-row-is-topmost panel
 * list) to the DOM-order placement the underlying moveNode/applyMoveNodeEdit
 * primitive expects (see CL applyMoveNodeEdit: "before" = anchor.start,
 * "after" = anchor.end, "inside" = anchor.contentEnd i.e. last DOM child).
 *
 * Because the panel displays each sibling group in reverse DOM order:
 *   - "before" in the panel (drop above row X, i.e. towards the top/topmost)
 *     means the moved node should render ABOVE X, i.e. paint AFTER X in the
 *     DOM => DOM placement "after".
 *   - "after" in the panel (drop below row X, towards the bottom/backmost)
 *     means the moved node should render BELOW X, i.e. paint BEFORE X in the
 *     DOM => DOM placement "before".
 *   - "inside" is unchanged in kind, but the DOM primitive already inserts at
 *     contentEnd (last DOM child), which is exactly the panel's "top of this
 *     group's list" — i.e. inside-drops naturally land at the top of the
 *     panel's child list with no further mapping needed.
 */
export function mapPanelPlacementToDomPlacement(
  placement: LayersPanelMoveIntent["placement"],
): LayersPanelMoveIntent["placement"] {
  if (placement === "before") return "after";
  if (placement === "after") return "before";
  return "inside";
}

/**
 * Converts the panel's top-to-bottom visual ordering into the DOM ordering
 * consumed by DesignEditor's structural move pipeline. Sibling groups are
 * rendered in reverse DOM order in the panel, so both the anchor placement
 * and a multi-selection's order must be reversed at this boundary.
 */
export function mapPanelMoveIntentToDomIntent(
  intent: LayersPanelMoveIntent,
): LayersPanelMoveIntent {
  return {
    ...intent,
    draggedIds: [...intent.draggedIds].reverse(),
    placement: mapPanelPlacementToDomPlacement(intent.placement),
  };
}

function nextExpandedIds(
  ids: readonly string[],
  nodeId: string,
  expanded: boolean,
) {
  const next = new Set(ids);
  if (expanded) {
    next.add(nodeId);
  } else {
    next.delete(nodeId);
  }
  return Array.from(next);
}

// Alt-click on a row's expand chevron (Figma behavior): expand/collapse the
// node AND every descendant that can itself have children, in one batched
// state change. Pure tree walk — collects every node id with a non-empty
// children array so nextExpandedIdsForSubtree can add/remove them all at
// once instead of the caller looping many onExpandedIdsChange calls.
export function collectDescendantContainerIds(node: LayersPanelNode): string[] {
  const ids: string[] = [];
  function visit(current: LayersPanelNode) {
    const children = current.children ?? [];
    if (children.length === 0) return;
    ids.push(current.id);
    children.forEach(visit);
  }
  visit(node);
  return ids;
}

export function nextExpandedIdsForSubtree(
  ids: readonly string[],
  node: LayersPanelNode,
  expanded: boolean,
): string[] {
  const subtreeIds = collectDescendantContainerIds(node);
  const next = new Set(ids);
  subtreeIds.forEach((id) => {
    if (expanded) {
      next.add(id);
    } else {
      next.delete(id);
    }
  });
  return Array.from(next);
}

/**
 * L1: pure computation for the auto-expand-ancestors-of-selection effect.
 * Given the current selection's ancestor ids and the CURRENT expanded set,
 * returns the next expanded id list with any missing ancestors added, or
 * null if nothing needs to change. Extracted as a pure function (mirroring
 * shouldResyncLayerSelectionAnchor) so the auto-expand decision is testable
 * without mounting the component. The caller is responsible for only
 * invoking this once per NEW selection signature — see the
 * lastAutoExpandedSelectionRef gate in the effect below, which is what
 * actually fixes the collapse-bounces-back-instantly bug (this function
 * itself is a straightforward set-union and isn't where that bug lived).
 */
export function nextAutoExpandedIds(args: {
  selectedAncestorIds: readonly string[];
  expandedIds: readonly string[];
}): string[] | null {
  if (args.selectedAncestorIds.length === 0) return null;
  const next = new Set(args.expandedIds);
  let changed = false;
  args.selectedAncestorIds.forEach((id) => {
    if (!next.has(id)) {
      next.add(id);
      changed = true;
    }
  });
  return changed ? Array.from(next) : null;
}

function collectAncestorIds(
  nodes: LayersPanelNode[],
  targetIds: ReadonlySet<string>,
): string[] {
  const ancestors = new Set<string>();

  function visit(node: LayersPanelNode, path: string[]): boolean {
    const children = node.children ?? [];
    let containsSelectedChild = false;
    children.forEach((child) => {
      if (visit(child, [...path, node.id])) {
        containsSelectedChild = true;
      }
    });
    const containsSelected = targetIds.has(node.id) || containsSelectedChild;
    if (containsSelected) {
      path.forEach((id) => ancestors.add(id));
    }
    return containsSelected;
  }

  nodes.forEach((node) => visit(node, []));
  return Array.from(ancestors);
}

// Full-tree ancestor map (id -> ancestor id chain from root), independent of
// expand/collapse or search-filter state. Used at drag start to correctly
// identify selected descendants even when their row is currently not
// rendered in visibleRows (e.g. inside a collapsed ancestor) — see
// getDraggedLayerIdsForRows below.
export function buildAncestorIdMap(
  nodes: LayersPanelNode[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  function visit(node: LayersPanelNode, ancestorIds: string[]) {
    map.set(node.id, ancestorIds);
    const children = node.children ?? [];
    children.forEach((child) => visit(child, [...ancestorIds, node.id]));
  }

  nodes.forEach((node) => visit(node, []));
  return map;
}

// L12: find a node anywhere in the full (unfiltered) tree by id, alongside
// its ancestor id chain. Used by beginRename to validate the target and to
// know which ancestors must be expanded for the row to become visible,
// independent of the current search/expand state.
export function findNodeWithAncestors(
  nodes: LayersPanelNode[],
  targetId: string,
): { node: LayersPanelNode; ancestorIds: string[] } | null {
  function visit(
    node: LayersPanelNode,
    ancestorIds: string[],
  ): { node: LayersPanelNode; ancestorIds: string[] } | null {
    if (node.id === targetId) return { node, ancestorIds };
    const children = node.children ?? [];
    for (const child of children) {
      const found = visit(child, [...ancestorIds, node.id]);
      if (found) return found;
    }
    return null;
  }

  for (const node of nodes) {
    const found = visit(node, []);
    if (found) return found;
  }
  return null;
}

export function getLayerSelectionAnchorFromExternalSelection(args: {
  selectedIds: readonly string[];
  selectableVisibleIds: readonly string[];
}): string | null {
  const selectableVisibleIdSet = new Set(args.selectableVisibleIds);
  return (
    [...args.selectedIds]
      .reverse()
      .find((id) => selectableVisibleIdSet.has(id)) ?? null
  );
}

export function getTreeOrderedLayerIds(
  ids: readonly string[],
  visibleRows: readonly FlatLayerRow[],
): string[] {
  const idSet = new Set(ids.filter((id) => id && !id.startsWith("__")));
  const orderedIds = visibleRows
    .map((row) => row.node.id)
    .filter((id) => idSet.has(id));
  const orderedIdSet = new Set(orderedIds);
  return [
    ...orderedIds,
    ...ids.filter((id) => id && !id.startsWith("__") && !orderedIdSet.has(id)),
  ];
}

// Shift-range selection is a straight slice through the flattened visible
// rows, so when the range spans an expanded parent AND some of its children,
// both end up selected. Figma normalizes this away: selecting an ancestor
// already implies its descendants for move/visual purposes, so a descendant
// whose ancestor is also in the resulting set should be dropped from the
// selection (the ancestor "wins"). Order-preserving.
export function dropDescendantsOfSelectedAncestors(
  ids: readonly string[],
  visibleRows: readonly FlatLayerRow[],
): string[] {
  const idSet = new Set(ids);
  const ancestorIdsById = new Map(
    visibleRows.map((row) => [row.node.id, row.ancestorIds] as const),
  );
  return ids.filter((id) => {
    const ancestorIds = ancestorIdsById.get(id);
    return !ancestorIds?.some((ancestorId) => idSet.has(ancestorId));
  });
}

export function getDraggedLayerIdsForRows(args: {
  selectedIds: readonly string[];
  nodeId: string;
  visibleRows: readonly FlatLayerRow[];
  // Full-tree ancestor map (see buildAncestorIdMap), independent of
  // expand/collapse or search-filter state. Required to correctly drop
  // selected descendants whose row is currently not in visibleRows (e.g.
  // inside a collapsed dragged parent) — falling back to visibleRows-only
  // ancestor lookup would treat those as separate top-level drags and
  // extract them from the parent being dragged. Optional only for
  // call-site/back-compat convenience; always pass it in the real panel.
  ancestorIdMap?: ReadonlyMap<string, string[]>;
}): string[] {
  const rawDraggedIds = args.selectedIds.includes(args.nodeId)
    ? getTreeOrderedLayerIds(args.selectedIds, args.visibleRows)
    : [args.nodeId];
  const draggedIdSet = new Set(rawDraggedIds);
  return rawDraggedIds.filter((id) => {
    const ancestorIds =
      args.ancestorIdMap?.get(id) ??
      args.visibleRows.find((row) => row.node.id === id)?.ancestorIds;
    return !ancestorIds?.some((ancestorId) => draggedIdSet.has(ancestorId));
  });
}

// Row context-menu actions (copy/duplicate/delete/group/reorder) operate on
// the whole current selection when the right-clicked row is already part of
// it (matching Figma), or on just that row otherwise (right-clicking an
// unselected layer acts on that layer alone). Mirrors the same shape as
// getDraggedLayerIdsForRows's selection-vs-single-row resolution, kept
// separate since context-menu actions don't need the descendant-exclusion
// step a drag payload does.
export function getContextMenuTargetIds(args: {
  selectedIds: readonly string[];
  nodeId: string;
  visibleRows: readonly FlatLayerRow[];
}): string[] {
  return args.selectedIds.includes(args.nodeId)
    ? getTreeOrderedLayerIds(args.selectedIds, args.visibleRows)
    : [args.nodeId];
}

export function shouldResyncLayerSelectionAnchor(args: {
  selectionSignature: string;
  lastPanelSelectionSignature: string;
  currentAnchor: string | null;
  selectableVisibleIds: readonly string[];
}) {
  const anchorStillVisible =
    args.currentAnchor !== null &&
    args.selectableVisibleIds.includes(args.currentAnchor);
  return (
    args.selectionSignature !== args.lastPanelSelectionSignature ||
    !anchorStillVisible
  );
}

function layerCanShowBadge(node: LayersPanelNode) {
  return (
    node.type === "file" ||
    node.type === "screen" ||
    (node.type === "frame" && node.id.startsWith("__"))
  );
}

// PF8: DesignEditor re-renders on many state changes unrelated to the layers
// tree (drag gestures, zoom, canvas hover, etc). All of LayersPanel's call-site
// props are already stabilized (useMemo/useCallback/plain state — see
// DesignEditor.tsx's layerPanelFiles/overviewLayerPanelFiles/
// activeLayerPanelNodes/boardElements and the onXxx handlers passed to
// <LayersPanel>), so a default shallow-prop comparator is sufficient here;
// no custom comparator is needed or wanted since it would risk silently
// ignoring a genuinely-changed prop.
// L12: forwardRef is composed OUTSIDE memo (memo(forwardRef(...))) — this is
// the standard ordering and keeps the default shallow-prop memo comparator
// applying to the same props as before; the ref itself is never part of that
// comparison (React handles ref identity separately from memo's prop diff).
function LayersPanelImpl(
  {
    screens,
    activeScreenId,
    screenOverviewActive = false,
    files,
    layers,
    codeLayers,
    elementLayers,
    selectedIds,
    expandedIds,
    searchQuery,
    className,
    footer,
    labels: labelsProp,
    onSearchQueryChange,
    onScreenSelect,
    onScreenOverview,
    onAddScreen,
    onExpandedIdsChange,
    onSelectionChange,
    onRename,
    onToggleLocked,
    onToggleHidden,
    onHoverLayer,
    onLeaveLayer,
    onMoveLayer,
    canMoveLayer,
    boardElements,
    hoveredLayerId,
    onCopyLayer,
    onPasteHere,
    onPasteToReplace,
    onDuplicateLayer,
    onDeleteLayer,
    onGroupSelection,
    onFrameSelection,
    onUngroupSelection,
    onReorderLayer,
    onFlipHorizontal,
    onFlipVertical,
  }: LayersPanelProps,
  ref: Ref<LayersPanelHandle>,
) {
  const t = useT();
  const labels = useMemo(() => mergeLabels(labelsProp, t), [labelsProp, t]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedIdsRef = useRef<readonly string[]>(selectedIds);
  // Rows need the full visible-row order for keyboard navigation and
  // multi-drag payload ordering, but that's whole-tree state, not a per-row
  // primitive. Route it through a stable ref instead of a prop so passing it
  // to LayerRow doesn't defeat React.memo (the ref object identity never
  // changes; only .current does).
  const visibleRowsRef = useRef<FlatLayerRow[]>([]);
  // Full (unfiltered-by-expand/collapse) root nodes, threaded the same way so
  // drag start can build a full-tree ancestor map (see buildAncestorIdMap)
  // without adding a per-row array prop that would defeat React.memo.
  const rootsRef = useRef<LayersPanelNode[]>([]);
  // Same idea for expandedIds: onToggleExpanded needs the current expanded
  // set to compute the next one, but reading it from a ref lets the
  // per-row callback stay referentially stable across renders.
  const expandedIdsRef = useRef<readonly string[]>(expandedIds);
  expandedIdsRef.current = expandedIds;
  const lastPanelSelectionSignatureRef = useRef(selectedIds.join("\0"));
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const lastSelectionAnchorRef = useRef<string | null>(selectedIds[0] ?? null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowElementRefs = useRef(new Map<string, HTMLDivElement>());
  // L20: edge auto-scroll during a row drag. scrollContainerRef is the
  // scrollable rows list; autoScrollFrameRef holds the active rAF handle (or
  // null when idle); autoScrollDirectionRef holds the current scroll
  // direction/speed so the rAF loop keeps scrolling smoothly across frames
  // without needing dragover to fire every frame (dragover cadence is
  // browser-throttled and not reliable enough on its own for smooth scroll).
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollSpeedRef = useRef(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameOriginalNameRef = useRef<string>("");
  const [dropIndicator, setDropIndicator] =
    useState<LayersPanelMoveIntent | null>(null);
  const [searchOpen, setSearchOpen] = useState(Boolean(searchQuery));

  const roots = useMemo(
    () =>
      buildRootNodes({
        files,
        layers,
        codeLayers,
        elementLayers,
        boardElements,
        labels,
      }),
    [boardElements, codeLayers, elementLayers, files, labels, layers],
  );

  const visibleRows = useMemo(() => {
    const filtered = roots
      .map((node) => filterNode(node, searchQuery))
      .filter((node): node is LayersPanelNode => Boolean(node));
    return flattenRows(filtered, expandedIdSet, Boolean(searchQuery.trim()));
  }, [expandedIdSet, roots, searchQuery]);

  const selectedAncestorIds = useMemo(
    () => collectAncestorIds(roots, selectedIdSet),
    [roots, selectedIdSet],
  );

  const selectableVisibleIds = useMemo(
    () =>
      visibleRows
        .map(({ node }) => node)
        .filter((node) => node.selectable !== false)
        .map((node) => node.id),
    [visibleRows],
  );

  // Keep the row-facing refs current every render. This runs during render
  // (not an effect) so event handlers created during this same commit already
  // see the latest arrays; it never triggers a re-render itself since only
  // `.current` is written.
  visibleRowsRef.current = visibleRows;
  rootsRef.current = roots;

  useLayoutEffect(() => {
    selectedIdsRef.current = selectedIds;
    const signature = selectedIds.join("\0");
    if (
      !shouldResyncLayerSelectionAnchor({
        selectionSignature: signature,
        lastPanelSelectionSignature: lastPanelSelectionSignatureRef.current,
        currentAnchor: lastSelectionAnchorRef.current,
        selectableVisibleIds,
      })
    ) {
      return;
    }
    lastPanelSelectionSignatureRef.current = signature;
    lastSelectionAnchorRef.current =
      getLayerSelectionAnchorFromExternalSelection({
        selectedIds,
        selectableVisibleIds,
      });
  }, [selectableVisibleIds, selectedIds]);

  // Auto-expand ancestors of the current selection. This must run only when
  // the SELECTION changes (a new selection signature), not whenever
  // expandedIds changes — otherwise collapsing an ancestor of the selected
  // layer (which changes expandedIds but not the selection) would
  // immediately re-expand it, since selectedAncestorIds still contains it.
  // Track the selection signature we last auto-expanded for in a ref so the
  // effect can bail out on every render triggered purely by a collapse.
  const lastAutoExpandedSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    const signature = selectedIds.join("\0");
    if (lastAutoExpandedSelectionRef.current === signature) return;
    lastAutoExpandedSelectionRef.current = signature;
    const nextExpanded = nextAutoExpandedIds({
      selectedAncestorIds,
      expandedIds: expandedIdsRef.current,
    });
    if (nextExpanded) onExpandedIdsChange(nextExpanded);
    // Intentionally NOT depending on expandedIds: this effect must only react
    // to selection changes (selectedIds / selectedAncestorIds), and reads the
    // current expanded set from expandedIdsRef so a collapse doesn't retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExpandedIdsChange, selectedAncestorIds, selectedIds]);

  const selectedScrollId = selectedIds[selectedIds.length - 1] ?? null;
  const selectedScrollRowKey = useMemo(() => {
    if (!selectedScrollId) return null;
    return (
      visibleRows.find((row) => row.node.id === selectedScrollId)?.rowKey ??
      null
    );
  }, [selectedScrollId, visibleRows]);

  useEffect(() => {
    if (!selectedScrollRowKey) return;
    const frame = window.requestAnimationFrame(() => {
      rowElementRefs.current.get(selectedScrollRowKey)?.scrollIntoView({
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedScrollRowKey]);

  const selectNode = useCallback(
    (
      id: string,
      options: {
        additive: boolean;
        currentSelectedIds?: string[];
        range: boolean;
        source: "keyboard" | "pointer";
      },
    ) => {
      const currentSelectedIds =
        options.currentSelectedIds ?? selectedIdsRef.current;
      const currentSelectedIdSet = new Set(currentSelectedIds);
      let nextIds: string[];
      if (options.range && lastSelectionAnchorRef.current) {
        let anchor = lastSelectionAnchorRef.current;
        if (selectableVisibleIds.indexOf(anchor) < 0) {
          // Stale anchor (deleted / filtered / collapsed out of view): pivot from
          // the last selected layer that is still visible & selectable, matching
          // Figma's behavior instead of dropping the range to a single select.
          const fallback = [...selectedIds]
            .reverse()
            .find((sid) => selectableVisibleIds.includes(sid));
          if (fallback) {
            anchor = fallback;
            lastSelectionAnchorRef.current = fallback;
          }
        }
        const from = selectableVisibleIds.indexOf(anchor);
        const to = selectableVisibleIds.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const rangeIds = selectableVisibleIds.slice(start, end + 1);
          const merged = options.additive
            ? Array.from(new Set([...currentSelectedIds, ...rangeIds]))
            : rangeIds;
          // A range that spans an expanded parent and some of its children
          // would otherwise co-select both. Normalize so a selected
          // descendant whose ancestor is also selected gets dropped — the
          // ancestor selection already implies it.
          nextIds = dropDescendantsOfSelectedAncestors(
            merged,
            visibleRowsRef.current,
          );
        } else {
          nextIds = [id];
        }
      } else if (options.additive) {
        nextIds = currentSelectedIdSet.has(id)
          ? currentSelectedIds.filter((selectedId) => selectedId !== id)
          : [...currentSelectedIds, id];
      } else {
        nextIds = [id];
      }
      // Only advance the anchor on plain clicks; Shift+clicks extend from the
      // existing anchor so the pivot stays fixed across consecutive range clicks.
      if (!options.range) {
        lastSelectionAnchorRef.current = id;
      }
      lastPanelSelectionSignatureRef.current = nextIds.join("\0");
      onSelectionChange(nextIds, { id, selectedIds: nextIds, ...options });
    },
    [onSelectionChange, selectableVisibleIds],
  );

  const commitRename = useCallback(
    (id: string) => {
      const nextName = renameDraft.trim();
      // The panel only emits rename intent. Code-backed DOM layer renames must
      // persist through a safe source edit that updates data-agent-native-layer-name.
      if (nextName) {
        onRename?.(id, nextName);
      }
      // When the draft is empty, silently revert rather than saving an empty name.
      // This matches Figma's behavior of restoring the previous name on empty commit.
      setRenamingId(null);
      setRenameDraft("");
      renameOriginalNameRef.current = "";
    },
    [onRename, renameDraft],
  );

  const startRename = useCallback(
    (node: LayersPanelNode) => {
      if (!onRename || node.renamable === false) return;
      renameOriginalNameRef.current = node.name;
      setRenamingId(node.id);
      setRenameDraft(node.name);
    },
    [onRename],
  );

  const registerRowElement = useCallback(
    (rowKey: string, element: HTMLDivElement | null) => {
      if (element) {
        rowElementRefs.current.set(rowKey, element);
      } else {
        rowElementRefs.current.delete(rowKey);
      }
    },
    [],
  );

  // L12: id of a layer whose rename was started externally (beginRename) and
  // is waiting for its row to become visible/mounted so the input can be
  // focused. Ancestor expansion is asynchronous (it flows out through
  // onExpandedIdsChange and back in via the expandedIds prop), so we can't
  // synchronously focus the input the same tick beginRename runs — the row
  // may not exist in the DOM yet. The effect below watches for the row to
  // appear in rowElementRefs and finishes the job once it does.
  const pendingRenameFocusIdRef = useRef<string | null>(null);

  const focusSearch = useCallback(() => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const beginRename = useCallback(
    (layerId: string): boolean => {
      if (!onRename) return false;
      const found = findNodeWithAncestors(rootsRef.current, layerId);
      if (!found || found.node.renamable === false) return false;
      const { node, ancestorIds } = found;

      renameOriginalNameRef.current = node.name;
      setRenamingId(node.id);
      setRenameDraft(node.name);

      const nextExpanded = nextAutoExpandedIds({
        selectedAncestorIds: ancestorIds,
        expandedIds: expandedIdsRef.current,
      });
      if (nextExpanded) onExpandedIdsChange(nextExpanded);

      pendingRenameFocusIdRef.current = node.id;
      return true;
    },
    [onExpandedIdsChange, onRename],
  );

  useImperativeHandle(ref, () => ({ beginRename, focusSearch }), [
    beginRename,
    focusSearch,
  ]);

  // Finishes an in-flight beginRename once its row is mounted: scrolls it
  // into view and focuses+selects the rename input (the input already
  // select-on-focuses via its own onFocus handler below). Depends on
  // renamingId and visibleRows so it re-checks whenever either the rename
  // target or ancestor-expansion state changes — the row can become visible
  // either on this same render (already expanded) or a later one (ancestors
  // needed expanding first, which round-trips through onExpandedIdsChange).
  useEffect(() => {
    const pendingId = pendingRenameFocusIdRef.current;
    if (!pendingId || renamingId !== pendingId) return;
    const rowKey = visibleRows.find((row) => row.node.id === pendingId)?.rowKey;
    if (!rowKey) return;
    const frame = window.requestAnimationFrame(() => {
      const rowElement = rowElementRefs.current.get(rowKey);
      rowElement?.scrollIntoView({ block: "nearest" });
      rowElement
        ?.querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true });
    });
    pendingRenameFocusIdRef.current = null;
    return () => window.cancelAnimationFrame(frame);
  }, [renamingId, visibleRows]);

  // Id-first, stable callbacks for LayerRow. Each reads current
  // expandedIds/onExpandedIdsChange/onRename from refs/closure-captured
  // props at call time rather than recreating a fresh per-row closure every
  // render — this keeps LayerRow's props referentially stable so
  // React.memo(LayerRow) actually skips re-renders.
  const handleToggleExpanded = useCallback(
    (id: string, expanded: boolean, node?: LayersPanelNode) => {
      // Alt-click (see LayerRow's chevron onClick): expand/collapse this node
      // AND all of its descendants in one batched state change, matching
      // Figma. Only takes this path when the caller passes the node (the
      // plain toggle path below stays a single-id update).
      if (node) {
        onExpandedIdsChange(
          nextExpandedIdsForSubtree(expandedIdsRef.current, node, expanded),
        );
        return;
      }
      onExpandedIdsChange(
        nextExpandedIds(expandedIdsRef.current, id, expanded),
      );
    },
    [onExpandedIdsChange],
  );

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  const hasAnyRows = roots.length > 0;
  const screenRows = screens ?? files ?? [];
  const shouldShowSearch = searchOpen || Boolean(searchQuery.trim());
  const collapseTargetId = useMemo(() => {
    for (let index = selectedIds.length - 1; index >= 0; index -= 1) {
      const selectedRow = visibleRows.find(
        (row) => row.node.id === selectedIds[index],
      );
      if (!selectedRow) continue;
      if (selectedRow.hasChildren && expandedIdSet.has(selectedRow.node.id)) {
        return selectedRow.node.id;
      }
    }
    return null;
  }, [expandedIdSet, selectedIds, visibleRows]);

  const collapseSelectedLayer = useCallback(() => {
    if (!collapseTargetId) return;
    onExpandedIdsChange(
      expandedIds.filter((expandedId) => expandedId !== collapseTargetId),
    );
  }, [collapseTargetId, expandedIds, onExpandedIdsChange]);

  // L20: auto-scroll the rows list while dragging near the top/bottom edge.
  // Runs a rAF loop so the scroll speed stays smooth and independent of the
  // browser's dragover event cadence.
  const AUTO_SCROLL_EDGE_PX = 40;
  const AUTO_SCROLL_MAX_SPEED_PX = 14;

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    autoScrollSpeedRef.current = 0;
  }, []);

  const runAutoScrollFrame = useCallback(() => {
    const container = scrollContainerRef.current;
    const speed = autoScrollSpeedRef.current;
    if (!container || speed === 0) {
      autoScrollFrameRef.current = null;
      return;
    }
    container.scrollTop += speed;
    autoScrollFrameRef.current =
      window.requestAnimationFrame(runAutoScrollFrame);
  }, []);

  const handleRowsDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!activeDragState) {
        stopAutoScroll();
        return;
      }
      const container = scrollContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const offsetFromTop = event.clientY - rect.top;
      const offsetFromBottom = rect.bottom - event.clientY;
      let speed = 0;
      if (offsetFromTop < AUTO_SCROLL_EDGE_PX) {
        const intensity = 1 - Math.max(0, offsetFromTop) / AUTO_SCROLL_EDGE_PX;
        speed = -Math.ceil(intensity * AUTO_SCROLL_MAX_SPEED_PX);
      } else if (offsetFromBottom < AUTO_SCROLL_EDGE_PX) {
        const intensity =
          1 - Math.max(0, offsetFromBottom) / AUTO_SCROLL_EDGE_PX;
        speed = Math.ceil(intensity * AUTO_SCROLL_MAX_SPEED_PX);
      }
      autoScrollSpeedRef.current = speed;
      if (speed !== 0 && autoScrollFrameRef.current === null) {
        autoScrollFrameRef.current =
          window.requestAnimationFrame(runAutoScrollFrame);
      } else if (speed === 0) {
        stopAutoScroll();
      }
    },
    [runAutoScrollFrame, stopAutoScroll],
  );

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--design-editor-panel-bg)] text-[12px] text-foreground",
        className,
      )}
      aria-label={labels.title}
    >
      {screenRows.length > 0 ? (
        <div className="shrink-0 border-b border-[var(--design-editor-panel-divider-color)] pb-2">
          <div className="flex h-10 items-center justify-between px-3">
            <h2 className="truncate text-[12px] font-semibold text-foreground">
              {labels.screens}
            </h2>
            <div className="flex items-center gap-0.5 text-muted-foreground">
              <IconTooltipButton
                label={labels.searchPlaceholder}
                onClick={focusSearch}
              >
                <IconSearch className="size-4" />
              </IconTooltipButton>
              <IconTooltipButton
                label={labels.addScreen}
                disabled={!onAddScreen}
                onClick={onAddScreen}
              >
                <IconPlus className="size-4" />
              </IconTooltipButton>
            </div>
          </div>
          <div className="px-2">
            <button
              type="button"
              className={cn(
                "flex h-8 w-full cursor-default items-center gap-2 rounded-[5px] px-2 text-left text-[12px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                screenOverviewActive
                  ? "bg-[var(--design-editor-active-row-color)] text-foreground"
                  : "text-foreground/85 hover:bg-[var(--design-editor-active-row-color)] hover:text-foreground",
              )}
              aria-current={screenOverviewActive ? "page" : undefined}
              onClick={() => onScreenOverview?.()}
              title={labels.allScreens}
            >
              <IconLayoutGrid className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {labels.allScreens}
              </span>
            </button>
          </div>
          <div className="mx-3 my-2 border-t border-[var(--design-editor-panel-divider-color)]" />
          <div className="space-y-0.5 px-2">
            {screenRows.map((screen) => {
              const isActive =
                !screenOverviewActive && screen.id === activeScreenId;
              return (
                <button
                  key={screen.id}
                  type="button"
                  className={cn(
                    "flex h-8 w-full cursor-default items-center gap-2 rounded-[5px] px-2 text-left text-[12px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                    isActive
                      ? "bg-[var(--design-editor-active-row-color)] text-foreground"
                      : "text-foreground/85 hover:bg-[var(--design-editor-active-row-color)] hover:text-foreground",
                  )}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onScreenSelect?.(screen.id)}
                  title={screen.filename ?? screen.name}
                >
                  <LayerGlyph node={{ ...screen, type: "file" }} />
                  <span className="min-w-0 flex-1 truncate">{screen.name}</span>
                  {screen.badge ? (
                    <span className="rounded-sm bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                      {screen.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <div className="min-w-0">
          <h2 className="truncate text-[12px] font-semibold text-foreground">
            {labels.title}
          </h2>
        </div>
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
            aria-label={labels.collapse}
            disabled={!collapseTargetId}
            onClick={collapseSelectedLayer}
          >
            <LayerOptionsGlyph className="size-4" />
          </button>
        </div>
      </div>

      {shouldShowSearch ? (
        <div className="shrink-0 p-2">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !searchQuery.trim()) {
                  setSearchOpen(false);
                }
              }}
              placeholder={labels.searchPlaceholder}
              className="h-7 rounded-[4px] border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] pl-7 text-[12px] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
            />
          </div>
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain py-2"
        onDragOver={handleRowsDragOver}
        onDrop={stopAutoScroll}
        onDragEnd={stopAutoScroll}
      >
        {visibleRows.length ? (
          <div
            className="w-max min-w-full px-2"
            role="tree"
            aria-label={labels.title}
          >
            {visibleRows.map((row) => {
              // Per-row primitives computed here (not inside LayerRow) so the
              // row only receives booleans/strings it needs — no whole-tree
              // arrays that would force a re-render every time any other
              // row's selection state changes.
              const isSelected = selectedIdSet.has(row.node.id);
              const isInSelectedSubtree = row.ancestorIds.some((id) =>
                selectedIdSet.has(id),
              );
              const isHovered =
                hoveredLayerId != null && row.node.id === hoveredLayerId;
              const isActiveScreen =
                row.node.id === activeScreenId &&
                (row.node.type === "file" ||
                  row.node.type === "screen" ||
                  row.node.type === "frame");
              const isRenaming = renamingId === row.node.id;
              const activeDropPlacement =
                dropIndicator?.targetId === row.node.id
                  ? dropIndicator.placement
                  : null;
              return (
                <LayerRow
                  key={row.rowKey}
                  row={row}
                  labels={labels}
                  isExpanded={expandedIdSet.has(row.node.id)}
                  isSelected={isSelected}
                  isInSelectedSubtree={isInSelectedSubtree}
                  isActiveScreen={isActiveScreen}
                  isHovered={isHovered}
                  isRenaming={isRenaming}
                  renameDraft={isRenaming ? renameDraft : ""}
                  registerRowElement={registerRowElement}
                  onRenameDraftChange={setRenameDraft}
                  onCommitRename={commitRename}
                  onCancelRename={handleCancelRename}
                  onStartRename={startRename}
                  onRename={onRename}
                  onSelect={selectNode}
                  onToggleExpanded={handleToggleExpanded}
                  onToggleLocked={onToggleLocked}
                  onToggleHidden={onToggleHidden}
                  onHoverLayer={onHoverLayer}
                  onLeaveLayer={onLeaveLayer}
                  onMoveLayer={onMoveLayer}
                  canMoveLayer={canMoveLayer}
                  activeDropPlacement={activeDropPlacement}
                  onDropIndicatorChange={setDropIndicator}
                  selectedIdsRef={selectedIdsRef}
                  visibleRowsRef={visibleRowsRef}
                  rootsRef={rootsRef}
                  onCopyLayer={onCopyLayer}
                  onPasteToReplace={onPasteToReplace}
                  onGroupSelection={onGroupSelection}
                  onFrameSelection={onFrameSelection}
                  onUngroupSelection={onUngroupSelection}
                  onReorderLayer={onReorderLayer}
                  onFlipHorizontal={onFlipHorizontal}
                  onFlipVertical={onFlipVertical}
                />
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-8 text-center !text-[11px] text-muted-foreground">
            {hasAnyRows ? labels.noMatches : labels.empty}
          </div>
        )}
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </aside>
  );
}

// L12: forwardRef wraps the implementation function, and memo wraps the
// forwardRef result — memo(forwardRef(Impl)), the standard composition order.
// displayName is set explicitly because forwardRef's returned object doesn't
// inherit the inner function's name the way a plain function component would
// (React devtools/debugging would otherwise show "ForwardRef").
const LayersPanelWithRef = forwardRef(LayersPanelImpl);
LayersPanelWithRef.displayName = "LayersPanel";
export const LayersPanel = memo(LayersPanelWithRef);

interface LayerRowProps {
  row: FlatLayerRow;
  labels: LayersPanelLabels;
  isExpanded: boolean;
  isSelected: boolean;
  isInSelectedSubtree: boolean;
  isActiveScreen: boolean;
  // Display-only hover highlight (e.g. mirroring canvas hover), distinct from
  // selection. Never drives scroll-into-view or focus — see hoveredLayerId on
  // LayersPanelProps.
  isHovered: boolean;
  isRenaming: boolean;
  registerRowElement: (rowKey: string, element: HTMLDivElement | null) => void;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: (id: string) => void;
  onStartRename: (node: LayersPanelNode) => void;
  onRename?: (id: string, name: string) => void;
  onSelect: (
    id: string,
    options: {
      additive: boolean;
      currentSelectedIds?: string[];
      range: boolean;
      source: "keyboard" | "pointer";
    },
  ) => void;
  // node is optional; passed on alt-click so the caller can batch-expand the
  // whole subtree in one state change instead of a single-id toggle.
  onToggleExpanded: (
    id: string,
    expanded: boolean,
    node?: LayersPanelNode,
  ) => void;
  onToggleLocked?: (id: string, locked: boolean) => void;
  onToggleHidden?: (id: string, hidden: boolean) => void;
  onHoverLayer?: (id: string) => void;
  onLeaveLayer?: (id: string) => void;
  onMoveLayer?: (intent: LayersPanelMoveIntent) => void;
  canMoveLayer?: (intent: LayersPanelMoveIntent) => boolean;
  // Only this row's own drop-indicator placement ("before" | "after" |
  // "inside" | null) — not the whole dropIndicator object, so a dragover on
  // one row doesn't force every other row to re-render.
  activeDropPlacement: LayersPanelMoveIntent["placement"] | null;
  onDropIndicatorChange: (intent: LayersPanelMoveIntent | null) => void;
  // Whole-tree state needed for keyboard nav / multi-drag ordering, threaded
  // through stable refs instead of arrays so it never defeats memo — see the
  // comment where these refs are created in LayersPanel.
  selectedIdsRef: RefObject<readonly string[]>;
  visibleRowsRef: RefObject<FlatLayerRow[]>;
  // Full (unfiltered) root nodes, used only at drag start to build a
  // full-tree ancestor map — see buildAncestorIdMap and L13 in the drag-start
  // handler below.
  rootsRef: RefObject<LayersPanelNode[]>;
  // Figma-parity context-menu actions. Each is optional; the corresponding
  // menu item only renders when its callback is provided (see showContextMenu
  // / the ContextMenuContent below). Note: onPasteHere/onDuplicateLayer/
  // onDeleteLayer are NOT threaded down to the row — real Figma's layer-row
  // menu has no Paste here/Duplicate/Delete items (see LayersPanelProps for
  // the full back-compat callback surface).
  onCopyLayer?: (ids: string[]) => void;
  onPasteToReplace?: (ids: string[]) => void;
  onGroupSelection?: (ids: string[]) => void;
  onFrameSelection?: (ids: string[]) => void;
  onUngroupSelection?: (ids: string[]) => void;
  onReorderLayer?: (
    ids: string[],
    direction: "front" | "forward" | "backward" | "back",
  ) => void;
  onFlipHorizontal?: (ids: string[]) => void;
  onFlipVertical?: (ids: string[]) => void;
}

const LayerRow = memo(function LayerRow({
  row,
  labels,
  isExpanded,
  isSelected,
  isInSelectedSubtree,
  isActiveScreen,
  isHovered,
  isRenaming,
  registerRowElement,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onRename,
  onSelect,
  onToggleExpanded,
  onToggleLocked,
  onToggleHidden,
  onHoverLayer,
  onLeaveLayer,
  onMoveLayer,
  canMoveLayer,
  activeDropPlacement,
  onDropIndicatorChange,
  selectedIdsRef,
  visibleRowsRef,
  rootsRef,
  onCopyLayer,
  onPasteToReplace,
  onGroupSelection,
  onFrameSelection,
  onUngroupSelection,
  onReorderLayer,
  onFlipHorizontal,
  onFlipVertical,
}: LayerRowProps) {
  const { node, depth, hasChildren, canAcceptChildren } = row;
  const isComponentLayer = layerNodeIsComponent(node);
  const selectable = node.selectable !== false;
  const lockable = node.lockable !== false && Boolean(onToggleLocked);
  const hideable = node.hideable !== false && Boolean(onToggleHidden);
  // L8: being a valid DRAG SOURCE and being a valid DROP ANCHOR (before/
  // after/inside target) are different concerns and must not share one gate.
  // - dragSourceEligible: only "locked" should block picking this row up to
  //   drag it — locked means "don't let me move", not "don't let me be
  //   referenced". Hidden no longer blocks dragging a row: visibility is
  //   orthogonal to whether the layer can be reordered.
  // - anchorEligible: locked/hidden rows must still be usable as before/
  //   after/inside drop targets so the user can position new layers next to
  //   or inside a locked/hidden one without having to unlock/show it first.
  //   (The corresponding DE:15181 canMoveLayer gate is fixed separately by
  //   the DesignEditor owner; this only removes LP's OWN early-return that
  //   would otherwise block reaching canMoveLayer at all.)
  const dragSourceEligible = selectable && !node.locked;
  const anchorEligible = selectable;
  const draggable = dragSourceEligible && Boolean(onMoveLayer);
  const canDropInside = layerCanDropInside(
    node,
    hasChildren,
    canAcceptChildren,
  );
  // L10: whether this row's bottom hover zone should resolve to "inside"
  // instead of "after" — see dropPlacementForEvent.
  const isExpandedWithChildren = hasChildren && isExpanded;
  const activeDrop = activeDropPlacement;
  // Tracks whether the user pressed Escape to cancel rename so that the
  // subsequent blur event does not commit the edit.
  const renameCancelledRef = useRef(false);
  // L20: spring-loaded expand. Tracks the pending timer id for "hovering
  // this collapsed container during a drag" so a sustained hover expands it
  // (Figma-style) without requiring the user to drop and re-drag. Cleared on
  // drag-leave/drop/dragend and whenever the hover target/placement changes.
  const springLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SPRING_LOAD_DELAY_MS = 600;
  const clearSpringLoadTimer = () => {
    if (springLoadTimerRef.current !== null) {
      clearTimeout(springLoadTimerRef.current);
      springLoadTimerRef.current = null;
    }
  };
  useEffect(() => clearSpringLoadTimer, []);

  const readSelectedIdsFromTree = (target: HTMLElement): string[] => {
    const tree = target.closest('[role="tree"]');
    if (!tree)
      return selectedIdsRef.current.filter((id) => !id.startsWith("__"));
    return Array.from(
      tree.querySelectorAll<HTMLElement>(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
      ),
    )
      .map((button) => button.dataset.layerNodeId)
      .filter((id): id is string => Boolean(id && !id.startsWith("__")));
  };

  const handlePointerSelect = (event: MouseEvent<HTMLButtonElement>) => {
    if (!selectable) return;
    if (event.detail === 0) return;
    const nativeEvent = event.nativeEvent;
    const additive =
      event.metaKey ||
      event.ctrlKey ||
      nativeEvent.metaKey ||
      nativeEvent.ctrlKey;
    onSelect(node.id, {
      additive,
      currentSelectedIds: readSelectedIdsFromTree(event.currentTarget),
      range: event.shiftKey,
      source: "pointer",
    });
  };

  // GROUND TRUTH (live-verified against real Figma): after clicking a layer
  // row, ArrowUp/ArrowDown/Home/End do NOT navigate the layers list and must
  // NOT be intercepted here at all — no preventDefault, no focus move, no
  // selection change. Figma's list focus does not consume those keys; they
  // fall through to the app's global hotkey nudge handler, which moves the
  // SELECTED OBJECT on canvas by 1px (arrow) or listens for its own Home/End
  // handling. A previous revision made this row intercept those keys (first
  // to move DOM focus, later to change selection directly) — both were wrong
  // and are removed here. ArrowLeft/ArrowRight are the one exception Figma
  // keeps at the list level: they only toggle the focused row's own
  // expand/collapse (chevron) state, and must NOT change selection while
  // doing so.
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Space") {
      event.preventDefault();
      if (!selectable) return;
      onSelect(node.id, {
        additive: event.metaKey || event.ctrlKey,
        currentSelectedIds: readSelectedIdsFromTree(event.currentTarget),
        range: event.shiftKey,
        source: "keyboard",
      });
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      onStartRename(node);
      return;
    }
    if (event.key === "ArrowRight" && hasChildren && !isExpanded) {
      event.preventDefault();
      onToggleExpanded(node.id, true);
      return;
    }
    if (event.key === "ArrowLeft" && hasChildren && isExpanded) {
      event.preventDefault();
      onToggleExpanded(node.id, false);
      return;
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!draggable) {
      event.preventDefault();
      return;
    }
    // Build the full-tree ancestor map once, here at drag start, rather than
    // on every render — this is O(tree size) so it must not run per-row per
    // render. It uses the FULL root tree (not visibleRows) so a selected
    // descendant nested inside a currently-collapsed dragged ancestor is
    // still correctly recognized as a descendant and excluded from the drag
    // payload (see L13 / buildAncestorIdMap).
    const ancestorIdMap = buildAncestorIdMap(rootsRef.current);
    const draggedIds = getDraggedLayerIdsForRows({
      selectedIds: selectedIdsRef.current,
      nodeId: node.id,
      visibleRows: visibleRowsRef.current,
      ancestorIdMap,
    });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-design-layer-id", node.id);
    event.dataTransfer.setData(
      "application/x-design-layer-ids",
      JSON.stringify(draggedIds),
    );
    // Store drag state at module level so handleDragOver can read it.
    // dataTransfer.getData() returns "" during dragover per the HTML spec.
    activeDragState = { sourceId: node.id, draggedIds };
  };

  // A dragover that is rejected (any early-return path below) must clear a
  // stale indicator that a PRIOR dragover on this same row left behind — e.g.
  // hovering near the row edge changes the placement from "inside" to
  // "before", which canMoveLayer may now reject even though the previous
  // placement was accepted. Without this, the indicator line/ring lingers on
  // a row that no longer has a valid drop target.
  const clearStaleIndicatorForThisRow = () => {
    if (activeDropIntent?.targetId === node.id) activeDropIntent = null;
    if (activeDropPlacement !== null) onDropIndicatorChange(null);
    clearSpringLoadTimer();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onMoveLayer || !anchorEligible) {
      clearStaleIndicatorForThisRow();
      return;
    }
    // dataTransfer.getData() always returns "" during dragover per spec.
    // Read from the module-level activeDragState set in handleDragStart instead.
    if (!activeDragState) {
      clearStaleIndicatorForThisRow();
      return;
    }
    const { sourceId, draggedIds } = activeDragState;
    if (sourceId === node.id) {
      clearStaleIndicatorForThisRow();
      return;
    }
    const cleanedIds = draggedIds.filter(
      (id) => id && id !== node.id && !id.startsWith("__"),
    );
    if (cleanedIds.length === 0) {
      clearStaleIndicatorForThisRow();
      return;
    }
    const panelIntent = {
      draggedIds: cleanedIds,
      targetId: node.id,
      placement: dropPlacementForEvent(
        event,
        canDropInside,
        isExpandedWithChildren,
      ),
    } satisfies LayersPanelMoveIntent;
    const moveIntent = mapPanelMoveIntentToDomIntent(panelIntent);
    if (canMoveLayer && !canMoveLayer(moveIntent)) {
      clearStaleIndicatorForThisRow();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    activeDropIntent = panelIntent;
    onDropIndicatorChange(panelIntent);

    // L20 spring-loaded expand: sustained "inside" hover over a collapsed
    // container expands it after a delay so the user can drop into nested
    // children without a separate drop-then-redrag step. Only arm the timer
    // once per qualifying hover — if a timer is already pending for this row
    // we leave it running rather than resetting it on every dragover tick.
    if (
      panelIntent.placement === "inside" &&
      hasChildren &&
      !isExpanded &&
      springLoadTimerRef.current === null
    ) {
      springLoadTimerRef.current = setTimeout(() => {
        springLoadTimerRef.current = null;
        onToggleExpanded(node.id, true);
      }, SPRING_LOAD_DELAY_MS);
    } else if (
      panelIntent.placement !== "inside" ||
      !hasChildren ||
      isExpanded
    ) {
      clearSpringLoadTimer();
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onMoveLayer || !anchorEligible) {
      onDropIndicatorChange(null);
      return;
    }
    event.preventDefault();
    // getData() is safe in the drop handler (unlike dragover).
    const rawIds = event.dataTransfer.getData("application/x-design-layer-ids");
    let draggedIds = [
      event.dataTransfer.getData("application/x-design-layer-id"),
    ];
    try {
      const parsed = JSON.parse(rawIds);
      if (Array.isArray(parsed)) {
        draggedIds = parsed.filter(
          (id): id is string => typeof id === "string",
        );
      }
    } catch {
      // Ignore malformed drag payloads and fall back to the primary id.
    }
    const cleanedIds = draggedIds.filter(
      (id) => id && id !== node.id && !id.startsWith("__"),
    );
    if (cleanedIds.length > 0) {
      const storedIntent =
        activeDropIntent?.targetId === node.id
          ? {
              ...activeDropIntent,
              draggedIds: activeDropIntent.draggedIds.filter((id) =>
                cleanedIds.includes(id),
              ),
            }
          : null;
      const panelIntent =
        storedIntent && storedIntent.draggedIds.length > 0
          ? storedIntent
          : ({
              draggedIds: cleanedIds,
              targetId: node.id,
              placement: dropPlacementForEvent(
                event,
                canDropInside,
                isExpandedWithChildren,
              ),
            } satisfies LayersPanelMoveIntent);
      const moveIntent = mapPanelMoveIntentToDomIntent(panelIntent);
      if (!canMoveLayer || canMoveLayer(moveIntent)) {
        onMoveLayer(moveIntent);
      }
    }
    activeDropIntent = null;
    onDropIndicatorChange(null);
    clearSpringLoadTimer();
  };

  // Right-clicking a row that's already part of the current selection acts on
  // the whole selection (matching Figma); right-clicking an unselected row
  // acts on just that row. Computed lazily at action time (not memoized on
  // render) so it always reflects the live selectedIdsRef/visibleRowsRef —
  // both are refs updated outside the render cycle (see their declarations in
  // LayersPanel), so a render-time useMemo could see stale values by the time
  // the user actually picks a menu item.
  const getContextMenuTargetIdsForRow = () =>
    getContextMenuTargetIds({
      selectedIds: selectedIdsRef.current,
      nodeId: node.id,
      visibleRows: visibleRowsRef.current,
    });

  // Real Figma only offers Ungroup on a container row (something you could
  // actually ungroup), never on a plain leaf row — gate it on
  // canAcceptChildren in addition to the callback being provided. Duplicate/
  // Delete/Paste-here are intentionally excluded here: real Figma's layer
  // row menu doesn't have them (they're keyboard-only there), so they must
  // not factor into whether the menu/trigger renders at all.
  const canUngroupThisRow = Boolean(onUngroupSelection && canAcceptChildren);
  const hasEditActions = Boolean(
    onCopyLayer ||
    onPasteToReplace ||
    onGroupSelection ||
    onFrameSelection ||
    canUngroupThisRow ||
    onReorderLayer ||
    onFlipHorizontal ||
    onFlipVertical,
  );

  const showContextMenu =
    selectable &&
    (Boolean(onRename && node.renamable !== false) ||
      lockable ||
      hideable ||
      hasEditActions);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!showContextMenu}>
        <div
          ref={(element) => registerRowElement(row.rowKey, element)}
          role="treeitem"
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-level={depth + 1}
          aria-selected={selectable ? isSelected : undefined}
          className="relative min-w-full"
          draggable={draggable}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={(event) => {
            // Only clear the indicator when the pointer truly leaves this row.
            // Moving into a child element fires dragleave on the outer div too, so
            // we suppress the clear when relatedTarget is still within this row.
            if (
              event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              return;
            if (activeDropIntent?.targetId === node.id) activeDropIntent = null;
            onDropIndicatorChange(null);
            clearSpringLoadTimer();
          }}
          onDrop={handleDrop}
          onDragEnd={() => {
            activeDragState = null;
            activeDropIntent = null;
            onDropIndicatorChange(null);
            clearSpringLoadTimer();
          }}
          onMouseEnter={() => onHoverLayer?.(node.id)}
          onMouseLeave={() => onLeaveLayer?.(node.id)}
        >
          {activeDrop === "before" ? (
            <span
              className="pointer-events-none absolute right-2 top-0 z-10 h-px bg-[var(--design-editor-accent-color)]"
              style={{ left: rowIndent(depth) }}
            />
          ) : null}
          {activeDrop === "after" ? (
            <span
              className="pointer-events-none absolute bottom-0 right-2 z-10 h-px bg-[var(--design-editor-accent-color)]"
              style={{ left: rowIndent(depth) }}
            />
          ) : null}
          <div
            className={cn(
              "group flex h-8 min-w-full items-center gap-1 rounded-[5px] pr-1 text-[12px]",
              activeDrop === "inside" &&
                "ring-1 ring-inset ring-[var(--design-editor-accent-color)]",
              isSelected &&
                (isComponentLayer
                  ? "bg-[var(--design-editor-component-selection-color)] text-foreground"
                  : "bg-[var(--design-editor-selection-color)] text-foreground"),
              !isSelected &&
                isInSelectedSubtree &&
                (isComponentLayer
                  ? "bg-[var(--design-editor-component-selected-subtree-color)] text-foreground/95"
                  : "bg-[var(--design-editor-selected-subtree-color)] text-foreground/95"),
              !isSelected &&
                isActiveScreen &&
                "bg-[var(--design-editor-active-row-color)] text-foreground hover:bg-[var(--design-editor-active-row-color)]",
              !isSelected &&
                !isInSelectedSubtree &&
                !isActiveScreen &&
                "text-foreground/90 hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground",
              // Canvas-hover highlight (hoveredLayerId): a subtle background,
              // visually distinct from selection/subtree/active-screen state.
              // Only applied when none of those stronger states already own
              // the row's background, and never triggers scroll-into-view.
              isHovered &&
                !isSelected &&
                !isInSelectedSubtree &&
                !isActiveScreen &&
                "bg-[var(--design-editor-layer-hover-color)] text-foreground",
              node.hidden && "text-muted-foreground",
            )}
            style={{ paddingLeft: rowIndent(depth) }}
          >
            {hasChildren ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-4 shrink-0 rounded-sm p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                aria-label={isExpanded ? labels.collapse : labels.expand}
                onClick={(event) => {
                  event.stopPropagation();
                  // Alt-click (Figma behavior): expand/collapse this node AND
                  // all of its descendants in one batched update.
                  onToggleExpanded(
                    node.id,
                    !isExpanded,
                    event.altKey ? node : undefined,
                  );
                }}
              >
                {isExpanded ? (
                  <IconChevronDown className="size-4" />
                ) : (
                  <IconChevronRight className="size-4 rtl:-scale-x-100" />
                )}
              </Button>
            ) : (
              <span className="size-4 shrink-0" />
            )}

            <button
              type="button"
              disabled={!selectable}
              data-layer-row-button
              data-layer-node-id={node.id}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-0.5 py-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                selectable ? "cursor-default" : "cursor-default opacity-80",
              )}
              onClick={handlePointerSelect}
              onDoubleClick={() => onStartRename(node)}
              onKeyDown={handleKeyDown}
            >
              <span
                className={cn(
                  "shrink-0 text-muted-foreground",
                  isComponentLayer
                    ? "text-[var(--design-editor-component-color)]"
                    : (isSelected || isInSelectedSubtree) && "text-foreground",
                )}
              >
                {node.icon ?? <LayerGlyph node={node} />}
              </span>
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => {
                    // Escape sets renameCancelledRef before blur fires; skip commit.
                    if (renameCancelledRef.current) {
                      renameCancelledRef.current = false;
                      return;
                    }
                    onCommitRename(node.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      // Stop propagation so the keydown does not bubble up to the
                      // parent row <button>'s handleKeyDown, which would fire
                      // onSelect and potentially trigger canvas-level side effects
                      // (e.g. switching to overview mode or selecting a wrong layer).
                      event.stopPropagation();
                      onCommitRename(node.id);
                    } else if (event.key === "Tab") {
                      // Commit the rename on Tab (Figma behavior) and prevent the
                      // keydown from reaching the global design hotkeys handler which
                      // would cycle the active file when Tab fires outside an input.
                      event.preventDefault();
                      event.stopPropagation();
                      onCommitRename(node.id);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      renameCancelledRef.current = true;
                      onCancelRename(node.id);
                    }
                  }}
                  className="h-6 min-w-0 flex-1 rounded-[4px] border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-panel-bg)] px-1.5 text-[12px] text-foreground outline-none"
                  aria-label={labels.rename}
                />
              ) : (
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium leading-none",
                    isComponentLayer &&
                      "text-[var(--design-editor-component-color)]",
                  )}
                  title={node.name}
                >
                  {node.name}
                </span>
              )}
              {!isRenaming &&
              layerCanShowBadge(node) &&
              node.badge !== null &&
              node.badge !== undefined ? (
                <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
                  {node.badge}
                </span>
              ) : null}
            </button>

            {lockable ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "size-5 shrink-0 rounded-sm p-0 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
                      node.locked && "opacity-100",
                      isSelected && "text-foreground",
                    )}
                    aria-label={node.locked ? labels.unlock : labels.lock}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleLocked?.(node.id, !node.locked);
                    }}
                  >
                    {node.locked ? (
                      <IconLock className="size-3" />
                    ) : (
                      <IconLockOpen className="size-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {node.locked ? labels.unlock : labels.lock}
                </TooltipContent>
              </Tooltip>
            ) : null}

            {hideable ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "size-5 shrink-0 rounded-sm p-0 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
                      node.hidden && "opacity-100",
                      isSelected && "text-foreground",
                    )}
                    aria-label={node.hidden ? labels.show : labels.hide}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleHidden?.(node.id, !node.hidden);
                    }}
                  >
                    {node.hidden ? (
                      <IconEyeOff className="size-3" />
                    ) : (
                      <IconEye className="size-3" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {node.hidden ? labels.show : labels.hide}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </ContextMenuTrigger>
      {showContextMenu ? (
        <ContextMenuContent className="z-[300] min-w-[200px] text-[12px]">
          {/* LIVE-VERIFIED Figma layer-row menu order: Copy, Paste to
              replace — Bring to front, Send to back — Group selection,
              (Ungroup, container rows only), Frame selection, Rename —
              Show/Hide, Lock/Unlock — Flip horizontal, Flip vertical. Real
              Figma has no Duplicate/Delete/Paste-here on this menu (those
              are keyboard-only there — see ⌘D/Delete). Each item only
              renders when its callback prop is provided, so the menu
              degrades gracefully before every callback is wired up from the
              caller. */}
          {onCopyLayer ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onCopyLayer(getContextMenuTargetIdsForRow())}
            >
              <IconCopy className="size-3.5 text-muted-foreground" />
              {labels.copy}
              <ContextMenuShortcut>⌘C</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          {onPasteToReplace ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onPasteToReplace(getContextMenuTargetIdsForRow())}
            >
              <IconClipboard className="size-3.5 text-muted-foreground" />
              {labels.pasteToReplace}
              <ContextMenuShortcut>
                {"⇧⌘R" /* i18n-ignore keyboard shortcut glyph */}
              </ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}

          {(onCopyLayer || onPasteToReplace) && onReorderLayer ? (
            <ContextMenuSeparator />
          ) : null}

          {onReorderLayer ? (
            <>
              <ContextMenuItem
                className="gap-2 text-[12px]"
                onSelect={() =>
                  onReorderLayer(getContextMenuTargetIdsForRow(), "front")
                }
              >
                <IconStackFront className="size-3.5 text-muted-foreground" />
                {labels.bringToFront}
                <ContextMenuShortcut>]</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 text-[12px]"
                onSelect={() =>
                  onReorderLayer(getContextMenuTargetIdsForRow(), "back")
                }
              >
                <IconStackBack className="size-3.5 text-muted-foreground" />
                {labels.sendToBack}
                <ContextMenuShortcut>[</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          ) : null}

          {onReorderLayer &&
          (onGroupSelection ||
            canUngroupThisRow ||
            onFrameSelection ||
            onRename) ? (
            <ContextMenuSeparator />
          ) : null}

          {onGroupSelection ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onGroupSelection(getContextMenuTargetIdsForRow())}
            >
              <IconLayersUnion className="size-3.5 text-muted-foreground" />
              {labels.group}
              <ContextMenuShortcut>⌘G</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          {onFrameSelection ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onFrameSelection(getContextMenuTargetIdsForRow())}
            >
              <IconFrame className="size-3.5 text-muted-foreground" />
              {labels.frameSelection}
              <ContextMenuShortcut>
                {"⌥⌘G" /* i18n-ignore keyboard shortcut glyph */}
              </ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          {onRename && node.renamable !== false ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onStartRename(node)}
            >
              <IconPencil className="size-3.5 text-muted-foreground" />
              {labels.rename}
              <ContextMenuShortcut>⌘R</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}

          {/* Real Figma only shows Ungroup on a container row — a plain row
              never gets it, even when the callback is wired up. */}
          {canUngroupThisRow ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() =>
                onUngroupSelection?.(getContextMenuTargetIdsForRow())
              }
            >
              <IconLayersSubtract className="size-3.5 text-muted-foreground" />
              {labels.ungroup}
              <ContextMenuShortcut>
                {"⇧⌘G" /* i18n-ignore keyboard shortcut glyph */}
              </ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}

          {(onGroupSelection ||
            canUngroupThisRow ||
            onFrameSelection ||
            (onRename && node.renamable !== false)) &&
          (lockable || hideable) ? (
            <ContextMenuSeparator />
          ) : null}
          {hideable ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onToggleHidden?.(node.id, !node.hidden)}
            >
              {node.hidden ? (
                <IconEye className="size-3.5 text-muted-foreground" />
              ) : (
                <IconEyeOff className="size-3.5 text-muted-foreground" />
              )}
              {node.hidden ? labels.show : labels.hide}
              <ContextMenuShortcut>
                {"⇧⌘H" /* i18n-ignore keyboard shortcut glyph */}
              </ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          {lockable ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onToggleLocked?.(node.id, !node.locked)}
            >
              {node.locked ? (
                <IconLockOpen className="size-3.5 text-muted-foreground" />
              ) : (
                <IconLock className="size-3.5 text-muted-foreground" />
              )}
              {node.locked ? labels.unlock : labels.lock}
              <ContextMenuShortcut>
                {"⇧⌘L" /* i18n-ignore keyboard shortcut glyph */}
              </ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}

          {(lockable || hideable) && (onFlipHorizontal || onFlipVertical) ? (
            <ContextMenuSeparator />
          ) : null}

          {onFlipHorizontal ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onFlipHorizontal(getContextMenuTargetIdsForRow())}
            >
              <IconFlipHorizontal className="size-3.5 text-muted-foreground" />
              {labels.flipHorizontal}
              <ContextMenuShortcut>⇧H</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          {onFlipVertical ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onFlipVertical(getContextMenuTargetIdsForRow())}
            >
              <IconFlipVertical className="size-3.5 text-muted-foreground" />
              {labels.flipVertical}
              <ContextMenuShortcut>⇧V</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
});

function IconTooltipButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 rounded-sm p-0 text-muted-foreground hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function LayerGlyph({
  node,
}: {
  node: Pick<LayersPanelNode, "type" | "layout" | "tagName" | "detail">;
}) {
  const common = "size-4";
  const componentColor = "text-[var(--design-editor-component-color)]";
  if (layerNodeUsesImageGlyph(node)) {
    return <ImageLayerGlyph className={common} />;
  }
  switch (node.type) {
    case "file":
    case "screen":
      return <PageLayerGlyph className={common} />;
    case "frame":
      return <LayoutLayerGlyph node={node} className={common} />;
    case "group":
    case "section":
      return <LayoutLayerGlyph node={node} className={common} />;
    case "component":
    case "instance":
      return <ComponentLayerGlyph className={cn(common, componentColor)} />;
    case "ellipse":
      return <EllipseLayerGlyph className={common} />;
    case "board-element":
    case "shape":
    case "rectangle":
      return <RectangleLayerGlyph className={common} />;
    case "vector":
      return <VectorLayerGlyph className={common} />;
    case "line":
      return <LineLayerGlyph className={common} />;
    case "arrow":
      return <ArrowLayerGlyph className={common} />;
    case "polygon":
      return <PolygonLayerGlyph className={common} />;
    case "star":
      return <StarLayerGlyph className={common} />;
    case "text":
      return <TextLayerGlyph className={common} />;
    case "image":
      return <ImageLayerGlyph className={common} />;
    case "code":
    case "element":
      return node.layout?.isFlexContainer || node.layout?.isGridContainer ? (
        <LayoutLayerGlyph node={node} className={common} />
      ) : (
        <ElementLayerGlyph className={common} />
      );
    default:
      return <FrameLayerGlyph className={common} />;
  }
}

function layerNodeTagName(
  node: Pick<LayersPanelNode, "tagName" | "detail">,
): string | null {
  const explicit = node.tagName?.trim().toLowerCase();
  if (explicit) return explicit;
  const detailTag = /^<\s*([a-zA-Z][\w:-]*)/.exec(node.detail?.trim() ?? "");
  return detailTag?.[1]?.toLowerCase() ?? null;
}

function layerNodeUsesImageGlyph(
  node: Pick<LayersPanelNode, "type" | "tagName" | "detail">,
): boolean {
  const tag = layerNodeTagName(node);
  return node.type === "image" || tag === "img" || tag === "picture";
}

function layerNodeIsComponent(node: Pick<LayersPanelNode, "type">): boolean {
  return node.type === "component" || node.type === "instance";
}

function LayerOptionsGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 4h6" />
      <path d="M3 8h8" />
      <path d="M3 12h5" />
      <path d="M12.5 4.5l1 1 1-1" />
      <path d="M12.5 11.5l1-1 1 1" />
    </svg>
  );
}

function PageLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.5 2.5h5.1l2 2V13a.8.8 0 0 1-.8.8H4.5a.8.8 0 0 1-.8-.8V3.3a.8.8 0 0 1 .8-.8Z" />
      <path d="M9.6 2.6v2.1h2.1" />
    </svg>
  );
}

function FrameLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3.5 4.5h9" />
      <path d="M3.5 11.5h9" />
      <path d="M5.5 6.5h5" />
      <path d="M5.5 9.5h5" />
    </svg>
  );
}

function LayoutLayerGlyph({
  node,
  className,
}: {
  node: Pick<LayersPanelNode, "layout">;
  className?: string;
}) {
  if (node.layout?.isGridContainer) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        className={className}
        aria-hidden="true"
      >
        <rect x="3" y="3" width="3.2" height="3.2" rx=".5" />
        <rect x="9.8" y="3" width="3.2" height="3.2" rx=".5" />
        <rect x="3" y="9.8" width="3.2" height="3.2" rx=".5" />
        <rect x="9.8" y="9.8" width="3.2" height="3.2" rx=".5" />
      </svg>
    );
  }
  if (node.layout?.isFlexContainer) {
    const isRow = node.layout.flexDirection?.startsWith("row");
    const align = node.layout.alignItems ?? "stretch";
    const justify = node.layout.justifyContent ?? "flex-start";
    return isRow ? (
      <HorizontalAutoLayoutGlyph
        align={align}
        justify={justify}
        className={className}
      />
    ) : (
      <VerticalAutoLayoutGlyph
        align={align}
        justify={justify}
        className={className}
      />
    );
  }
  return <FrameLayerGlyph className={className} />;
}

function normalizedAlignment(value: string | undefined) {
  if (!value) return "start";
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end") return "end";
  if (value === "space-between") return "space-between";
  if (value === "space-around" || value === "space-evenly")
    return "space-around";
  if (value === "stretch") return "stretch";
  return "start";
}

function crossAxisOffset(align: string | undefined, axis: "x" | "y") {
  const normalized = normalizedAlignment(align);
  if (normalized === "center") return axis === "x" ? 5 : 5.5;
  if (normalized === "end") return axis === "x" ? 7 : 8;
  return axis === "x" ? 3 : 3;
}

function mainAxisPositions(justify: string | undefined, axis: "x" | "y") {
  const normalized = normalizedAlignment(justify);
  if (axis === "x") {
    if (normalized === "center") return [3.6, 7.1, 10.6];
    if (normalized === "end") return [4.4, 7.8, 11.2];
    if (normalized === "space-between") return [2.6, 7.1, 11.6];
    if (normalized === "space-around") return [3.1, 7.1, 11.1];
    return [3, 6.6, 10.2];
  }
  if (normalized === "center") return [3.5, 7.1, 10.7];
  if (normalized === "end") return [4.2, 7.8, 11.4];
  if (normalized === "space-between") return [2.8, 7.1, 11.4];
  if (normalized === "space-around") return [3.2, 7.1, 11];
  return [3, 6.6, 10.2];
}

function VerticalAutoLayoutGlyph({
  align,
  justify,
  className,
}: {
  align?: string;
  justify?: string;
  className?: string;
}) {
  const x = crossAxisOffset(align, "x");
  const yPositions = mainAxisPositions(justify, "y");
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x={x} y={yPositions[0]} width="6" height="1.55" rx=".45" />
      <rect x={x} y={yPositions[1]} width="6" height="1.55" rx=".45" />
      <rect x={x} y={yPositions[2]} width="6" height="1.55" rx=".45" />
    </svg>
  );
}

function HorizontalAutoLayoutGlyph({
  align,
  justify,
  className,
}: {
  align?: string;
  justify?: string;
  className?: string;
}) {
  const y = crossAxisOffset(align, "y");
  const xPositions = mainAxisPositions(justify, "x");
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x={xPositions[0]} y={y} width="1.55" height="5" rx=".45" />
      <rect x={xPositions[1]} y={y} width="1.55" height="5" rx=".45" />
      <rect x={xPositions[2]} y={y} width="1.55" height="5" rx=".45" />
    </svg>
  );
}

function ComponentLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m8 2.6 5.4 5.4L8 13.4 2.6 8 8 2.6Z" />
    </svg>
  );
}

function EllipseLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      className={className}
      aria-hidden="true"
    >
      <ellipse cx="8" cy="8" rx="4.8" ry="4" />
    </svg>
  );
}

function RectangleLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      className={className}
      aria-hidden="true"
    >
      <rect x="3.2" y="4" width="9.6" height="8" rx="1" />
    </svg>
  );
}

function VectorLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 11.5C5.5 6.5 9 5 12 4.5" />
      <rect x="2.6" y="10.1" width="2.8" height="2.8" rx=".5" />
      <rect x="10.6" y="3.1" width="2.8" height="2.8" rx=".5" />
    </svg>
  );
}

function LineLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4.6 11.4 11.4 4.6" />
      <circle cx="3.6" cy="12.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.4" cy="3.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ArrowLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3.6 12.4 11.6 4.4" />
      <path d="M7.4 4.2h4.4v4.4" />
    </svg>
  );
}

function PolygonLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 2.8 13.2 12.2H2.8L8 2.8Z" />
    </svg>
  );
}

function StarLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 2.6 9.65 6.1l3.85.5-2.8 2.7.68 3.8L8 11.9l-3.38 1.9.68-3.8-2.8-2.7 3.85-.5L8 2.6Z" />
    </svg>
  );
}

function TextLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3.2 4h9.6" />
      <path d="M8 4v8.4" />
    </svg>
  );
}

function ImageLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="10" height="10" rx="1.2" />
      <circle cx="6" cy="6" r="1" />
      <path d="m4.2 12 3.2-3.3 1.8 1.8 1.3-1.4 1.3 1.4" />
    </svg>
  );
}

function ElementLayerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6.4 4.2-3.2 3.8 3.2 3.8" />
      <path d="m9.6 4.2 3.2 3.8-3.2 3.8" />
    </svg>
  );
}

function layerCanDropInside(
  node: LayersPanelNode,
  hasChildren: boolean,
  canAcceptChildren: boolean,
) {
  return (
    hasChildren ||
    canAcceptChildren ||
    Boolean(node.layout?.isFlexContainer || node.layout?.isGridContainer) ||
    node.type === "file" ||
    node.type === "screen" ||
    node.type === "frame" ||
    node.type === "group" ||
    node.type === "section"
  );
}

/**
 * L10: for an EXPANDED container that already has children, the bottom hover
 * zone sits (visually, in the panel) directly above that container's
 * first-listed child row — not above its next sibling. A plain "after"
 * placement there would target the position following the container's
 * ENTIRE subtree (anchor.end in applyMoveNodeEdit), which visually
 * contradicts the indicator's position between the container and its first
 * child. Resolve that zone to "inside" instead (still targeting the
 * container), which inserts at contentEnd — under the L5 reversed-order
 * convention that is exactly the container's first-panel-row / topmost-paint
 * child slot, matching what the indicator visually promises.
 */
export function dropPlacementForEvent(
  event: DragEvent<HTMLDivElement>,
  canDropInside: boolean,
  isExpandedWithChildren = false,
): LayersPanelMoveIntent["placement"] {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = event.clientY - rect.top;
  if (offset < rect.height * 0.3) return "before";
  if (offset > rect.height * 0.7) {
    if (canDropInside && isExpandedWithChildren) return "inside";
    return "after";
  }
  return canDropInside ? "inside" : "after";
}
