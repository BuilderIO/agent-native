import { appPath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  contentRecentHref,
  contentRecentTargetKey,
  defaultContentSidebarSections,
  type ContentRecentResult,
  type ContentSidebarSections,
  type ContentSidebarSectionId,
} from "@shared/content-personal-navigation";
import {
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconDots,
  IconFiles,
  IconPin,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  setCachedRecentPinnedState,
  useContentRecent,
  useRemoveContentRecent,
} from "@/hooks/use-content-recent";
import { cn } from "@/lib/utils";

import { contentSpaceActionArgs } from "./select-content-space";
import {
  SidebarReorderProvider,
  useSidebarReorderItem,
  type SidebarReorderLabels,
} from "./sidebar-reorder";
import {
  SidebarNavigationRow,
  sidebarShowMoreClassName,
} from "./SidebarNavigationRow";
import {
  SidebarPageMenu,
  SidebarRowActions,
  sidebarPageLinks,
  sidebarRowTitleFadeClassName,
} from "./SidebarRowActions";

function RecentSidebarRow({
  entry,
  active,
  onNavigate,
  onToggleFavorite,
  onRemove,
}: {
  entry: ContentRecentResult;
  active: boolean;
  onNavigate?: () => void;
  onToggleFavorite?: (documentId: string, isFavorite: boolean) => void;
  onRemove: (target: ContentRecentResult["target"]) => void;
}) {
  const t = useT();
  const title = entry.title || t("sidebar.untitled");
  const pinned = entry.isFavorite;
  return (
    <div className="group relative min-w-0">
      <SidebarNavigationRow
        to={contentRecentHref(entry.target)}
        icon={entry.icon}
        active={active}
        onClick={onNavigate}
        title={entry.viewName ? `${title} · ${entry.viewName}` : title}
        className={cn(!active && "group-hover:bg-sidebar-accent/60")}
      >
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5",
            sidebarRowTitleFadeClassName(1),
          )}
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {entry.viewName && (
            <span className="truncate text-muted-foreground">
              {entry.viewName}
            </span>
          )}
        </span>
      </SidebarNavigationRow>
      <SidebarRowActions>
        <SidebarPageMenu
          documentId={entry.target.documentId}
          title={title}
          href={appPath(contentRecentHref(entry.target))}
          shareLink={
            sidebarPageLinks(entry.target.documentId, {
              localFile:
                entry.target.documentId.startsWith("local-file:") ||
                entry.target.documentId.startsWith("local-folder:"),
            }).shareLink
          }
          pinned={pinned}
          onTogglePin={
            onToggleFavorite && pinned !== undefined
              ? () => onToggleFavorite(entry.target.documentId, !pinned)
              : undefined
          }
          onRemoveFromRecent={() => onRemove(entry.target)}
        />
      </SidebarRowActions>
    </div>
  );
}

