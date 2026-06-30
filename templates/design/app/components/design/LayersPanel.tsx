import { useT } from "@agent-native/core/client";
import {
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconLayoutGrid,
  IconPencil,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const LAYER_ROW_BASE_INDENT = 4;
const LAYER_ROW_DEPTH_INDENT = 18;

export type LayersPanelNodeType =
  | "file"
  | "screen"
  | "frame"
  | "group"
  | "component"
  | "instance"
  | "section"
  | "shape"
  | "rectangle"
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
  selected: (count: number) => string;
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
const ROW_MAX_INDENT = 96;

function rowIndent(depth: number): number {
  return Math.min(ROW_BASE_INDENT + depth * ROW_INDENT_STEP, ROW_MAX_INDENT);
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
    selected: (count) => t("layersPanel.selected", { count }),
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

function flattenRows(
  nodes: LayersPanelNode[],
  expandedIds: ReadonlySet<string>,
  forceExpanded: boolean,
  depth = 0,
  parentKey = "root",
  ancestorIds: string[] = [],
  rows: FlatLayerRow[] = [],
) {
  nodes.forEach((node, index) => {
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

export function getDraggedLayerIdsForRows(args: {
  selectedIds: readonly string[];
  nodeId: string;
  visibleRows: readonly FlatLayerRow[];
}): string[] {
  const rawDraggedIds = args.selectedIds.includes(args.nodeId)
    ? getTreeOrderedLayerIds(args.selectedIds, args.visibleRows)
    : [args.nodeId];
  const draggedIdSet = new Set(rawDraggedIds);
  return rawDraggedIds.filter((id) => {
    const rowForId = args.visibleRows.find((row) => row.node.id === id);
    return !rowForId?.ancestorIds.some((ancestorId) =>
      draggedIdSet.has(ancestorId),
    );
  });
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

export function LayersPanel({
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
}: LayersPanelProps) {
  const t = useT();
  const labels = useMemo(() => mergeLabels(labelsProp, t), [labelsProp, t]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedIdsRef = useRef<readonly string[]>(selectedIds);
  const lastPanelSelectionSignatureRef = useRef(selectedIds.join("\0"));
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const lastSelectionAnchorRef = useRef<string | null>(selectedIds[0] ?? null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowElementRefs = useRef(new Map<string, HTMLDivElement>());
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

  useEffect(() => {
    if (selectedAncestorIds.length === 0) return;
    const next = new Set(expandedIds);
    let changed = false;
    selectedAncestorIds.forEach((id) => {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    });
    if (changed) onExpandedIdsChange(Array.from(next));
  }, [expandedIds, onExpandedIdsChange, selectedAncestorIds]);

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
          nextIds = options.additive
            ? Array.from(new Set([...currentSelectedIds, ...rangeIds]))
            : rangeIds;
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

  const hasAnyRows = roots.length > 0;
  const selectedCount = selectedIds.length;
  const screenRows = screens ?? files ?? [];
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);
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
                onClick={openSearch}
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
                  <LayerGlyph
                    node={{ ...screen, type: "file" }}
                    selected={false}
                  />
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
          {selectedCount > 1 ? (
            <p className="truncate text-[10px] text-muted-foreground">
              {labels.selected(selectedCount)}
            </p>
          ) : null}
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

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain py-2">
        {visibleRows.length ? (
          <div
            className="w-max min-w-full px-2"
            role="tree"
            aria-label={labels.title}
          >
            {visibleRows.map((row) => (
              <LayerRow
                key={row.rowKey}
                row={row}
                labels={labels}
                isExpanded={expandedIdSet.has(row.node.id)}
                isSelected={selectedIdSet.has(row.node.id)}
                isInSelectedSubtree={row.ancestorIds.some((id) =>
                  selectedIdSet.has(id),
                )}
                isActiveScreen={
                  row.node.id === activeScreenId &&
                  (row.node.type === "file" ||
                    row.node.type === "screen" ||
                    row.node.type === "frame")
                }
                isRenaming={renamingId === row.node.id}
                rowRef={(element) => registerRowElement(row.rowKey, element)}
                renameDraft={renameDraft}
                onRenameDraftChange={setRenameDraft}
                onCommitRename={commitRename}
                onCancelRename={() => setRenamingId(null)}
                onStartRename={startRename}
                onRename={onRename}
                onSelect={selectNode}
                onToggleExpanded={(expanded) =>
                  onExpandedIdsChange(
                    nextExpandedIds(expandedIds, row.node.id, expanded),
                  )
                }
                onToggleLocked={onToggleLocked}
                onToggleHidden={onToggleHidden}
                onHoverLayer={onHoverLayer}
                onLeaveLayer={onLeaveLayer}
                onMoveLayer={onMoveLayer}
                canMoveLayer={canMoveLayer}
                dropIndicator={dropIndicator}
                onDropIndicatorChange={setDropIndicator}
                selectedIds={selectedIds}
                visibleRows={visibleRows}
              />
            ))}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
            {hasAnyRows ? labels.noMatches : labels.empty}
          </div>
        )}
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </aside>
  );
}

function LayerRow({
  row,
  labels,
  isExpanded,
  isSelected,
  isInSelectedSubtree,
  isActiveScreen,
  isRenaming,
  rowRef,
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
  dropIndicator,
  onDropIndicatorChange,
  selectedIds,
  visibleRows,
}: {
  row: FlatLayerRow;
  labels: LayersPanelLabels;
  isExpanded: boolean;
  isSelected: boolean;
  isInSelectedSubtree: boolean;
  isActiveScreen: boolean;
  isRenaming: boolean;
  rowRef: (element: HTMLDivElement | null) => void;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
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
  onToggleExpanded: (expanded: boolean) => void;
  onToggleLocked?: (id: string, locked: boolean) => void;
  onToggleHidden?: (id: string, hidden: boolean) => void;
  onHoverLayer?: (id: string) => void;
  onLeaveLayer?: (id: string) => void;
  onMoveLayer?: (intent: LayersPanelMoveIntent) => void;
  canMoveLayer?: (intent: LayersPanelMoveIntent) => boolean;
  dropIndicator: LayersPanelMoveIntent | null;
  onDropIndicatorChange: (intent: LayersPanelMoveIntent | null) => void;
  selectedIds: readonly string[];
  visibleRows: FlatLayerRow[];
}) {
  const { node, depth, hasChildren, canAcceptChildren } = row;
  const selectable = node.selectable !== false;
  const lockable = node.lockable !== false && Boolean(onToggleLocked);
  const hideable = node.hideable !== false && Boolean(onToggleHidden);
  const dragEligible = selectable && !node.locked && !node.hidden;
  const draggable = dragEligible && Boolean(onMoveLayer);
  const canDropInside = layerCanDropInside(
    node,
    hasChildren,
    canAcceptChildren,
  );
  const activeDrop =
    dropIndicator?.targetId === node.id ? dropIndicator.placement : null;
  // Tracks whether the user pressed Escape to cancel rename so that the
  // subsequent blur event does not commit the edit.
  const renameCancelledRef = useRef(false);

  const readSelectedIdsFromTree = (target: HTMLElement): string[] => {
    const tree = target.closest('[role="tree"]');
    if (!tree) return selectedIds.filter((id) => !id.startsWith("__"));
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
    const getFocusableButtons = () => {
      const tree = event.currentTarget.closest('[role="tree"]');
      if (!tree) return [];
      return Array.from(
        tree.querySelectorAll<HTMLButtonElement>("[data-layer-row-button]"),
      ).filter((button) => !button.disabled);
    };
    const focusVisibleButton = (nextIndex: number) => {
      const buttons = getFocusableButtons();
      const target =
        buttons[Math.max(0, Math.min(buttons.length - 1, nextIndex))];
      target?.focus();
      return Boolean(target);
    };
    const focusNodeButton = (nodeId: string) => {
      const tree = event.currentTarget.closest('[role="tree"]');
      const target = tree?.querySelector<HTMLButtonElement>(
        `[data-layer-node-id="${CSS.escape(nodeId)}"]`,
      );
      if (!target || target.disabled) return false;
      target.focus();
      return true;
    };
    const currentIndex = visibleRows.findIndex(
      (visibleRow) => visibleRow.rowKey === row.rowKey,
    );
    const focusableButtons = getFocusableButtons();
    const currentFocusableIndex = focusableButtons.indexOf(event.currentTarget);

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
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusVisibleButton(currentFocusableIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusVisibleButton(currentFocusableIndex - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusVisibleButton(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusVisibleButton(focusableButtons.length - 1);
      return;
    }
    if (event.key === "ArrowRight" && hasChildren && !isExpanded) {
      event.preventDefault();
      onToggleExpanded(true);
      return;
    }
    if (event.key === "ArrowRight" && hasChildren && isExpanded) {
      event.preventDefault();
      const nextButton = focusableButtons[currentFocusableIndex + 1];
      const childId = nextButton?.dataset.layerNodeId;
      const child = childId
        ? visibleRows.find((visibleRow) => visibleRow.node.id === childId)
        : null;
      if (child?.ancestorIds.includes(node.id)) {
        focusVisibleButton(currentFocusableIndex + 1);
      }
      return;
    }
    if (event.key === "ArrowLeft" && hasChildren && isExpanded) {
      event.preventDefault();
      onToggleExpanded(false);
      return;
    }
    if (event.key === "ArrowLeft" && row.ancestorIds.length > 0) {
      event.preventDefault();
      const parentId = row.ancestorIds[row.ancestorIds.length - 1];
      if (parentId) focusNodeButton(parentId);
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!draggable) {
      event.preventDefault();
      return;
    }
    const draggedIds = getDraggedLayerIdsForRows({
      selectedIds,
      nodeId: node.id,
      visibleRows,
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

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onMoveLayer || !dragEligible) return;
    // dataTransfer.getData() always returns "" during dragover per spec.
    // Read from the module-level activeDragState set in handleDragStart instead.
    if (!activeDragState) return;
    const { sourceId, draggedIds } = activeDragState;
    if (sourceId === node.id) return;
    const cleanedIds = draggedIds.filter(
      (id) => id && id !== node.id && !id.startsWith("__"),
    );
    if (cleanedIds.length === 0) return;
    const intent = {
      draggedIds: cleanedIds,
      targetId: node.id,
      placement: dropPlacementForEvent(event, canDropInside),
    } satisfies LayersPanelMoveIntent;
    if (canMoveLayer && !canMoveLayer(intent)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    activeDropIntent = intent;
    onDropIndicatorChange(intent);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onMoveLayer || !dragEligible) {
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
      const intent =
        storedIntent && storedIntent.draggedIds.length > 0
          ? storedIntent
          : ({
              draggedIds: cleanedIds,
              targetId: node.id,
              placement: dropPlacementForEvent(event, canDropInside),
            } satisfies LayersPanelMoveIntent);
      if (!canMoveLayer || canMoveLayer(intent)) {
        onMoveLayer(intent);
      }
    }
    activeDropIntent = null;
    onDropIndicatorChange(null);
  };

  const showContextMenu =
    selectable &&
    (Boolean(onRename && node.renamable !== false) || lockable || hideable);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!showContextMenu}>
        <div
          ref={rowRef}
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
          }}
          onDrop={handleDrop}
          onDragEnd={() => {
            activeDragState = null;
            activeDropIntent = null;
            onDropIndicatorChange(null);
          }}
          onMouseEnter={() => onHoverLayer?.(node.id)}
          onMouseLeave={() => onLeaveLayer?.(node.id)}
        >
          {activeDrop === "before" ? (
            <span className="pointer-events-none absolute left-2 right-2 top-0 z-10 h-px bg-[var(--design-editor-accent-color)]" />
          ) : null}
          {activeDrop === "after" ? (
            <span className="pointer-events-none absolute bottom-0 left-2 right-2 z-10 h-px bg-[var(--design-editor-accent-color)]" />
          ) : null}
          <div
            className={cn(
              "group flex h-8 min-w-full items-center gap-1 rounded-[5px] pr-1 text-[12px]",
              activeDrop === "inside" &&
                "ring-1 ring-inset ring-[var(--design-editor-accent-color)]",
              isSelected &&
                "bg-[var(--design-editor-selection-color)] text-foreground",
              !isSelected &&
                isInSelectedSubtree &&
                "bg-[var(--design-editor-selected-subtree-color)] text-foreground/95",
              !isSelected &&
                isActiveScreen &&
                "bg-[var(--design-editor-active-row-color)] text-foreground hover:bg-[var(--design-editor-active-row-color)]",
              !isSelected &&
                !isInSelectedSubtree &&
                !isActiveScreen &&
                "text-foreground/90 hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground",
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
                  onToggleExpanded(!isExpanded);
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
                  (isSelected || isInSelectedSubtree) && "text-foreground",
                )}
              >
                {node.icon ?? (
                  <LayerGlyph
                    node={node}
                    selected={isSelected}
                    inSelectedSubtree={isInSelectedSubtree}
                  />
                )}
              </span>
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
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
                      onCancelRename();
                    }
                  }}
                  className="h-6 min-w-0 flex-1 rounded-[4px] border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-panel-bg)] px-1.5 text-[12px] text-foreground outline-none"
                  aria-label={labels.rename}
                />
              ) : (
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium leading-none",
                    node.hidden && "line-through",
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
        <ContextMenuContent className="z-[300] min-w-[160px] text-[12px]">
          {onRename && node.renamable !== false ? (
            <ContextMenuItem
              className="gap-2 text-[12px]"
              onSelect={() => onStartRename(node)}
            >
              <IconPencil className="size-3.5 text-muted-foreground" />
              {labels.rename}
            </ContextMenuItem>
          ) : null}
          {onRename && node.renamable !== false && (lockable || hideable) ? (
            <ContextMenuSeparator />
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
            </ContextMenuItem>
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
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
}

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
  selected,
  inSelectedSubtree,
}: {
  node: Pick<LayersPanelNode, "type" | "layout">;
  selected?: boolean;
  inSelectedSubtree?: boolean;
}) {
  const common = "size-4";
  const componentColor =
    selected || inSelectedSubtree
      ? "text-foreground"
      : "text-[var(--design-editor-accent-color)]";
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
    case "board-element":
    case "shape":
    case "rectangle":
      return <RectangleLayerGlyph className={common} />;
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

function dropPlacementForEvent(
  event: DragEvent<HTMLDivElement>,
  canDropInside: boolean,
): LayersPanelMoveIntent["placement"] {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = event.clientY - rect.top;
  if (offset < rect.height * 0.3) return "before";
  if (offset > rect.height * 0.7) return "after";
  return canDropInside ? "inside" : "after";
}
