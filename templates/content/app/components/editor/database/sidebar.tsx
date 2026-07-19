import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@agent-native/toolkit/ui/collapsible";
import { ScrollArea } from "@agent-native/toolkit/ui/scroll-area";
import type {
  ContentDatabaseItem,
  ContentDatabaseOpenPagesIn,
  ContentDatabasePersonalViewOverrides,
  ContentDatabaseResponse,
  ContentDatabaseViewConfig,
} from "@shared/api";
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconDots,
  IconFileText,
  IconLoader2,
  IconPlus,
  IconStar,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  onOpenItem,
  onCreateChildPage,
  onCreateChildDatabase,
  onDeleteItem,
  onToggleFavorite,
  renderItem,
  scroll = true,
}: {
  data: ContentDatabaseResponse | undefined;
  overrides: ContentDatabasePersonalViewOverrides | null | undefined;
  isLoading: boolean;
  activeDocumentId?: string | null;
  onSelectView?: (viewId: string) => void;
  onOpenItem?: (item: ContentDatabaseItem) => boolean;
  onCreateChildPage?: (item: ContentDatabaseItem) => void;
  onCreateChildDatabase?: (item: ContentDatabaseItem) => void;
  onDeleteItem?: (item: ContentDatabaseItem) => void;
  onToggleFavorite?: (item: ContentDatabaseItem) => void;
  renderItem?: (item: ContentDatabaseItem) => ReactNode;
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
  const viewConfig = applyPersonalSidebarViewOverrides(
    data?.database.viewConfig ?? defaultDatabaseViewConfig(),
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
  const items = data
    ? applyDatabaseView(
        data.items,
        data.properties,
        "",
        constraintsCleared ? [] : activeView.filters,
        activeView.sorts,
        activeView.filterMode ?? "and",
      )
    : [];
  const groups = databaseVisibleGroups(
    databaseViewItemGroups(
      items,
      data?.properties ?? [],
      activeView.groupByPropertyId,
    ),
    activeView.hideEmptyGroups === true,
  );
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
          !!databaseViewGroupingProperty(activeView, data?.properties ?? [])
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
        renderItem={renderItem}
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
  renderItem,
  scroll = true,
  loadingLabel,
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
  renderItem?: (item: ContentDatabaseItem) => ReactNode;
  scroll?: boolean;
  loadingLabel: string;
  noMatchesLabel: string;
  clearLabel: string;
  navigationLabel: string;
  untitledLabel: string;
}) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const items = groups.flatMap((group) => group.items);

  function setGroupOpen(groupId: string, open: boolean) {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (open) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
        <IconLoader2 className="size-4 animate-spin" />
        {loadingLabel}
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
    <nav aria-label={navigationLabel} className="grid gap-1 p-1">
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
                      <div key={item.id}>{renderItem(item)}</div>
                    ) : (
                      <DatabaseSidebarRow
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
                      />
                    ),
                  )}
                </CollapsibleContent>
              </Collapsible>
            );
          })
        : items.map((item) =>
            renderItem ? (
              <div key={item.id}>{renderItem(item)}</div>
            ) : (
              <DatabaseSidebarRow
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
              />
            ),
          )}
    </nav>
  );
  return scroll ? (
    <ScrollArea className="max-h-[32rem] w-full">{navigation}</ScrollArea>
  ) : (
    navigation
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
}) {
  const t = useT();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const canEdit = item.document.canEdit !== false;
  const canManage =
    item.document.canManage === true ||
    item.document.accessRole === "owner" ||
    item.document.accessRole === "admin";
  const canCreateChild = canEdit && Boolean(onCreateChildPage);
  const hasMenuActions =
    (canEdit && Boolean(onToggleFavorite)) ||
    (canManage && Boolean(onDeleteItem));
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
        <Link
          to={`/page/${item.document.id}`}
          className={cn(
            "flex h-7 min-w-0 items-center gap-1.5 rounded px-1.5 text-sm text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            item.document.icon ? "pl-1" : "pl-1.5",
          )}
          onClick={handleClick}
          aria-current={active ? "page" : undefined}
        >
          {item.document.icon ? (
            <span aria-hidden="true" className="shrink-0 text-sm leading-none">
              {item.document.icon}
            </span>
          ) : (
            <IconFileText className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              active && "font-semibold",
              (hasMenuActions || canCreateChild) && "pe-12",
            )}
          >
            {title}
          </span>
        </Link>

        {(hasMenuActions || canCreateChild) && (
          <div className="pointer-events-none absolute end-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded bg-sidebar px-0.5 opacity-0 shadow-sm group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            {hasMenuActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex size-6 items-center justify-center rounded text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`More actions for ${title}`}
                  >
                    <IconDots size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {canEdit && onToggleFavorite ? (
                    <DropdownMenuItem onSelect={() => onToggleFavorite(item)}>
                      <IconStar
                        className={cn(
                          "me-2 size-4",
                          item.document.isFavorite && "fill-current",
                        )}
                      />
                      {item.document.isFavorite
                        ? "Remove from favorites"
                        : "Add to favorites"}
                    </DropdownMenuItem>
                  ) : null}
                  {canEdit && onToggleFavorite && canManage && onDeleteItem ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {canManage && onDeleteItem ? (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleteDialogOpen(true)}
                    >
                      <IconTrash className="me-2 size-4" />
                      {t("database.delete")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canCreateChild && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex size-6 items-center justify-center rounded text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("sidebar.addChildTo", { title })}
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
            )}
          </div>
        )}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sidebar.deletePageQuestion")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.deletePageDescription", { title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("comments.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onDeleteItem?.(item)}
            >
              {t("database.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function databaseSidebarRows(groups: DatabaseBoardGroup[]) {
  return groups.flatMap((group) => group.items);
}
