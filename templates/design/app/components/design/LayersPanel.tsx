import { useT } from "@agent-native/core/client";
import {
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconComponents,
  IconEye,
  IconEyeOff,
  IconFile,
  IconFileCode,
  IconFolder,
  IconFrame,
  IconHierarchy,
  IconLayersIntersect,
  IconLock,
  IconLockOpen,
  IconLayoutGrid,
  IconPlus,
  IconPhoto,
  IconRectangle,
  IconSearch,
  IconSquare,
  IconStack2,
  IconTypography,
  type Icon,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
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
  | "rectangle"
  | "text"
  | "image"
  | "code"
  | "element"
  | "unknown";

export interface LayersPanelNode {
  id: string;
  name: string;
  type?: LayersPanelNodeType;
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
  files?: LayersPanelFile[];
  layers?: LayersPanelNode[];
  codeLayers?: LayersPanelNode[];
  elementLayers?: LayersPanelNode[];
  selectedIds: readonly string[];
  expandedIds: readonly string[];
  searchQuery: string;
  className?: string;
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
}

interface FlatLayerRow {
  node: LayersPanelNode;
  rowKey: string;
  depth: number;
  hasChildren: boolean;
}

const SECTION_CODE_ID = "__design_layers_code__";
const SECTION_ELEMENT_ID = "__design_layers_elements__";

function defaultLabels(t: ReturnType<typeof useT>): LayersPanelLabels {
  return {
    title: t("layersPanel.title"),
    screens: t("layersPanel.screens"),
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
  labels,
}: Pick<
  LayersPanelProps,
  "files" | "layers" | "codeLayers" | "elementLayers"
> & {
  labels: LayersPanelLabels;
}) {
  const roots: LayersPanelNode[] = [
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
  rows: FlatLayerRow[] = [],
) {
  nodes.forEach((node, index) => {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const rowKey = `${parentKey}/${node.id}:${index}`;
    rows.push({ node, rowKey, depth, hasChildren });
    if (hasChildren && (forceExpanded || expandedIds.has(node.id))) {
      flattenRows(
        children,
        expandedIds,
        forceExpanded,
        depth + 1,
        rowKey,
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

function layerTypeIcon(type: LayersPanelNodeType | undefined): Icon {
  switch (type) {
    case "file":
      return IconFile;
    case "screen":
      return IconFrame;
    case "frame":
      return IconFrame;
    case "group":
      return IconHierarchy;
    case "component":
    case "instance":
      return IconComponents;
    case "section":
      return IconFolder;
    case "shape":
      return IconSquare;
    case "rectangle":
      return IconRectangle;
    case "text":
      return IconTypography;
    case "image":
      return IconPhoto;
    case "code":
      return IconFileCode;
    case "element":
      return IconCode;
    default:
      return IconLayersIntersect;
  }
}

export function LayersPanel({
  screens,
  activeScreenId,
  files,
  layers,
  codeLayers,
  elementLayers,
  selectedIds,
  expandedIds,
  searchQuery,
  className,
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
}: LayersPanelProps) {
  const t = useT();
  const labels = useMemo(() => mergeLabels(labelsProp, t), [labelsProp, t]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const lastSelectionAnchorRef = useRef<string | null>(selectedIds[0] ?? null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowElementRefs = useRef(new Map<string, HTMLDivElement>());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dropIndicator, setDropIndicator] =
    useState<LayersPanelMoveIntent | null>(null);

  const roots = useMemo(
    () =>
      buildRootNodes({
        files,
        layers,
        codeLayers,
        elementLayers,
        labels,
      }),
    [codeLayers, elementLayers, files, labels, layers],
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

  const selectableVisibleIds = useMemo(
    () =>
      visibleRows
        .map(({ node }) => node)
        .filter((node) => node.selectable !== false)
        .map((node) => node.id),
    [visibleRows],
  );

  const selectNode = useCallback(
    (
      id: string,
      options: {
        additive: boolean;
        range: boolean;
        source: "keyboard" | "pointer";
      },
    ) => {
      let nextIds: string[];
      if (options.range && lastSelectionAnchorRef.current) {
        const from = selectableVisibleIds.indexOf(
          lastSelectionAnchorRef.current,
        );
        const to = selectableVisibleIds.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const rangeIds = selectableVisibleIds.slice(start, end + 1);
          nextIds = options.additive
            ? Array.from(new Set([...selectedIds, ...rangeIds]))
            : rangeIds;
        } else {
          nextIds = [id];
        }
      } else if (options.additive) {
        nextIds = selectedIdSet.has(id)
          ? selectedIds.filter((selectedId) => selectedId !== id)
          : [...selectedIds, id];
      } else {
        nextIds = [id];
      }

      lastSelectionAnchorRef.current = id;
      onSelectionChange(nextIds, { id, selectedIds: nextIds, ...options });
    },
    [onSelectionChange, selectableVisibleIds, selectedIdSet, selectedIds],
  );

  const commitRename = useCallback(
    (id: string) => {
      const nextName = renameDraft.trim();
      // The panel only emits rename intent. Code-backed DOM layer renames must
      // persist through a safe source edit that updates data-agent-native-layer-name.
      if (nextName) onRename?.(id, nextName);
      setRenamingId(null);
      setRenameDraft("");
    },
    [onRename, renameDraft],
  );

  const startRename = useCallback(
    (node: LayersPanelNode) => {
      if (!onRename || node.renamable === false) return;
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

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--design-editor-panel-bg)] text-[11px] text-foreground",
        className,
      )}
      aria-label={labels.title}
    >
      {screenRows.length > 0 ? (
        <div className="shrink-0 border-b border-border pb-2">
          <div className="flex h-9 items-center justify-between px-2.5">
            <h2 className="truncate text-[11px] font-semibold text-foreground">
              {labels.screens}
            </h2>
            <div className="flex items-center gap-0.5 text-muted-foreground">
              <IconTooltipButton
                label={labels.screenOverview}
                onClick={onScreenOverview}
              >
                <IconLayoutGrid className="size-3.5" />
              </IconTooltipButton>
              <IconTooltipButton
                label={labels.searchPlaceholder}
                onClick={() => searchInputRef.current?.focus()}
              >
                <IconSearch className="size-3.5" />
              </IconTooltipButton>
              <IconTooltipButton
                label={labels.addScreen}
                disabled={!onAddScreen}
                onClick={onAddScreen}
              >
                <IconPlus className="size-3.5" />
              </IconTooltipButton>
            </div>
          </div>
          <div className="space-y-0.5 px-1">
            {screenRows.map((screen) => {
              const isActive = screen.id === activeScreenId;
              return (
                <button
                  key={screen.id}
                  type="button"
                  className={cn(
                    "flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 text-left text-[12px] font-medium outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
                    isActive
                      ? "bg-[var(--design-editor-active-row-color)] text-foreground"
                      : "text-foreground/85 hover:bg-[var(--design-editor-active-row-color)] hover:text-foreground",
                  )}
                  onClick={() => onScreenSelect?.(screen.id)}
                  title={screen.filename ?? screen.name}
                >
                  <IconFile className="size-3.5 shrink-0 text-muted-foreground" />
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

      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-[11px] font-semibold text-foreground">
            {labels.title}
          </h2>
          {selectedCount > 1 ? (
            <p className="truncate text-[10px] text-muted-foreground">
              {labels.selected(selectedCount)}
            </p>
          ) : null}
        </div>
        <IconStack2 className="size-3.5 shrink-0 text-muted-foreground" />
      </div>

      <div className="shrink-0 border-b border-border p-1.5">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={labels.searchPlaceholder}
            className="h-7 rounded-sm border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] pl-6 text-[11px] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {visibleRows.length ? (
          <div className="px-1" role="tree" aria-label={labels.title}>
            {visibleRows.map((row) => (
              <LayerRow
                key={row.rowKey}
                row={row}
                labels={labels}
                isExpanded={expandedIdSet.has(row.node.id)}
                isSelected={selectedIdSet.has(row.node.id)}
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
                dropIndicator={dropIndicator}
                onDropIndicatorChange={setDropIndicator}
                selectedIds={selectedIds}
              />
            ))}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
            {hasAnyRows ? labels.noMatches : labels.empty}
          </div>
        )}
      </div>
    </aside>
  );
}

function LayerRow({
  row,
  labels,
  isExpanded,
  isSelected,
  isActiveScreen,
  isRenaming,
  rowRef,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onSelect,
  onToggleExpanded,
  onToggleLocked,
  onToggleHidden,
  onHoverLayer,
  onLeaveLayer,
  onMoveLayer,
  dropIndicator,
  onDropIndicatorChange,
  selectedIds,
}: {
  row: FlatLayerRow;
  labels: LayersPanelLabels;
  isExpanded: boolean;
  isSelected: boolean;
  isActiveScreen: boolean;
  isRenaming: boolean;
  rowRef: (element: HTMLDivElement | null) => void;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onStartRename: (node: LayersPanelNode) => void;
  onSelect: (
    id: string,
    options: {
      additive: boolean;
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
  dropIndicator: LayersPanelMoveIntent | null;
  onDropIndicatorChange: (intent: LayersPanelMoveIntent | null) => void;
  selectedIds: readonly string[];
}) {
  const { node, depth, hasChildren } = row;
  const Icon = layerTypeIcon(node.type);
  const selectable = node.selectable !== false;
  const lockable = node.lockable !== false && Boolean(onToggleLocked);
  const hideable = node.hideable !== false && Boolean(onToggleHidden);
  const draggable = selectable && Boolean(onMoveLayer);
  const activeDrop =
    dropIndicator?.targetId === node.id ? dropIndicator.placement : null;

  const handlePointerSelect = (event: MouseEvent<HTMLButtonElement>) => {
    if (!selectable) return;
    onSelect(node.id, {
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      source: "pointer",
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onStartRename(node);
      return;
    }
    if (event.key === "ArrowRight" && hasChildren && !isExpanded) {
      event.preventDefault();
      onToggleExpanded(true);
      return;
    }
    if (event.key === "ArrowLeft" && hasChildren && isExpanded) {
      event.preventDefault();
      onToggleExpanded(false);
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!draggable) {
      event.preventDefault();
      return;
    }
    const draggedIds = selectedIds.includes(node.id)
      ? selectedIds.filter((id) => !id.startsWith("__"))
      : [node.id];
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-design-layer-id", node.id);
    event.dataTransfer.setData(
      "application/x-design-layer-ids",
      JSON.stringify(draggedIds),
    );
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onMoveLayer || !selectable) return;
    const sourceId =
      event.dataTransfer.getData("application/x-design-layer-id") || "";
    if (sourceId === node.id) return;
    const rawIds = event.dataTransfer.getData("application/x-design-layer-ids");
    let draggedIds = [sourceId];
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
    if (cleanedIds.length === 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDropIndicatorChange({
      draggedIds: cleanedIds,
      targetId: node.id,
      placement: dropPlacementForEvent(event, hasChildren),
    });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (
      !onMoveLayer ||
      !selectable ||
      !dropIndicator ||
      dropIndicator.targetId !== node.id
    ) {
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
    const cleanedIds = draggedIds.filter(
      (id) => id && id !== node.id && !id.startsWith("__"),
    );
    if (cleanedIds.length > 0) {
      onMoveLayer({
        draggedIds: cleanedIds,
        targetId: node.id,
        placement: dropIndicator.placement,
      });
    }
    onDropIndicatorChange(null);
  };

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-level={depth + 1}
      aria-selected={selectable ? isSelected : undefined}
      className="relative"
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={() => onDropIndicatorChange(null)}
      onDrop={handleDrop}
      onDragEnd={() => onDropIndicatorChange(null)}
      onMouseEnter={() => onHoverLayer?.(node.id)}
      onMouseLeave={() => onLeaveLayer?.(node.id)}
    >
      {activeDrop === "before" ? (
        <span className="pointer-events-none absolute left-2 right-2 top-0 z-10 h-px bg-[var(--design-editor-accent-color)]" />
      ) : null}
      {activeDrop === "after" ? (
        <span className="pointer-events-none absolute bottom-0 left-2 right-2 z-10 h-px bg-[var(--design-editor-accent-color)]" />
      ) : null}
      {Array.from({ length: depth }).map((_, index) => (
        <span
          key={index}
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-border/70"
          style={{ left: 15 + index * 12 }}
        />
      ))}
      <div
        className={cn(
          "group flex h-6 items-center gap-0.5 rounded-sm pr-0.5 text-[11px]",
          activeDrop === "inside" &&
            "ring-1 ring-inset ring-[var(--design-editor-accent-color)]",
          isSelected &&
            !isActiveScreen &&
            "bg-[var(--design-editor-selection-color)] text-foreground",
          isActiveScreen &&
            "bg-[var(--design-editor-active-row-color)] text-foreground hover:bg-[var(--design-editor-active-row-color)]",
          !isSelected &&
            !isActiveScreen &&
            "text-foreground/90 hover:bg-accent/70 hover:text-foreground",
          node.hidden && "text-muted-foreground",
        )}
        style={{ paddingLeft: 2 + depth * 12 }}
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
              <IconChevronDown className="size-3" />
            ) : (
              <IconChevronRight className="size-3 rtl:-scale-x-100" />
            )}
          </Button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        <button
          type="button"
          disabled={!selectable}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-sm px-1 py-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
            selectable ? "cursor-default" : "cursor-default opacity-80",
          )}
          onClick={handlePointerSelect}
          onDoubleClick={() => onStartRename(node)}
          onKeyDown={handleKeyDown}
          title={node.name}
        >
          <span
            className={cn(
              "shrink-0 text-muted-foreground",
              isSelected && "text-[var(--design-editor-accent-strong-color)]",
            )}
          >
            {node.icon ?? <Icon className="size-3.5" />}
          </span>
          {isRenaming ? (
            <input
              autoFocus
              value={renameDraft}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onBlur={() => onCommitRename(node.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCommitRename(node.id);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              className="h-5 min-w-0 flex-1 rounded-sm border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-panel-bg)] px-1 text-[11px] text-foreground outline-none"
              aria-label={labels.rename}
            />
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                node.hidden && "line-through",
              )}
            >
              {node.name}
            </span>
          )}
          {!isRenaming && node.detail ? (
            <span className="hidden max-w-[72px] shrink truncate text-[10px] text-muted-foreground group-hover:inline">
              {node.detail}
            </span>
          ) : null}
          {!isRenaming && node.badge !== null && node.badge !== undefined ? (
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
                  "size-4 shrink-0 rounded-sm p-0 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
                  node.locked && "opacity-100",
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
                  "size-4 shrink-0 rounded-sm p-0 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
                  node.hidden && "opacity-100",
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
            className="size-6 rounded-sm p-0 hover:bg-accent hover:text-foreground"
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