export function PersonalSidebarSections({
  renderPinned,
  pinnedCount,
  renderFiles,
  spaceId,
  activeDocumentId,
  onNavigate,
  onToggleFavorite,
  reorderLabels,
  seeAllHrefs,
}: {
  renderPinned: (limit: number) => ReactNode;
  pinnedCount: number;
  renderFiles: () => ReactNode;
  spaceId: string;
  activeDocumentId?: string | null;
  onNavigate?: () => void;
  onToggleFavorite?: (documentId: string, isFavorite: boolean) => void;
  reorderLabels: SidebarReorderLabels;
  seeAllHrefs: Record<ContentSidebarSectionId, string>;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const stateArgs = contentSpaceActionArgs(spaceId);
  const state = useActionQuery("get-content-sidebar-state", stateArgs);
  const recent = useContentRecent(spaceId);
  const removeRecent = useRemoveContentRecent();
  const update = useActionMutation("update-content-sidebar-state", {
    skipActionQueryInvalidation: true,
  });
  const [optimisticBySpace, setOptimisticBySpace] = useState(
    () => new Map<string, ContentSidebarSections>(),
  );
  const pendingBySpace = useRef(new Map<string, number>());
  const queueBySpace = useRef(new Map<string, Promise<unknown>>());
  const [limits, setLimits] = useState({ pinned: 5, recent: 5 });
  useEffect(() => setLimits({ pinned: 5, recent: 5 }), [spaceId]);
  const sections =
    optimisticBySpace.get(spaceId) ??
    state.data?.state?.sections ??
    defaultContentSidebarSections();
  function save(next: ContentSidebarSections) {
    const targetSpaceId = spaceId;
    const targetStateKey = [
      "action",
      "get-content-sidebar-state",
      contentSpaceActionArgs(targetSpaceId),
    ];
    setOptimisticBySpace((current) => {
      const updated = new Map(current);
      updated.set(targetSpaceId, next);
      return updated;
    });
    pendingBySpace.current.set(
      targetSpaceId,
      (pendingBySpace.current.get(targetSpaceId) ?? 0) + 1,
    );
    const queued = (
      queueBySpace.current.get(targetSpaceId) ?? Promise.resolve()
    )
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await update.mutateAsync({
            version: 2,
            spaceId: targetSpaceId,
            sections: next,
          });
          queryClient.setQueryData(targetStateKey, saved);
        } catch (error) {
          toast.error(t("sidebar.failedSaveSidebarState"));
          throw error;
        } finally {
          const pending = (pendingBySpace.current.get(targetSpaceId) ?? 1) - 1;
          if (pending > 0) {
            pendingBySpace.current.set(targetSpaceId, pending);
          } else {
            pendingBySpace.current.delete(targetSpaceId);
            setOptimisticBySpace((current) => {
              const updated = new Map(current);
              updated.delete(targetSpaceId);
              return updated;
            });
          }
        }
      });
    queueBySpace.current.set(targetSpaceId, queued);
    void queued.catch(() => undefined);
  }
  function change(
    id: ContentSidebarSectionId,
    patch: Partial<ContentSidebarSections["pinned"]>,
  ) {
    save({ ...sections, [id]: { ...sections[id], ...patch } });
  }
  const labels = {
    pinned: t("sidebar.pinned"),
    recent: t("sidebar.recent"),
    files: t("sidebar.files"),
  };
  function canShowMore(id: "pinned" | "recent") {
    const count =
      id === "pinned" ? pinnedCount : (recent.data?.entries.length ?? 0);
    if (limits[id] >= 50) return false;
    return count > limits[id];
  }
  if (state.isError)
    return (
      <>
        <QueryErrorState compact onRetry={() => void state.refetch()} />
        {renderFiles()}
      </>
    );
  if (state.isLoading)
    return (
      <>
        <Skeleton className="mx-3 my-2 h-7" />
        {renderFiles()}
      </>
    );
  return (
    <>
      <SidebarReorderProvider
        items={sections.order.map((id) => ({
          id,
          label: labels[id],
          parentId: null,
        }))}
        labels={reorderLabels}
        onReorder={(ids) =>
          save({ ...sections, order: ids as ContentSidebarSectionId[] })
        }
      >
        {sections.order.map((id) =>
          id === "files" ? (
            <PersonalSection
              key={id}
              id={id}
              label={labels[id]}
              expanded={sections.files.expanded}
              onToggle={() =>
                change("files", { expanded: !sections.files.expanded })
              }
              reorderLabels={reorderLabels}
              seeAllHref={seeAllHrefs[id]}
              sections={sections}
              labels={labels}
              onChangeVisible={(sectionId, visible) =>
                change(sectionId, { visible })
              }
            >
              {sections.files.expanded ? renderFiles() : null}
            </PersonalSection>
          ) : sections[id].visible ? (
            <PersonalSection
              key={id}
              id={id}
              label={labels[id]}
              expanded={sections[id].expanded}
              onToggle={() => {
                if (sections[id].expanded) {
                  setLimits((current) => ({ ...current, [id]: 5 }));
                }
                change(id, { expanded: !sections[id].expanded });
              }}
              reorderLabels={reorderLabels}
              seeAllHref={seeAllHrefs[id]}
              sections={sections}
              labels={labels}
              onChangeVisible={(sectionId, visible) =>
                change(sectionId, { visible })
              }
            >
              {sections[id].expanded && (
                <>
                  {id === "pinned" ? (
                    renderPinned(limits.pinned)
                  ) : recent.isError ? (
                    <QueryErrorState
                      compact
                      onRetry={() => void recent.refetch()}
                      retrying={recent.isFetching}
                    />
                  ) : recent.isLoading ? (
                    <Skeleton className="mx-2 h-20" />
                  ) : recent.data?.entries.length ? (
                    <nav
                      aria-label={labels.recent}
                      className="grid min-w-0 gap-0.5 overflow-x-hidden py-1 ps-1"
                    >
                      {recent.data.entries
                        .slice(0, limits.recent)
                        .map((entry) => (
                          <RecentSidebarRow
                            key={contentRecentTargetKey(entry.target)}
                            entry={entry}
                            active={
                              !!activeDocumentId &&
                              entry.target.documentId === activeDocumentId
                            }
                            onNavigate={onNavigate}
                            onToggleFavorite={
                              onToggleFavorite
                                ? (documentId, isFavorite) => {
                                    setCachedRecentPinnedState(
                                      queryClient,
                                      documentId,
                                      isFavorite,
                                    );
                                    onToggleFavorite(documentId, isFavorite);
                                  }
                                : undefined
                            }
                            onRemove={removeRecent}
                          />
                        ))}
                    </nav>
                  ) : (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {t("sidebar.noRecentVisits")}
                    </p>
                  )}
                  {canShowMore(id) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        sidebarShowMoreClassName,
                        "grid-cols-[0.25rem_1.75rem_minmax(0,1fr)]",
                      )}
                      onClick={() =>
                        setLimits((current) => ({
                          ...current,
                          [id]: Math.min(50, current[id] + 5),
                        }))
                      }
                    >
                      <IconChevronDown
                        aria-hidden="true"
                        className="col-start-2 size-3.5 justify-self-center"
                      />
                      <span className="min-w-0 truncate ps-1.5">
                        {t("sidebar.showMore")}
                      </span>
                    </Button>
                  ) : limits[id] > 5 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        sidebarShowMoreClassName,
                        "grid-cols-[0.25rem_1.75rem_minmax(0,1fr)]",
                      )}
                      onClick={() =>
                        setLimits((current) => ({ ...current, [id]: 5 }))
                      }
                    >
                      <IconChevronDown
                        aria-hidden="true"
                        className="col-start-2 size-3.5 rotate-180 justify-self-center"
                      />
                      <span className="min-w-0 truncate ps-1.5">
                        {t("sidebar.showLess")}
                      </span>
                    </Button>
                  ) : null}
                </>
              )}
            </PersonalSection>
          ) : null,
        )}
      </SidebarReorderProvider>
    </>
  );
}

