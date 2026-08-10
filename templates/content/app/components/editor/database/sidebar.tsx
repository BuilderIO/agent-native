import { useT } from "@agent-native/core/client/i18n";
import type {
  ContentDatabaseItem,
  ContentDatabaseOpenPagesIn,
  ContentDatabasePersonalViewOverrides,
  ContentDatabaseResponse,
  ContentDatabaseViewConfig,
  ContentSidebarOrderMode,
  ContentSidebarViewOrder,
} from "@shared/api";
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconDots,
  IconFileText,
  IconPlus,
  IconStar,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { documentSidebarActionAvailability } from "@/components/sidebar/document-sidebar-actions";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  SidebarDropIndicator,
  SidebarReorderProvider,
  useSidebarReorderItem,
  type SidebarReorderLabels,
} from "../../sidebar/sidebar-reorder";
import { applyDatabaseView } from "./filter-sort";
import {
  databaseViewGroupingProperty,
  databaseViewItemGroups,
  databaseVisibleGroups,
} from "./grouping";
import type { DatabaseBoardGroup } from "./types";
import {
  activeDatabaseView,
  defaultDatabaseViewConfig,
  normalizeClientDatabaseViewConfig,
} from "./view-config";

export interface ContentFilesSidebarManualReorder {
  onReorder: (
    itemIds: string[],
    moved: { itemId: string; position: number },
  ) => void;
  labels: SidebarReorderLabels;
}

export interface ContentFilesSidebarRenderReorder {
  controls: ReturnType<typeof useSidebarReorderItem>;
  labels: SidebarReorderLabels;
}

export function databaseSidebarReorderItems(
  items: ContentDatabaseItem[],
  untitledLabel: string,
  hierarchical: boolean,
) {
  return items.map((item) => ({
    id: item.id,
    label: item.document.title || untitledLabel,
    parentId: hierarchical ? item.document.parentId : null,
  }));
}

export function contentSidebarOrderedItems(
  items: ContentDatabaseItem[],
  order: ContentSidebarViewOrder,
) {
  const itemIds = new Map(
    order.itemIds.map((itemId, index) => [itemId, index]),
  );
  const stableItemId = (
    left: ContentDatabaseItem,
    right: ContentDatabaseItem,
  ) => left.id.localeCompare(right.id);
  const newestFirst = (left: string, right: string) =>
    new Date(right).getTime() - new Date(left).getTime();

  return [...items].sort((left, right) => {
    if (order.mode === "custom") {
      const leftIndex = itemIds.get(left.id);
      const rightIndex = itemIds.get(right.id);
      if (leftIndex !== undefined || rightIndex !== undefined) {
        if (leftIndex === undefined) return 1;
        if (rightIndex === undefined) return -1;
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      }
      return left.position - right.position || stableItemId(left, right);
    }
    if (order.mode === "last_edited") {
      return (
        newestFirst(left.document.updatedAt, right.document.updatedAt) ||
        stableItemId(left, right)
      );
    }
    if (order.mode === "created") {
      return (
        newestFirst(left.document.createdAt, right.document.createdAt) ||
        stableItemId(left, right)
      );
    }
    return (
      (left.document.title || "").localeCompare(right.document.title || "") ||
      stableItemId(left, right)
    );
  });
}

function applyPersonalSidebarViewOverrides(
  savedViewConfig: ContentDatabaseViewConfig,
  overrides: ContentDatabasePersonalViewOverrides | null | undefined,
) {
  const saved = normalizeClientDatabaseViewConfig(savedViewConfig);
  if (!overrides) return saved;
  const overridesByViewId = new Map(
    overrides.views.map((view) => [view.id, view]),
  );
  return normalizeClientDatabaseViewConfig({
    ...saved,
    activeViewId: saved.views.some((view) => view.id === overrides.activeViewId)
      ? overrides.activeViewId
      : saved.activeViewId,
    views: saved.views.map((view) => {
      const override = overridesByViewId.get(view.id);
      return override
        ? {
            ...view,
            sorts: override.sorts,
            filters: override.filters,
            filterMode: override.filterMode,
          }
        : view;
    }),
  });
}

