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
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export interface LayersPanelLabels {
  title: string;
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
  onExpandedIdsChange: (ids: string[]) => void;
  onSelectionChange: (
    ids: string[],
    intent: LayersPanelSelectionIntent,
  ) => void;
  onRename?: (id: string, name: string) => void;
  onToggleLocked?: (id: string, locked: boolean) => void;
  onToggleHidden?: (id: string, hidden: boolean) => void;
}

interface FlatLayerRow {
  node: LayersPanelNode;
  depth: number;
  hasChildren: boolean;
}

const SECTION_CODE_ID = "__design_layers_code__";
const SECTION_ELEMENT_ID = "__design_layers_elements__";

function defaultLabels(t: ReturnType<typeof useT>): LayersPanelLabels {
  return {
    title: t("layersPanel.title"),
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
    .filter((value) => value != null)
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
  rows: FlatLayerRow[] = [],
) {
  for (const node of nodes) {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    rows.push({ node, depth, hasChildren });
    if (hasChildren && (forceExpanded || expandedIds.has(node.id))) {
      flattenRows(children, expandedIds, forceExpanded, depth + 1, rows);
    }
  }
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
  onExpandedIdsChange,
  onSelectionChange,
  onRename,
  onToggleLocked,
  onToggleHidden,
}: LayersPanelProps) {
  const t = useT();
  const labels = useMemo(() => mergeLabels(labelsProp, t), [labelsProp, t]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const lastSelectionAnchorRef = useRef<string | null>(selectedIds[0] ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

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

  const hasAnyRows = roots.length > 0;
  const selectedCount = selectedIds.length;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background text-sm",
        className,
      )}
      aria-label={labels.title}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="min-w-0">
          <h2 className="truncate text-xs font-medium text-foreground">
            {labels.title}
          </h2>
          {selectedCount > 1 ? (
            <p className="truncate text-[11px] text-muted-foreground">
              {labels.selected(selectedCount)}
            </p>
          ) : null}
        </div>
        <IconStack2 className="size-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="shrink-0 border-b border-border p-2">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={labels.searchPlaceholder}
            className="h-8 rounded-md pl-7 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {visibleRows.length ? (
          <div role="tree" aria-label={labels.title}>
            {visibleRows.map((row) => (
              <LayerRow
                key={row.node.id}
                row={row}
                labels={labels}
                isExpanded={expandedIdSet.has(row.node.id)}
                isSelected={selectedIdSet.has(row.node.id)}
                isRenaming={renamingId === row.node.id}
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
              />
            ))}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
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
  isRenaming,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onSelect,
  onToggleExpanded,
  onToggleLocked,
  onToggleHidden,
}: {
  row: FlatLayerRow;
  labels: LayersPanelLabels;
  isExpanded: boolean;
  isSelected: boolean;
  isRenaming: boolean;
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
}) {
  const { node, depth, hasChildren } = row;
  const Icon = layerTypeIcon(node.type);
  const selectable = node.selectable !== false;
  const lockable = node.lockable !== false && Boolean(onToggleLocked);
  const hideable = node.hideable !== false && Boolean(onToggleHidden);

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

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={selectable ? isSelected : undefined}
      className="relative"
    >
      {Array.from({ length: depth }).map((_, index) => (
        <span
          key={index}
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-border/70"
          style={{ left: 17 + index * 14 }}
        />
      ))}
      <div
        className={cn(
          "group flex h-7 items-center gap-0.5 pr-1 text-xs",
          isSelected && "bg-accent text-accent-foreground",
          !isSelected && "text-foreground hover:bg-accent/50",
          node.hidden && "text-muted-foreground",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5 shrink-0 rounded-sm"
            aria-label={isExpanded ? labels.collapse : labels.expand}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(!isExpanded);
            }}
          >
            {isExpanded ? (
              <IconChevronDown className="size-3.5" />
            ) : (
              <IconChevronRight className="size-3.5 rtl:-scale-x-100" />
            )}
          </Button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        <button
          type="button"
          disabled={!selectable}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selectable ? "cursor-default" : "cursor-default opacity-80",
          )}
          onClick={handlePointerSelect}
          onDoubleClick={() => onStartRename(node)}
          onKeyDown={handleKeyDown}
          title={node.name}
        >
          <span className="shrink-0 text-muted-foreground">
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
              className="h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-xs text-foreground outline-none"
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
            <span className="hidden max-w-[88px] truncate text-[10px] text-muted-foreground group-hover:inline">
              {node.detail}
            </span>
          ) : null}
          {!isRenaming && node.badge != null ? (
            <span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
              {node.badge}
            </span>
          ) : null}
        </button>

        {lockable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-5 shrink-0 rounded-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              node.locked && "opacity-100 text-muted-foreground",
            )}
            aria-label={node.locked ? labels.unlock : labels.lock}
            title={node.locked ? labels.unlock : labels.lock}
            onClick={(event) => {
              event.stopPropagation();
              onToggleLocked?.(node.id, !node.locked);
            }}
          >
            {node.locked ? (
              <IconLock className="size-3.5" />
            ) : (
              <IconLockOpen className="size-3.5" />
            )}
          </Button>
        ) : null}

        {hideable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-5 shrink-0 rounded-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              node.hidden && "opacity-100 text-muted-foreground",
            )}
            aria-label={node.hidden ? labels.show : labels.hide}
            title={node.hidden ? labels.show : labels.hide}
            onClick={(event) => {
              event.stopPropagation();
              onToggleHidden?.(node.id, !node.hidden);
            }}
          >
            {node.hidden ? (
              <IconEyeOff className="size-3.5" />
            ) : (
              <IconEye className="size-3.5" />
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
