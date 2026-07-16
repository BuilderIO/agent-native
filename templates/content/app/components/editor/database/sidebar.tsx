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
  IconFileText,
  IconLoader2,
} from "@tabler/icons-react";
import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router";

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
  labels,
  onSelectView,
}: {
  data: ContentDatabaseResponse | undefined;
  overrides: ContentDatabasePersonalViewOverrides | null | undefined;
  isLoading: boolean;
  onSelectView?: (viewId: string) => void;
  labels: Omit<
    Parameters<typeof DatabaseSidebarView>[0],
    | "groups"
    | "grouped"
    | "isLoading"
    | "hasActiveConstraints"
    | "openPagesIn"
    | "onClearResultConstraints"
    | "onPreview"
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
  const items = data
    ? applyDatabaseView(
        data.items,
        data.properties,
        "",
        activeView.filters,
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
        hasActiveConstraints={false}
        openPagesIn="full_page"
        onClearResultConstraints={() => {}}
        onPreview={() => {}}
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

  return (
    <ScrollArea className="max-h-[32rem] w-full">
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
                    <span className="min-w-0 flex-1 truncate">
                      {group.label}
                    </span>
                    <span className="text-[11px] font-normal text-muted-foreground/75">
                      {group.items.length}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-0.5 pl-2">
                    {group.items.map((item) => (
                      <DatabaseSidebarRow
                        key={item.id}
                        item={item}
                        openPagesIn={openPagesIn}
                        onPreview={onPreview}
                        untitledLabel={untitledLabel}
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          : items.map((item) => (
              <DatabaseSidebarRow
                key={item.id}
                item={item}
                openPagesIn={openPagesIn}
                onPreview={onPreview}
                untitledLabel={untitledLabel}
              />
            ))}
      </nav>
    </ScrollArea>
  );
}

function DatabaseSidebarRow({
  item,
  openPagesIn,
  onPreview,
  untitledLabel,
}: {
  item: ContentDatabaseItem;
  openPagesIn: ContentDatabaseOpenPagesIn;
  onPreview: (item: ContentDatabaseItem) => void;
  untitledLabel: string;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      openPagesIn !== "preview" ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    onPreview(item);
  }

  return (
    <Link
      to={`/page/${item.document.id}`}
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 rounded px-1.5 text-sm text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        item.document.icon ? "pl-1" : "pl-1.5",
      )}
      onClick={handleClick}
    >
      {item.document.icon ? (
        <span aria-hidden="true" className="shrink-0 text-sm leading-none">
          {item.document.icon}
        </span>
      ) : (
        <IconFileText className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {item.document.title || untitledLabel}
      </span>
    </Link>
  );
}

export function databaseSidebarRows(groups: DatabaseBoardGroup[]) {
  return groups.flatMap((group) => group.items);
}