function PersonalSection({
  id,
  label,
  expanded,
  onToggle,
  reorderLabels,
  seeAllHref,
  sections,
  labels,
  onChangeVisible,
  children,
}: {
  id: ContentSidebarSectionId;
  label: string;
  expanded?: boolean;
  onToggle?: () => void;
  reorderLabels: SidebarReorderLabels;
  seeAllHref: string;
  sections: ContentSidebarSections;
  labels: Record<ContentSidebarSectionId, string>;
  onChangeVisible: (id: "pinned" | "recent", visible: boolean) => void;
  children: ReactNode;
}) {
  const t = useT();
  const reorder = useSidebarReorderItem(id);
  const pointerDragListener = (
    reorder.listeners as typeof reorder.listeners & {
      onPointerDown?: PointerEventHandler<HTMLButtonElement>;
    }
  )?.onPointerDown;
  const SectionIcon =
    id === "pinned" ? IconPin : id === "recent" ? IconClock : IconFiles;
  return (
    <section
      ref={reorder.setNodeRef}
      style={reorder.style}
      data-sidebar-reorder-item-id={reorder.itemId}
      className="mb-4 min-w-0 px-2"
    >
      <div className="group/section-header grid h-7 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
        {onToggle && (
          <button
            type="button"
            aria-label={label}
            aria-expanded={expanded}
            {...reorder.attributes}
            onPointerDown={pointerDragListener}
            onClick={onToggle}
            className={cn(
              "group/toggle grid min-w-0 touch-none select-none grid-cols-[1.75rem_minmax(0,1fr)] items-center rounded text-start text-xs font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              reorder.isDragging && "cursor-grabbing",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center">
              <span className="relative size-3.5">
                <SectionIcon className="absolute inset-0 size-3.5 transition-opacity group-hover/toggle:opacity-0 group-focus-visible/toggle:opacity-0" />
                <IconChevronRight
                  className={cn(
                    "absolute inset-0 size-3.5 opacity-0 transition-[opacity,transform] group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100 rtl:-scale-x-100",
                    expanded && "rotate-90",
                  )}
                />
              </span>
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
        )}
        <div className="flex items-center gap-0.5">
          {/* The section menu stays quiet until the header is hovered or
              focused; devices without hover always show it. */}
          <div className="flex has-[[data-state=open]]:opacity-100 group-hover/section-header:opacity-100 group-focus-within/section-header:opacity-100 [@media(hover:hover)]:opacity-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                  aria-label={t("sidebar.customizeSidebar")}
                >
                  <IconDots className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={seeAllHref}>{t("sidebar.seeAll")}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={reorder.siblingIndex === 0}
                    onSelect={reorder.moveUp}
                  >
                    {reorderLabels.moveUp}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={
                      reorder.siblingIndex === reorder.siblings.length - 1
                    }
                    onSelect={reorder.moveDown}
                  >
                    {reorderLabels.moveDown}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {/* Every section menu carries the visibility toggles, so a hidden
                section stays restorable from the sections that remain. */}
                <DropdownMenuGroup>
                  {(["pinned", "recent"] as const).map((sectionId) => (
                    <DropdownMenuCheckboxItem
                      key={sectionId}
                      checked={sections[sectionId].visible}
                      onCheckedChange={(visible) =>
                        onChangeVisible(sectionId, visible)
                      }
                    >
                      {labels[sectionId]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}