export function ContentFilesSidebarView({
  data,
  overrides,
  isLoading,
  activeDocumentId,
  labels,
  onSelectView,
  sidebarOrder,
  manualReorder,
  onOpenItem,
  onCreateChildPage,
  onCreateChildDatabase,
  onDeleteItem,
  onToggleFavorite,
  expandedDocumentIds,
  onDocumentExpandedChange,
  renderItem,
  scroll = true,
}: {
  data: ContentDatabaseResponse | undefined;
  overrides: ContentDatabasePersonalViewOverrides | null | undefined;
  isLoading: boolean;
  activeDocumentId?: string | null;
  onSelectView?: (viewId: string) => void;
  /** A parent-owned, user-scoped Files order. It never writes database membership. */
  sidebarOrder?: ContentSidebarViewOrder;
  manualReorder?: ContentFilesSidebarManualReorder;
  onOpenItem?: (item: ContentDatabaseItem) => boolean;
  onCreateChildPage?: (item: ContentDatabaseItem) => void;
  onCreateChildDatabase?: (item: ContentDatabaseItem) => void;
  onDeleteItem?: (item: ContentDatabaseItem) => void;
  onToggleFavorite?: (item: ContentDatabaseItem) => void;
  expandedDocumentIds?: ReadonlySet<string>;
  onDocumentExpandedChange?: (documentId: string, expanded: boolean) => void;
  renderItem?: (
    item: ContentDatabaseItem,
    reorder?: ContentFilesSidebarRenderReorder,
  ) => ReactNode;
  scroll?: boolean;
  labels: Omit<
    Parameters<typeof DatabaseSidebarView>[0],
    | "groups"
    | "grouped"
    | "isLoading"
    | "hasActiveConstraints"
    | "openPagesIn"
    | "onClearResultConstraints"
    | "onPreview"
    | "renderItem"
    | "scroll"
  >;
}) {
  const usableData =
    data?.database &&
    Array.isArray(data.items) &&
    Array.isArray(data.properties)
      ? data
      : undefined;
  const viewConfig = applyPersonalSidebarViewOverrides(
    usableData?.database.viewConfig ?? defaultDatabaseViewConfig(),
    overrides,
  );
  const [selectedViewId, setSelectedViewId] = useState(
    () => viewConfig.activeViewId,
  );
  useEffect(() => {
    setSelectedViewId(viewConfig.activeViewId);
  }, [viewConfig.activeViewId]);
  const activeView =
    viewConfig.views.find((view) => view.id === selectedViewId) ??
    activeDatabaseView(viewConfig);
  const [constraintsCleared, setConstraintsCleared] = useState(false);
  const activeFilterKey = JSON.stringify(activeView.filters);
  useEffect(() => {
    setConstraintsCleared(false);
  }, [activeFilterKey, activeView.id]);
  const filteredItems = usableData
    ? applyDatabaseView(
        usableData.items,
        usableData.properties,
        "",
        constraintsCleared ? [] : activeView.filters,
        sidebarOrder ? [] : activeView.sorts,
        activeView.filterMode ?? "and",
      )
    : [];
  const items = sidebarOrder
    ? contentSidebarOrderedItems(filteredItems, sidebarOrder)
    : filteredItems;
  const groups = databaseVisibleGroups(
    databaseViewItemGroups(
      items,
      usableData?.properties ?? [],
      activeView.groupByPropertyId,
    ),
    activeView.hideEmptyGroups === true,
  );
  const hasFilesHierarchy = usableData?.properties.some(
    (property) => property.definition.systemRole === "files_parent",
  );
  const hierarchyItems = hasFilesHierarchy ? items : undefined;
  const hierarchyUniverseItems = hasFilesHierarchy
    ? usableData?.items
    : undefined;
  const manualReorderEnabled =
    Boolean(manualReorder) &&
    (sidebarOrder?.mode ?? "custom") === "custom" &&
    activeView.sorts.length === 0 &&
    activeView.filters.length === 0 &&
    !databaseViewGroupingProperty(activeView, usableData?.properties ?? []);
  return (
    <div className="min-w-0">
      {viewConfig.views.length > 1 && (
        <div className="flex min-w-0 gap-1 overflow-x-auto px-1 pb-1">
          {viewConfig.views.map((view) => (
            <button
              key={view.id}
              type="button"
              className={cn(
                "shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
                activeView.id === view.id &&
                  "bg-muted font-medium text-foreground",
              )}
              onClick={() => {
                setSelectedViewId(view.id);
                onSelectView?.(view.id);
              }}
            >
              {view.name}
            </button>
          ))}
        </div>
      )}
      <DatabaseSidebarView
        {...labels}
        groups={groups}
        grouped={
          !!databaseViewGroupingProperty(
            activeView,
            usableData?.properties ?? [],
          )
        }
        isLoading={isLoading}
        hasActiveConstraints={
          !constraintsCleared && activeView.filters.length > 0
        }
        openPagesIn="full_page"
        onClearResultConstraints={() => setConstraintsCleared(true)}
        onPreview={() => {}}
        onOpenItem={onOpenItem}
        activeDocumentId={activeDocumentId}
        onCreateChildPage={onCreateChildPage}
        onCreateChildDatabase={onCreateChildDatabase}
        onDeleteItem={onDeleteItem}
        onToggleFavorite={onToggleFavorite}
        expandedDocumentIds={expandedDocumentIds}
        onDocumentExpandedChange={onDocumentExpandedChange}
        renderItem={renderItem}
        hierarchyItems={hierarchyItems}
        hierarchyUniverseItems={hierarchyUniverseItems}
        manualReorder={manualReorderEnabled ? manualReorder : undefined}
        scroll={scroll}
      />
    </div>
  );
}

