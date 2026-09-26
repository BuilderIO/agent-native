import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUpRight,
  IconArtboard,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconClipboard,
  IconCode,
  IconComponents,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFile,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFrame,
  IconLayoutColumns,
  IconLayersSubtract,
  IconLayersUnion,
  IconLayoutGrid,
  IconLayoutRows,
  IconLine,
  IconListTree,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconSquare,
  IconStackBack,
  IconStackFront,
  IconStar,
  IconTriangle,
  IconTypography,
  IconVectorBezier2,
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
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
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
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApplePlatform } from "@/hooks/use-shortcut-label";
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
  isComponent?: boolean;
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

interface LayersPanelMoveIntent {
  draggedIds: string[];
  targetId: string;
  placement: "before" | "after" | "inside";
  duplicate?: boolean;
}

export interface LayersPanelLabels {
  title: string;
  screens: string;
  resizeScreens: string;
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
  boardElements?: LayersPanelNode[];
  hoveredLayerId?: string | null;
  onCopyLayer?: (ids: string[]) => void;
  onPasteHere?: (targetId: string) => void;
  onPasteToReplace?: (ids: string[]) => void;
  onDuplicateLayer?: (ids: string[]) => void;
  onDeleteLayer?: (ids: string[]) => void;
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

export interface LayersPanelHandle {
  beginRename: (layerId: string) => boolean;
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

let activeDragState: { sourceId: string; draggedIds: string[] } | null = null;
let activeDropIntent: LayersPanelMoveIntent | null = null;

function canUseActiveDragStateForDrop(
  dragState: { sourceId: string; draggedIds: string[] } | null,
  dropIntent: LayersPanelMoveIntent | null,
  targetId: string,
): boolean {
  return Boolean(
    dragState &&
    dragState.sourceId !== targetId &&
    dragState.draggedIds.includes(dragState.sourceId) &&
    dropIntent?.targetId === targetId,
  );
}

export { canUseActiveDragStateForDrop };
export type { LayersPanelMoveIntent };

let activeIconToggleDrag: { kind: "hidden" | "locked"; value: boolean } | null =
  null;

function beginIconToggleDrag(kind: "hidden" | "locked", value: boolean): void {
  activeIconToggleDrag = { kind, value };
  const clear = () => {
    activeIconToggleDrag = null;
    window.removeEventListener("mouseup", clear);
    window.removeEventListener("blur", clear);
    window.removeEventListener("pointercancel", clear);
  };
  window.addEventListener("mouseup", clear, { once: true });
  window.addEventListener("blur", clear, { once: true });
  window.addEventListener("pointercancel", clear, { once: true });
}

export function layerRowIndentCount(depth: number): number {
  return Math.max(1, depth + 1);
}

export function layerSelectionBlockId(
  row: Pick<FlatLayerRow, "node" | "ancestorIds">, // i18n-ignore -- TypeScript generic, not visible copy.
  selectedIds: ReadonlySet<string>,
): string | null {
  if (selectedIds.has(row.node.id)) return row.node.id;
  return (
    [...row.ancestorIds].reverse().find((id) => selectedIds.has(id)) ?? null
  );
}

function defaultLabels(t: ReturnType<typeof useT>): LayersPanelLabels {
  return {
    title: t("layersPanel.title"),
    screens: t("layersPanel.screens"),
    resizeScreens: t("layersPanel.resizeScreens"),
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

export function mapPanelPlacementToDomPlacement(
  placement: LayersPanelMoveIntent["placement"],
): LayersPanelMoveIntent["placement"] {
  if (placement === "before") return "after";
  if (placement === "after") return "before";
  return "inside";
}

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

export function computeLayerMultiSelectIds(args: {
  id: string;
  additive: boolean;
  range: boolean;
  currentSelectedIds: readonly string[];
  anchor: string | null;
  selectableVisibleIds: readonly string[];
  visibleRows: readonly FlatLayerRow[];
  anchorFallbackSelectedIds?: readonly string[];
}): { nextIds: string[]; nextAnchor: string | null } {
  const {
    id,
    additive,
    range,
    currentSelectedIds,
    anchor,
    selectableVisibleIds,
    visibleRows,
    anchorFallbackSelectedIds = currentSelectedIds,
  } = args;
  const currentSelectedIdSet = new Set(currentSelectedIds);
  let nextIds: string[];
  let nextAnchor = range ? anchor : id;
  if (range && anchor) {
    let effectiveAnchor = anchor;
    if (selectableVisibleIds.indexOf(effectiveAnchor) < 0) {
      const fallback = [...anchorFallbackSelectedIds]
        .reverse()
        .find((sid) => selectableVisibleIds.includes(sid));
      if (fallback) {
        effectiveAnchor = fallback;
        nextAnchor = fallback;
      }
    }
    const from = selectableVisibleIds.indexOf(effectiveAnchor);
    const to = selectableVisibleIds.indexOf(id);
    if (from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from];
      const rangeIds = selectableVisibleIds.slice(start, end + 1);
      const merged = additive
        ? Array.from(new Set([...currentSelectedIds, ...rangeIds]))
        : rangeIds;
      nextIds = dropDescendantsOfSelectedAncestors(merged, visibleRows);
    } else {
      nextIds = [id];
    }
  } else if (additive) {
    nextIds = currentSelectedIdSet.has(id)
      ? currentSelectedIds.filter((selectedId) => selectedId !== id)
      : [...currentSelectedIds, id];
  } else {
    nextIds = [id];
  }
  return { nextIds, nextAnchor };
}

export function getDraggedLayerIdsForRows(args: {
  selectedIds: readonly string[];
  nodeId: string;
  visibleRows: readonly FlatLayerRow[];
  ancestorIdMap?: ReadonlyMap<string, string[]>;
  nodeById?: ReadonlyMap<string, LayersPanelNode>;
}): string[] {
  const rawDraggedIds = args.selectedIds.includes(args.nodeId)
    ? getTreeOrderedLayerIds(args.selectedIds, args.visibleRows)
    : [args.nodeId];
  const movableDraggedIds = rawDraggedIds.filter(
    (id) => args.nodeById?.get(id)?.locked !== true,
  );
  const draggedIdSet = new Set(movableDraggedIds);
  return movableDraggedIds.filter((id) => {
    const ancestorIds =
      args.ancestorIdMap?.get(id) ??
      args.visibleRows.find((row) => row.node.id === id)?.ancestorIds;
    return !ancestorIds?.some((ancestorId) => draggedIdSet.has(ancestorId));
  });
}

export function buildLayerNodeMap(
  nodes: readonly LayersPanelNode[],
): Map<string, LayersPanelNode> {
  const map = new Map<string, LayersPanelNode>();
  const visit = (node: LayersPanelNode) => {
    map.set(node.id, node);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return map;
}

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

function clampScreenSectionHeight(nextHeight: number, panelHeight: number) {
  const maxHeight = panelHeight > 0 ? panelHeight * 0.3 : nextHeight;
  const minHeight = Math.min(96, maxHeight);
  return Math.min(maxHeight, Math.max(minHeight, nextHeight));
}

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
  const visibleRowsRef = useRef<FlatLayerRow[]>([]);
  const rootsRef = useRef<LayersPanelNode[]>([]);
  const expandedIdsRef = useRef<readonly string[]>(expandedIds);
  expandedIdsRef.current = expandedIds;
  const lastPanelSelectionSignatureRef = useRef(selectedIds.join("\0"));
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const lastSelectionAnchorRef = useRef<string | null>(selectedIds[0] ?? null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const layersPanelRef = useRef<HTMLElement>(null);
  const screenSectionRef = useRef<HTMLDivElement>(null);
  const screenResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const [screenSectionHeight, setScreenSectionHeight] = useState<number | null>(
    null,
  );
  const rowElementRefs = useRef(new Map<string, HTMLDivElement>());
  const screenRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const [screenResizeMetrics, setScreenResizeMetrics] = useState({
    min: 0,
    max: 0,
    now: 0,
  });
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

  const selectionBlockIds = useMemo(
    () => visibleRows.map((row) => layerSelectionBlockId(row, selectedIdSet)),
    [selectedIdSet, visibleRows],
  );

  const selectableVisibleIds = useMemo(
    () =>
      visibleRows
        .map(({ node }) => node)
        .filter((node) => node.selectable !== false)
        .map((node) => node.id),
    [visibleRows],
  );

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
        inline: "nearest",
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
      const { nextIds, nextAnchor } = computeLayerMultiSelectIds({
        id,
        additive: options.additive,
        range: options.range,
        currentSelectedIds,
        anchor: lastSelectionAnchorRef.current,
        selectableVisibleIds,
        visibleRows: visibleRowsRef.current,
        anchorFallbackSelectedIds: selectedIds,
      });
      lastSelectionAnchorRef.current = nextAnchor;
      lastPanelSelectionSignatureRef.current = nextIds.join("\0");
      onSelectionChange(nextIds, { id, selectedIds: nextIds, ...options });
    },
    [onSelectionChange, selectableVisibleIds, selectedIds],
  );

  const commitRename = useCallback(
    (id: string) => {
      const nextName = renameDraft.trim();
      if (nextName) {
        onRename?.(id, nextName);
      }
      setRenamingId(null);
      setRenameDraft("");
      renameOriginalNameRef.current = "";
    },
    [onRename, renameDraft],
  );

  const pendingRenameFocusIdRef = useRef<string | null>(null);

  const startRename = useCallback(
    (node: LayersPanelNode) => {
      if (!onRename || node.renamable === false) return;
      renameOriginalNameRef.current = node.name;
      setRenamingId(node.id);
      setRenameDraft(node.name);
      pendingRenameFocusIdRef.current = node.id;
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

  useEffect(() => {
    const pendingId = pendingRenameFocusIdRef.current;
    if (!pendingId || renamingId !== pendingId) return;
    const rowKey = visibleRows.find((row) => row.node.id === pendingId)?.rowKey;
    if (!rowKey) return;
    const frame = window.requestAnimationFrame(() => {
      const rowElement = rowElementRefs.current.get(rowKey);
      rowElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
      rowElement
        ?.querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true });
    });
    pendingRenameFocusIdRef.current = null;
    return () => window.cancelAnimationFrame(frame);
  }, [renamingId, visibleRows]);

  const handleToggleExpanded = useCallback(
    (id: string, expanded: boolean, node?: LayersPanelNode) => {
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
  const collapsedIds = useMemo(
    () => expandedIds.filter((id) => selectedAncestorIds.includes(id)),
    [expandedIds, selectedAncestorIds],
  );

  const refreshScreenResizeMetrics = useCallback(() => {
    const panelHeight = layersPanelRef.current?.getBoundingClientRect().height;
    const sectionHeight =
      screenSectionRef.current?.getBoundingClientRect().height;
    if (!panelHeight || !sectionHeight) return;
    const max = panelHeight * 0.3;
    const min = Math.min(96, max);
    const next = {
      min: Math.round(min),
      max: Math.round(max),
      now: Math.round(Math.min(max, Math.max(min, sectionHeight))),
    };
    setScreenResizeMetrics((current) =>
      current.min === next.min &&
      current.max === next.max &&
      current.now === next.now
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    refreshScreenResizeMetrics();
    const panel = layersPanelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(refreshScreenResizeMetrics);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [refreshScreenResizeMetrics, screenRows.length, screenSectionHeight]);

  useEffect(() => {
    if (!activeScreenId || screenOverviewActive) return;
    const frame = window.requestAnimationFrame(() => {
      screenRowRefs.current.get(activeScreenId)?.scrollIntoView({
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeScreenId, screenOverviewActive, screenRows]);

  const collapseLayers = useCallback(() => {
    onExpandedIdsChange(collapsedIds);
  }, [collapsedIds, onExpandedIdsChange]);

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

  const updateScreenSectionHeight = useCallback((nextHeight: number) => {
    const panelHeight = layersPanelRef.current?.getBoundingClientRect().height;
    if (!panelHeight) return;
    setScreenSectionHeight(clampScreenSectionHeight(nextHeight, panelHeight));
  }, []);

  const handleScreenResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const section = screenSectionRef.current;
      if (!section) return;
      screenResizeRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: section.getBoundingClientRect().height,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [],
  );

  const handleScreenResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const resize = screenResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      updateScreenSectionHeight(
        resize.startHeight + event.clientY - resize.startY,
      );
    },
    [updateScreenSectionHeight],
  );

  const stopScreenResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (screenResizeRef.current?.pointerId !== event.pointerId) return;
      screenResizeRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const handleScreenResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const section = screenSectionRef.current;
      const panel = layersPanelRef.current;
      if (!section || !panel) return;
      const panelHeight = panel.getBoundingClientRect().height;
      const maxHeight = panelHeight * 0.3;
      const minHeight = Math.min(96, maxHeight);
      const currentHeight = section.getBoundingClientRect().height;
      const nextHeight =
        event.key === "Home"
          ? minHeight
          : event.key === "End"
            ? maxHeight
            : currentHeight + (event.key === "ArrowDown" ? 24 : -24);
      event.preventDefault();
      updateScreenSectionHeight(nextHeight);
    },
    [updateScreenSectionHeight],
  );

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={400}>
      <aside
        ref={layersPanelRef}
        data-layers-panel
        className={cn(
          "[--design-baseline-unit:4px] [--design-control-height:20px] [--design-icon-size:12px] [--design-row-height:24px] [--design-section-height:28px]",
          "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--design-editor-panel-bg)] text-[11px] font-normal text-foreground",
          className,
        )}
        aria-label={labels.title}
      >
        {screenRows.length > 0 ? (
          <div
            ref={screenSectionRef}
            data-screen-section
            className="flex min-h-0 shrink-0 flex-col overflow-hidden border-b border-[var(--design-editor-panel-divider-color)] pb-1"
            style={{
              maxHeight: "30%",
              ...(screenSectionHeight === null
                ? {}
                : { height: `${screenSectionHeight}px` }),
            }}
          >
            <div
              data-layers-panel-header="screens"
              className="flex h-[var(--design-section-height)] items-center justify-between px-2"
            >
              <h2 className="truncate text-[11px] font-semibold text-foreground">
                {labels.screens}
              </h2>
              <div className="flex items-center gap-0.5 text-muted-foreground">
                <IconTooltipButton
                  label={labels.addScreen}
                  dataAction="add-screen"
                  disabled={!onAddScreen}
                  onClick={onAddScreen}
                >
                  <IconPlus className="!size-[var(--design-icon-size)]" />
                </IconTooltipButton>
              </div>
            </div>
            <div className="px-1.5">
              <button
                type="button"
                className={cn(
                  "flex h-[var(--design-row-height)] w-full cursor-default items-center gap-[var(--design-baseline-unit)] rounded-[4px] px-[var(--design-baseline-unit)] text-left text-[11px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                  screenOverviewActive
                    ? "bg-[var(--design-editor-active-row-color)] text-foreground"
                    : "text-foreground/85 hover:bg-[var(--design-editor-active-row-color)] hover:text-foreground",
                )}
                aria-current={screenOverviewActive ? "page" : undefined}
                onClick={() => onScreenOverview?.()}
                title={labels.allScreens}
              >
                <IconLayoutGrid className="size-[var(--design-icon-size)] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {labels.allScreens}
                </span>
              </button>
            </div>
            <div className="mx-2 my-1 border-t border-[var(--design-editor-panel-divider-color)]" />
            <div className="min-h-0 flex-1 overflow-auto px-1.5">
              <div className="space-y-0">
                {screenRows.map((screen) => {
                  const isActive =
                    !screenOverviewActive && screen.id === activeScreenId;
                  return (
                    <button
                      key={screen.id}
                      type="button"
                      data-screen-row
                      ref={(element) => {
                        if (element)
                          screenRowRefs.current.set(screen.id, element);
                        else screenRowRefs.current.delete(screen.id);
                      }}
                      className={cn(
                        "flex h-[var(--design-row-height)] w-full cursor-default items-center gap-[var(--design-baseline-unit)] rounded-[4px] px-[var(--design-baseline-unit)] text-left text-[11px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                        isActive
                          ? "bg-[var(--design-editor-active-row-color)] text-foreground"
                          : "text-foreground/85 hover:bg-[var(--design-editor-active-row-color)] hover:text-foreground",
                      )}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => onScreenSelect?.(screen.id)}
                      title={screen.filename ?? screen.name}
                    >
                      <LayerGlyph node={{ ...screen, type: "file" }} />
                      <span className="min-w-0 flex-1 truncate">
                        {screen.name}
                      </span>
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
          </div>
        ) : null}

        {screenRows.length > 0 ? (
          <div
            data-screen-section-resizer
            role="separator"
            aria-label={labels.resizeScreens}
            aria-orientation="horizontal"
            aria-valuemin={screenResizeMetrics.min}
            aria-valuemax={screenResizeMetrics.max}
            aria-valuenow={screenResizeMetrics.now}
            tabIndex={0}
            className="group relative z-10 h-2 shrink-0 cursor-row-resize touch-none bg-transparent outline-none focus-visible:bg-[var(--design-editor-selection-color)]"
            onKeyDown={handleScreenResizeKeyDown}
            onPointerCancel={stopScreenResize}
            onPointerDown={handleScreenResizePointerDown}
            onPointerMove={handleScreenResizePointerMove}
            onPointerUp={stopScreenResize}
          >
            <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-[var(--design-editor-panel-divider-color)] transition-colors group-hover:bg-[var(--design-editor-selection-color)]" />
          </div>
        ) : null}

        <div
          data-layers-panel-header="layers"
          className="flex h-[var(--design-section-height)] shrink-0 items-center justify-between px-2"
        >
          <div className="min-w-0">
            <h2 className="truncate text-[11px] font-semibold text-foreground">
              {labels.title}
            </h2>
          </div>
          <div className="flex items-center gap-0.5 text-muted-foreground">
            <IconTooltipButton
              label={labels.searchPlaceholder}
              dataAction="search"
              onClick={focusSearch}
            >
              <IconSearch
                className="!size-[var(--design-icon-size)]"
                strokeWidth={1.8}
              />
            </IconTooltipButton>
            <button
              type="button"
              data-layers-panel-action="collapse"
              className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
              aria-label={labels.collapse}
              disabled={collapsedIds.length === expandedIds.length}
              onClick={collapseLayers}
            >
              <IconListTree
                className="!size-[var(--design-icon-size)]"
                strokeWidth={1.5}
              />
            </button>
          </div>
        </div>

        {shouldShowSearch ? (
          <div className="shrink-0 p-1.5">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
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
                className="h-6 rounded-[4px] border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] pl-6 text-[11px] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
              />
            </div>
          </div>
        ) : null}

        <div
          ref={scrollContainerRef}
          className="min-h-0 flex-1 overflow-auto overscroll-contain py-1"
          onDragOver={handleRowsDragOver}
          onDrop={stopAutoScroll}
          onDragEnd={stopAutoScroll}
        >
          {visibleRows.length ? (
            <div
              className="w-max min-w-full px-1.5"
              role="tree"
              aria-label={labels.title}
            >
              {visibleRows.map((row, index) => {
                const isSelected = selectedIdSet.has(row.node.id);
                const isInSelectedSubtree = row.ancestorIds.some((id) =>
                  selectedIdSet.has(id),
                );
                const selectionBlockId = selectionBlockIds[index];
                const isSelectionBlockStart = Boolean(
                  selectionBlockId &&
                  selectionBlockIds[index - 1] !== selectionBlockId,
                );
                const isSelectionBlockEnd = Boolean(
                  selectionBlockId &&
                  selectionBlockIds[index + 1] !== selectionBlockId,
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
                    isSelectionBlockStart={isSelectionBlockStart}
                    isSelectionBlockEnd={isSelectionBlockEnd}
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
    </TooltipProvider>
  );
}

const LayersPanelWithRef = forwardRef(LayersPanelImpl);
LayersPanelWithRef.displayName = "LayersPanel";
export const LayersPanel = memo(LayersPanelWithRef);

interface LayerRowProps {
  row: FlatLayerRow;
  labels: LayersPanelLabels;
  isExpanded: boolean;
  isSelected: boolean;
  isInSelectedSubtree: boolean;
  isSelectionBlockStart: boolean;
  isSelectionBlockEnd: boolean;
  isActiveScreen: boolean;
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
  activeDropPlacement: LayersPanelMoveIntent["placement"] | null;
  onDropIndicatorChange: (intent: LayersPanelMoveIntent | null) => void;
  selectedIdsRef: RefObject<readonly string[]>;
  visibleRowsRef: RefObject<FlatLayerRow[]>;
  rootsRef: RefObject<LayersPanelNode[]>;
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

function LayerRowIndentSlots({
  count,
  control,
}: {
  count: number;
  control?: ReactNode;
}) {
  return (
    <span
      data-layer-row-indents
      className="flex h-full shrink-0"
      aria-hidden={control ? undefined : true}
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          data-layer-row-indent
          className={cn(
            "flex h-full w-5 shrink-0 items-center justify-center",
            index > 0 && "mr-[var(--design-baseline-unit)]",
          )}
        >
          {index === count - 1 ? control : null}
        </span>
      ))}
    </span>
  );
}

function LayerDropIndicator({
  depth,
  placement,
}: {
  depth: number;
  placement: "before" | "after";
}) {
  return (
    <span
      data-layer-drop-indicator={placement}
      className={cn(
        "pointer-events-none absolute left-0 right-2 z-10 flex h-px",
        placement === "before" ? "top-0" : "bottom-0",
      )}
    >
      <LayerRowIndentSlots count={depth} />
      <span className="h-px min-w-0 flex-1 bg-[var(--design-editor-accent-color)]" />
    </span>
  );
}

const LayerRow = memo(function LayerRow({
  row,
  labels,
  isExpanded,
  isSelected,
  isInSelectedSubtree,
  isSelectionBlockStart,
  isSelectionBlockEnd,
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
  const t = useT();
  const applePlatform = useApplePlatform();
  const shortcut = (binding: string) =>
    formatShortcutLabel(binding, applePlatform);
  const { node, depth, hasChildren, canAcceptChildren } = row;
  const isComponentLayer = layerNodeIsComponent(node);
  const selectable = node.selectable !== false;
  const lockable = node.lockable !== false && Boolean(onToggleLocked);
  const hideable = node.hideable !== false && Boolean(onToggleHidden);
  const dragSourceEligible = selectable && !node.locked;
  const anchorEligible = selectable;
  const draggable = dragSourceEligible && Boolean(onMoveLayer);
  const canDropInside = layerCanDropInside(
    node,
    hasChildren,
    canAcceptChildren,
  );
  const isExpandedWithChildren = hasChildren && isExpanded;
  const activeDrop = activeDropPlacement;
  const renameCancelledRef = useRef(false);
  const preventContextMenuFocusRestoreRef = useRef(false);
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

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Space") {
      if (event.key === "Enter" && isSelected) return;
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
    const plainArrow =
      !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (
      plainArrow &&
      event.key === "ArrowRight" &&
      hasChildren &&
      !isExpanded
    ) {
      event.preventDefault();
      onToggleExpanded(node.id, true);
      return;
    }
    if (plainArrow && event.key === "ArrowLeft" && hasChildren && isExpanded) {
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
    const roots = rootsRef.current;
    const ancestorIdMap = buildAncestorIdMap(roots);
    const nodeById = buildLayerNodeMap(roots);
    const allRows = flattenRows(roots, new Set(), true);
    const draggedIds = getDraggedLayerIdsForRows({
      selectedIds: selectedIdsRef.current,
      nodeId: node.id,
      visibleRows: allRows,
      ancestorIdMap,
      nodeById,
    });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-design-layer-id", node.id);
    event.dataTransfer.setData(
      "application/x-design-layer-ids",
      JSON.stringify(draggedIds),
    );
    if (draggedIds.length > 1) {
      const ghost = document.createElement("div");
      ghost.textContent = t("layersPanel.dragGhostCount", {
        count: draggedIds.length,
      });
      ghost.className =
        "fixed left-[-9999px] top-[-9999px] pointer-events-none select-none whitespace-nowrap rounded-full border border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] px-2.5 py-1 text-[11px] font-medium leading-none text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.08)]";
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, -12, -12);
      requestAnimationFrame(() => {
        ghost.remove();
      });
    }
    activeDragState = { sourceId: node.id, draggedIds };
  };

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
      duplicate: event.altKey,
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
    if (
      !draggedIds.some(Boolean) &&
      canUseActiveDragStateForDrop(activeDragState, activeDropIntent, node.id)
    ) {
      draggedIds = activeDragState!.draggedIds;
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
      const panelIntent: LayersPanelMoveIntent =
        storedIntent && storedIntent.draggedIds.length > 0
          ? { ...storedIntent, duplicate: event.altKey }
          : ({
              draggedIds: cleanedIds,
              targetId: node.id,
              placement: dropPlacementForEvent(
                event,
                canDropInside,
                isExpandedWithChildren,
              ),
              duplicate: event.altKey,
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

  const getContextMenuTargetIdsForRow = () =>
    getContextMenuTargetIds({
      selectedIds: selectedIdsRef.current,
      nodeId: node.id,
      visibleRows: visibleRowsRef.current,
    });

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
          className="relative w-max min-w-full"
          draggable={draggable}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={(event) => {
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
            <LayerDropIndicator depth={depth} placement="before" />
          ) : null}
          {activeDrop === "after" ? (
            <LayerDropIndicator depth={depth} placement="after" />
          ) : null}
          <div
            data-layer-row-content
            data-layer-depth={depth}
            data-layer-selection={
              isSelected
                ? "primary"
                : isInSelectedSubtree
                  ? "descendant"
                  : undefined
            }
            data-layer-drop-indicator={
              activeDrop === "inside" ? "inside" : undefined
            }
            className={cn(
              "group flex h-[var(--design-row-height)] w-max min-w-full items-center pr-[var(--design-baseline-half)] text-[11px] bg-[var(--design-editor-panel-bg)]",
              !isSelected && !isInSelectedSubtree && "rounded-[4px]",
              isSelectionBlockStart && isSelectionBlockEnd && "rounded-[4px]",
              isSelectionBlockStart &&
                !isSelectionBlockEnd &&
                "rounded-t-[4px]",
              !isSelectionBlockStart &&
                isSelectionBlockEnd &&
                "rounded-b-[4px]",
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
              isHovered &&
                !isSelected &&
                !isInSelectedSubtree &&
                !isActiveScreen &&
                "bg-[var(--design-editor-layer-hover-color)] text-foreground",
              node.hidden && "text-muted-foreground",
            )}
          >
            <LayerRowIndentSlots
              count={layerRowIndentCount(depth)}
              control={
                hasChildren ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-layer-row-chevron={
                      isExpanded ? "expanded" : "collapsed"
                    }
                    className="size-5 shrink-0 rounded-sm p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    aria-label={isExpanded ? labels.collapse : labels.expand}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleExpanded(
                        node.id,
                        !isExpanded,
                        event.altKey ? node : undefined,
                      );
                    }}
                  >
                    {isExpanded ? (
                      <IconChevronDown
                        className="!size-2.5"
                        strokeWidth={1.8}
                      />
                    ) : (
                      <IconChevronRight
                        className="!size-2.5 rtl:-scale-x-100"
                        strokeWidth={1.8}
                      />
                    )}
                  </Button>
                ) : undefined
              }
            />

            <button
              type="button"
              disabled={!selectable}
              data-layer-row-button
              data-layer-node-id={node.id}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-[var(--design-baseline-unit)] rounded-sm py-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                selectable ? "cursor-default" : "cursor-default opacity-80",
              )}
              onClick={handlePointerSelect}
              onDoubleClick={() => onStartRename(node)}
              onKeyDown={handleKeyDown}
            >
              <span
                data-layer-row-icon
                className={cn(
                  "flex size-[var(--design-icon-size)] shrink-0 items-center justify-center text-muted-foreground",
                  isComponentLayer
                    ? "text-[var(--design-editor-component-color)]"
                    : undefined,
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
                    if (renameCancelledRef.current) {
                      renameCancelledRef.current = false;
                      return;
                    }
                    onCommitRename(node.id);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onCommitRename(node.id);
                    } else if (event.key === "Tab") {
                      event.preventDefault();
                      onCommitRename(node.id);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      renameCancelledRef.current = true;
                      onCancelRename(node.id);
                    }
                  }}
                  className="h-5 min-w-0 flex-1 rounded-[3px] border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-panel-bg)] px-1 text-[11px] text-foreground outline-none"
                  aria-label={labels.rename}
                />
              ) : (
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-normal leading-4",
                    node.hidden ? "text-muted-foreground" : "text-foreground",
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

            {(lockable || hideable) && (
              <div
                className={cn(
                  "sticky right-0 z-10 ml-auto flex shrink-0 items-center bg-inherit",
                  node.locked || node.hidden
                    ? "w-auto overflow-visible"
                    : "w-0 overflow-hidden group-hover:w-auto group-hover:overflow-visible focus-within:w-auto focus-within:overflow-visible",
                )}
              >
                <div className="absolute inset-0 -z-20 bg-[var(--design-editor-panel-bg)]" />
                <div className="absolute inset-0 -z-10 bg-inherit" />
                {lockable ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "size-[var(--design-control-height)] shrink-0 rounded-sm p-0 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
                          node.locked && "opacity-100",
                          isSelected && "text-foreground",
                        )}
                        aria-label={node.locked ? labels.unlock : labels.lock}
                        draggable={false}
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          const nextLocked = !node.locked;
                          onToggleLocked?.(node.id, nextLocked);
                          beginIconToggleDrag("locked", nextLocked);
                        }}
                        onClick={(event) => {
                          if (event.detail !== 0) return;
                          event.stopPropagation();
                          onToggleLocked?.(node.id, !node.locked);
                        }}
                        onMouseEnter={() => {
                          if (
                            activeIconToggleDrag?.kind === "locked" &&
                            node.locked !== activeIconToggleDrag.value
                          ) {
                            onToggleLocked?.(
                              node.id,
                              activeIconToggleDrag.value,
                            );
                          }
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
                          "size-[var(--design-control-height)] shrink-0 rounded-sm p-0 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
                          node.hidden && "opacity-100",
                          isSelected && "text-foreground",
                        )}
                        aria-label={node.hidden ? labels.show : labels.hide}
                        draggable={false}
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          const nextHidden = !node.hidden;
                          onToggleHidden?.(node.id, nextHidden);
                          beginIconToggleDrag("hidden", nextHidden);
                        }}
                        onClick={(event) => {
                          if (event.detail !== 0) return;
                          event.stopPropagation();
                          onToggleHidden?.(node.id, !node.hidden);
                        }}
                        onMouseEnter={() => {
                          if (
                            activeIconToggleDrag?.kind === "hidden" &&
                            node.hidden !== activeIconToggleDrag.value
                          ) {
                            onToggleHidden?.(
                              node.id,
                              activeIconToggleDrag.value,
                            );
                          }
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
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      {showContextMenu ? (
        <ContextMenuContent
          className="z-[300] min-w-[200px] text-[12px]"
          onCloseAutoFocus={(event) => {
            if (!preventContextMenuFocusRestoreRef.current) return;
            event.preventDefault();
            preventContextMenuFocusRestoreRef.current = false;
          }}
        >
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
              <ContextMenuShortcut>{shortcut("$mod+c")}</ContextMenuShortcut>
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
                {shortcut("$mod+shift+r")}
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
                <ContextMenuShortcut>{shortcut("]")}</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 text-[12px]"
                onSelect={() =>
                  onReorderLayer(getContextMenuTargetIdsForRow(), "back")
                }
              >
                <IconStackBack className="size-3.5 text-muted-foreground" />
                {labels.sendToBack}
                <ContextMenuShortcut>{shortcut("[")}</ContextMenuShortcut>
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
              <ContextMenuShortcut>{shortcut("$mod+g")}</ContextMenuShortcut>
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
                {shortcut("$mod+alt+g")}
              </ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          {onRename && node.renamable !== false ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => {
                preventContextMenuFocusRestoreRef.current = true;
                onStartRename(node);
              }}
            >
              <IconPencil className="size-3.5 text-muted-foreground" />
              {labels.rename}
              <ContextMenuShortcut>{shortcut("$mod+r")}</ContextMenuShortcut>
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
                {shortcut("$mod+shift+g")}
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
                {shortcut("$mod+shift+h")}
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
                {shortcut("$mod+shift+l")}
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
              <ContextMenuShortcut>{shortcut("shift+h")}</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          {onFlipVertical ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onFlipVertical(getContextMenuTargetIdsForRow())}
            >
              <IconFlipVertical className="size-3.5 text-muted-foreground" />
              {labels.flipVertical}
              <ContextMenuShortcut>{shortcut("shift+v")}</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
});

function IconTooltipButton({
  label,
  dataAction,
  onClick,
  disabled,
  children,
}: {
  label: string;
  dataAction?: string;
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
            data-layers-panel-action={dataAction}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground"
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
  node: Pick<
    LayersPanelNode,
    "type" | "layout" | "tagName" | "detail" | "isComponent"
  >;
}) {
  const componentColor = "text-[var(--design-editor-component-color)]";
  const common = cn(
    "size-[var(--design-icon-size)]",
    node.isComponent && componentColor,
  );
  if (layerNodeUsesImageGlyph(node)) {
    return <IconPhoto className={common} />;
  }
  switch (node.type) {
    case "file":
    case "screen":
      return <IconFile className={common} />;
    case "frame":
      return <LayoutLayerGlyph node={node} className={common} />;
    case "group":
    case "section":
      return <LayoutLayerGlyph node={node} className={common} />;
    case "component":
    case "instance":
      return <IconComponents className={cn(common, componentColor)} />;
    case "ellipse":
      return <IconCircle className={common} />;
    case "board-element":
    case "shape":
    case "rectangle":
      return shapeLayerUsesLayoutGlyph(node) ? (
        <LayoutLayerGlyph node={node} className={common} />
      ) : (
        <IconSquare className={common} />
      );
    case "vector":
      return <IconVectorBezier2 className={common} />;
    case "line":
      return <IconLine className={common} />;
    case "arrow":
      return <IconArrowUpRight className={common} />;
    case "polygon":
      return <IconTriangle className={common} />;
    case "star":
      return <IconStar className={common} />;
    case "text":
      return <IconTypography className={common} />;
    case "image":
      return <IconPhoto className={common} />;
    case "code":
    case "element":
      return node.layout?.isFlexContainer || node.layout?.isGridContainer ? (
        <LayoutLayerGlyph node={node} className={common} />
      ) : (
        <IconCode className={common} />
      );
    default:
      return <IconArtboard className={common} />;
  }
}

export function shapeLayerUsesLayoutGlyph(
  node: Pick<LayersPanelNode, "type" | "layout">,
): boolean {
  return (
    ["board-element", "shape", "rectangle"].includes(node.type ?? "") &&
    Boolean(node.layout?.isFlexContainer || node.layout?.isGridContainer)
  );
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

function layerNodeIsComponent(
  node: Pick<LayersPanelNode, "type" | "isComponent">,
): boolean {
  return (
    node.isComponent === true ||
    node.type === "component" ||
    node.type === "instance"
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
    return <IconLayoutGrid className={className} />;
  }
  if (node.layout?.isFlexContainer) {
    return node.layout.flexDirection?.startsWith("row") ? (
      <IconLayoutColumns className={className} />
    ) : (
      <IconLayoutRows className={className} />
    );
  }
  return <IconArtboard className={className} />;
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