export function DatabaseSidebarView({
  groups,
  grouped,
  isLoading,
  hasActiveConstraints,
  openPagesIn,
  onClearResultConstraints,
  onPreview,
  onOpenItem,
  activeDocumentId,
  onCreateChildPage,
  onCreateChildDatabase,
  onDeleteItem,
  onToggleFavorite,
  expandedDocumentIds,
  onDocumentExpandedChange,
  renderItem,
  hierarchyItems,
  hierarchyUniverseItems,
  manualReorder,
  scroll = true,
  noMatchesLabel,
  clearLabel,
  navigationLabel,
  untitledLabel,
}: {
  groups: DatabaseBoardGroup[];
  grouped: boolean;
  isLoading: boolean;
  hasActiveConstraints: boolean;
  openPagesIn: ContentDatabaseOpenPagesIn;
  onClearResultConstraints: () => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onOpenItem?: (item: ContentDatabaseItem) => boolean;
  activeDocumentId?: string | null;
  onCreateChildPage?: (item: ContentDatabaseItem) => void;
  onCreateChildDatabase?: (item: ContentDatabaseItem) => void;
  onDeleteItem?: (item: ContentDatabaseItem) => void;
  onToggleFavorite?: (item: ContentDatabaseItem) => void;
  expandedDocumentIds?: ReadonlySet<string>;
  onDocumentExpandedChange?: (documentId: string, expanded: boolean) => void;
  renderItem?: (
    item: ContentDatabaseItem,
    reorder?: ContentFilesSidebarRenderReorder,
  ) => ReactNode;
  hierarchyItems?: ContentDatabaseItem[];
  hierarchyUniverseItems?: ContentDatabaseItem[];
  manualReorder?: ContentFilesSidebarManualReorder;
  scroll?: boolean;
  noMatchesLabel: string;
  clearLabel: string;
  navigationLabel: string;
  untitledLabel: string;
}) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [localExpandedDocumentIds, setLocalExpandedDocumentIds] = useState<
    Set<string>
  >(() => new Set());
  const items = groups.flatMap((group) => group.items);
  const itemTree =
    !grouped && hierarchyItems
      ? databaseSidebarItemTree(
          databaseSidebarRootItems(
            items,
            hierarchyUniverseItems ?? hierarchyItems,
          ),
          hierarchyItems,
        )
      : null;

  function setGroupOpen(groupId: string, open: boolean) {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (open) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function setDocumentOpen(documentId: string, open: boolean) {
    if (onDocumentExpandedChange) {
      onDocumentExpandedChange(documentId, open);
      return;
    }
    setLocalExpandedDocumentIds((current) => {
      const next = new Set(current);
      if (open) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  }

  function renderTreeNode(node: DatabaseSidebarItemTreeNode, depth: number) {
    const open = (expandedDocumentIds ?? localExpandedDocumentIds).has(
      node.item.document.id,
    );
    return (
      <div key={node.item.id} className="min-w-0">
        <SidebarDatabaseRow
          item={node.item}
          openPagesIn={openPagesIn}
          onPreview={onPreview}
          onOpenItem={onOpenItem}
          active={node.item.document.id === activeDocumentId}
          onCreateChildPage={onCreateChildPage}
          onCreateChildDatabase={onCreateChildDatabase}
          onDeleteItem={onDeleteItem}
          onToggleFavorite={onToggleFavorite}
          untitledLabel={untitledLabel}
          depth={depth}
          hasChildren={node.children.length > 0}
          expanded={open}
          onToggleExpanded={(nextOpen) =>
            setDocumentOpen(node.item.document.id, nextOpen)
          }
          manualReorder={manualReorder}
        />
        {open && node.children.length > 0 ? (
          <div>
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div aria-hidden="true" className="grid gap-1 p-1">
        {[70, 55, 85, 60, 45].map((width, index) => (
          <div
            key={`sidebar-skeleton-${index}`}
            className="flex h-7 items-center gap-1.5 rounded px-1.5"
          >
            <Skeleton className="size-3.5 shrink-0 rounded-sm bg-sidebar-foreground/12 dark:bg-sidebar-foreground/10" />
            <Skeleton
              className="h-3 rounded bg-sidebar-foreground/12 dark:bg-sidebar-foreground/10"
              style={{ width: `${width}%` }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0 && hasActiveConstraints) {
    return (
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-2 px-2 py-3 text-sm text-muted-foreground">
        <span>{noMatchesLabel}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClearResultConstraints}
        >
          {clearLabel}
        </Button>
      </div>
    );
  }

  const navigation = (
    <nav
      aria-label={navigationLabel}
      className="grid min-w-0 gap-1 overflow-x-hidden py-1 ps-1"
    >
      {grouped
        ? groups.map((group) => {
            const open = !collapsedGroupIds.has(group.id);
            return (
              <Collapsible
                key={group.id}
                open={open}
                onOpenChange={(nextOpen) => setGroupOpen(group.id, nextOpen)}
              >
                <CollapsibleTrigger className="group flex h-7 w-full items-center gap-1 rounded px-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {open ? (
                    <IconChevronDown className="size-3.5 shrink-0" />
                  ) : (
                    <IconChevronRight className="size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <span className="text-[11px] font-normal text-muted-foreground/75">
                    {group.items.length}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="grid gap-0.5 pl-2">
                  {group.items.map((item) =>
                    renderItem ? (
                      <SidebarRenderedItem
                        key={item.id}
                        item={item}
                        renderItem={renderItem}
                        manualReorder={manualReorder}
                      />
                    ) : (
                      <SidebarDatabaseRow
                        key={item.id}
                        item={item}
                        openPagesIn={openPagesIn}
                        onPreview={onPreview}
                        onOpenItem={onOpenItem}
                        active={item.document.id === activeDocumentId}
                        onCreateChildPage={onCreateChildPage}
                        onCreateChildDatabase={onCreateChildDatabase}
                        onDeleteItem={onDeleteItem}
                        onToggleFavorite={onToggleFavorite}
                        untitledLabel={untitledLabel}
                        manualReorder={manualReorder}
                      />
                    ),
                  )}
                </CollapsibleContent>
              </Collapsible>
            );
          })
        : itemTree
          ? itemTree.map((node) => renderTreeNode(node, 0))
          : items.map((item) =>
              renderItem ? (
                <SidebarRenderedItem
                  key={item.id}
                  item={item}
                  renderItem={renderItem}
                  manualReorder={manualReorder}
                />
              ) : (
                <SidebarDatabaseRow
                  key={item.id}
                  item={item}
                  openPagesIn={openPagesIn}
                  onPreview={onPreview}
                  onOpenItem={onOpenItem}
                  active={item.document.id === activeDocumentId}
                  onCreateChildPage={onCreateChildPage}
                  onCreateChildDatabase={onCreateChildDatabase}
                  onDeleteItem={onDeleteItem}
                  onToggleFavorite={onToggleFavorite}
                  untitledLabel={untitledLabel}
                  manualReorder={manualReorder}
                />
              ),
            )}
    </nav>
  );
  const reorderItems = databaseSidebarReorderItems(
    hierarchyItems ?? items,
    untitledLabel,
    Boolean(hierarchyItems),
  );
  const reorderableNavigation = manualReorder ? (
    <SidebarReorderProvider
      items={reorderItems}
      labels={manualReorder.labels}
      onReorder={manualReorder.onReorder}
    >
      {navigation}
    </SidebarReorderProvider>
  ) : (
    navigation
  );
  return scroll ? (
    <ScrollArea className="max-h-[32rem] w-full">
      {reorderableNavigation}
    </ScrollArea>
  ) : (
    reorderableNavigation
  );
}

function SidebarRenderedItem({
  item,
  renderItem,
  manualReorder,
}: {
  item: ContentDatabaseItem;
  renderItem: (
    item: ContentDatabaseItem,
    reorder?: ContentFilesSidebarRenderReorder,
  ) => ReactNode;
  manualReorder?: ContentFilesSidebarManualReorder;
}) {
  return manualReorder ? (
    <ReorderableRenderedSidebarItem
      item={item}
      renderItem={renderItem}
      labels={manualReorder.labels}
    />
  ) : (
    <div className="min-w-0">{renderItem(item)}</div>
  );
}

function ReorderableRenderedSidebarItem({
  item,
  renderItem,
  labels,
}: {
  item: ContentDatabaseItem;
  renderItem: (
    item: ContentDatabaseItem,
    reorder?: ContentFilesSidebarRenderReorder,
  ) => ReactNode;
  labels: SidebarReorderLabels;
}) {
  const controls = useSidebarReorderItem(item.id);
  return (
    <div
      ref={controls.setNodeRef}
      style={controls.style}
      className="relative min-w-0"
    >
      <SidebarDropIndicator placement={controls.dropIndicator} />
      {renderItem(item, { controls, labels })}
    </div>
  );
}

function SidebarDatabaseRow({
  manualReorder,
  ...props
}: Parameters<typeof DatabaseSidebarRow>[0] & {
  manualReorder?: ContentFilesSidebarManualReorder;
}) {
  return manualReorder ? (
    <ReorderableDatabaseSidebarRow
      {...props}
      reorderLabels={manualReorder.labels}
    />
  ) : (
    <DatabaseSidebarRow {...props} />
  );
}

function ReorderableDatabaseSidebarRow({
  reorderLabels,
  ...props
}: Parameters<typeof DatabaseSidebarRow>[0] & {
  reorderLabels: SidebarReorderLabels;
}) {
  const reorder = useSidebarReorderItem(props.item.id);
  return (
    <div ref={reorder.setNodeRef} style={reorder.style} className="relative">
      <SidebarDropIndicator placement={reorder.dropIndicator} />
      <DatabaseSidebarRow
        {...props}
        reorder={{ controls: reorder, labels: reorderLabels }}
      />
    </div>
  );
}

function DatabaseSidebarRow({
  item,
  openPagesIn,
  onPreview,
  onOpenItem,
  active,
  onCreateChildPage,
  onCreateChildDatabase,
  onDeleteItem,
  onToggleFavorite,
  untitledLabel,
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpanded,
  reorder,
}: {
  item: ContentDatabaseItem;
  openPagesIn: ContentDatabaseOpenPagesIn;
  onPreview: (item: ContentDatabaseItem) => void;
  onOpenItem?: (item: ContentDatabaseItem) => boolean;
  active: boolean;
  onCreateChildPage?: (item: ContentDatabaseItem) => void;
  onCreateChildDatabase?: (item: ContentDatabaseItem) => void;
  onDeleteItem?: (item: ContentDatabaseItem) => void;
  onToggleFavorite?: (item: ContentDatabaseItem) => void;
  untitledLabel: string;
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpanded?: (open: boolean) => void;
  reorder?: {
    controls: ReturnType<typeof useSidebarReorderItem>;
    labels: SidebarReorderLabels;
  };
}) {
  const t = useT();
  const { canEdit, canManage, canFavorite, hasMenuActions } =
    documentSidebarActionAvailability(item.document, {
      favoriteAvailable: Boolean(onToggleFavorite),
      manageAvailable: Boolean(onDeleteItem),
    });
  const canCreateChild = canEdit && Boolean(onCreateChildPage);
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    if (onOpenItem?.(item)) {
      event.preventDefault();
      return;
    }
    if (openPagesIn !== "preview") return;
    event.preventDefault();
    onPreview(item);
  }

  const title = item.document.title || untitledLabel;

  return (
    <>
      <div className="group relative min-w-0">
        {hasChildren ? (
          <button
            type="button"
            className="pointer-events-none absolute top-0 z-10 flex size-7 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              insetInlineStart: `${databaseSidebarRowIndent(depth, hasChildren)}px`,
            }}
            aria-label={`${expanded ? t("sidebar.collapse") : t("sidebar.expand")} ${title}`}
            aria-expanded={expanded}
            onPointerUp={(event) => event.currentTarget.blur()}
            onClick={() => onToggleExpanded?.(!expanded)}
          >
            <IconChevronRight
              className={cn(
                "size-3.5 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : null}
        <Link
          to={`/page/${item.document.id}`}
          {...reorder?.controls.attributes}
          {...reorder?.controls.listeners}
          data-sidebar-reorder-item-id={reorder?.controls.itemId}
          role="link"
          className={cn(
            "flex h-7 min-w-0 items-center gap-1.5 rounded pe-1.5 text-sm text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            reorder && "touch-none cursor-pointer select-none",
            reorder?.controls.isDragging && "cursor-grabbing",
            active && "font-semibold text-foreground",
          )}
          style={{
            paddingInlineStart: `${databaseSidebarRowIndent(depth, hasChildren)}px`,
          }}
          onClick={handleClick}
          onPointerUp={(event) => event.currentTarget.blur()}
          aria-current={active ? "page" : undefined}
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center",
              hasChildren &&
                "group-hover:opacity-0 group-focus-within:opacity-0",
            )}
            aria-hidden="true"
          >
            {item.document.icon ? (
              <span className="text-sm leading-none">{item.document.icon}</span>
            ) : (
              <IconFileText className="size-3.5 text-muted-foreground" />
            )}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              (hasMenuActions || canCreateChild) &&
                "group-hover:pe-12 group-focus-within:pe-12",
            )}
          >
            {title}
          </span>
        </Link>

        {(hasMenuActions || canCreateChild) && (
          <div className="pointer-events-none absolute end-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded bg-sidebar px-0.5 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            {hasMenuActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex size-6 items-center justify-center rounded text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("sidebar.moreActionsFor", { label: title })}
                  >
                    <IconDots size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {canFavorite && onToggleFavorite ? (
                    <DropdownMenuItem onSelect={() => onToggleFavorite(item)}>
                      <IconStar
                        className={cn(
                          "me-2 size-4",
                          item.document.isFavorite && "fill-current",
                        )}
                      />
                      {item.document.isFavorite
                        ? t("sidebar.unpinFromSidebar")
                        : t("sidebar.pinToSidebar")}
                    </DropdownMenuItem>
                  ) : null}
                  {canFavorite &&
                  onToggleFavorite &&
                  canManage &&
                  onDeleteItem ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {canManage && onDeleteItem ? (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onDeleteItem(item)}
                    >
                      <IconTrash className="me-2 size-4" />
                      {t("database.delete")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canCreateChild ? (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex size-6 items-center justify-center rounded text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("sidebar.addChildTo", { title })}
                        data-sidebar-add-child
                      >
                        <IconPlus size={14} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t("sidebar.addChild")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuItem onSelect={() => onCreateChildPage?.(item)}>
                    <IconFileText className="me-2 size-4" />
                    {t("sidebar.page")}
                  </DropdownMenuItem>
                  {onCreateChildDatabase ? (
                    <DropdownMenuItem
                      onSelect={() => onCreateChildDatabase(item)}
                    >
                      <IconDatabase className="me-2 size-4" />
                      {t("sidebar.database")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                type="button"
                className="flex size-6 cursor-not-allowed items-center justify-center rounded text-muted-foreground/50"
                aria-label={t("sidebar.addChildTo", { title })}
                data-sidebar-add-child
                disabled
              >
                <IconPlus size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function databaseSidebarRows(groups: DatabaseBoardGroup[]) {
  return groups.flatMap((group) => group.items);
}

export interface DatabaseSidebarItemTreeNode {
  item: ContentDatabaseItem;
  children: DatabaseSidebarItemTreeNode[];
}

export function databaseSidebarRootItems(
  visibleItems: ContentDatabaseItem[],
  allItems: ContentDatabaseItem[],
) {
  const documentIds = new Set(allItems.map((item) => item.document.id));
  return visibleItems.filter((item) => {
    const parentId = item.document.parentId;
    if (!parentId) return true;
    return !documentIds.has(parentId);
  });
}

export function databaseSidebarRowIndent(depth: number, _hasChildren: boolean) {
  return depth * 18;
}

export function databaseSidebarItemTree(
  rootItems: ContentDatabaseItem[],
  allItems: ContentDatabaseItem[],
): DatabaseSidebarItemTreeNode[] {
  const childrenByParentId = new Map<string, ContentDatabaseItem[]>();
  for (const item of allItems) {
    const parentId = item.document.parentId;
    if (!parentId) continue;
    childrenByParentId.set(parentId, [
      ...(childrenByParentId.get(parentId) ?? []),
      item,
    ]);
  }
  const emitted = new Set<string>();
  const visit = (
    item: ContentDatabaseItem,
    ancestors: Set<string>,
  ): DatabaseSidebarItemTreeNode | null => {
    const documentId = item.document.id;
    if (emitted.has(documentId) || ancestors.has(documentId)) return null;
    emitted.add(documentId);
    const nextAncestors = new Set(ancestors).add(documentId);
    return {
      item,
      children: (childrenByParentId.get(documentId) ?? []).flatMap((child) => {
        const node = visit(child, nextAncestors);
        return node ? [node] : [];
      }),
    };
  };
  return rootItems.flatMap((item) => {
    const node = visit(item, new Set());
    return node ? [node] : [];
  });
}
