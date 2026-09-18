import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  contentRecentHref,
  contentRecentTargetKey,
  defaultContentSidebarSections,
  type ContentSidebarSections,
  type ContentSidebarSectionId,
} from "@shared/content-personal-navigation";
import {
  IconChevronRight,
  IconClock,
  IconDots,
  IconFiles,
  IconGripVertical,
  IconPin,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { useContentRecent } from "@/hooks/use-content-recent";
import { cn } from "@/lib/utils";

import { contentSpaceActionArgs } from "./select-content-space";
import {
  SidebarReorderProvider,
  useSidebarReorderItem,
  type SidebarReorderLabels,
} from "./sidebar-reorder";
import { SidebarNavigationRow } from "./SidebarNavigationRow";

export function PersonalSidebarSections({
  renderPinned,
  pinnedCount,
  renderFiles,
  spaceId,
  onNavigate,
  reorderLabels,
}: {
  renderPinned: (limit: number) => ReactNode;
  pinnedCount: number;
  renderFiles: () => ReactNode;
  spaceId: string;
  onNavigate?: () => void;
  reorderLabels: SidebarReorderLabels;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const stateArgs = contentSpaceActionArgs(spaceId);
  const stateKey = ["action", "get-content-sidebar-state", stateArgs];
  const state = useActionQuery("get-content-sidebar-state", stateArgs);
  const recent = useContentRecent(spaceId);
  const update = useActionMutation("update-content-sidebar-state", {
    skipActionQueryInvalidation: true,
  });
  const [optimistic, setOptimistic] = useState<ContentSidebarSections | null>(
    null,
  );
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [limits, setLimits] = useState({ pinned: 5, recent: 5 });
  useEffect(() => setLimits({ pinned: 5, recent: 5 }), [spaceId]);
  const sections =
    optimistic ??
    state.data?.state?.sections ??
    defaultContentSidebarSections();
  function save(next: ContentSidebarSections) {
    setOptimistic(next);
    pending.current++;
    queue.current = queue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await update.mutateAsync({
            version: 2,
            spaceId,
            sections: next,
          });
          queryClient.setQueryData(stateKey, saved);
        } catch (error) {
          toast.error(t("sidebar.failedSaveSidebarState"));
          throw error;
        } finally {
          pending.current--;
          if (pending.current === 0) setOptimistic(null);
        }
      });
    // The error is displayed above; keep the queue usable for a later explicit change.
    void queue.current.catch(() => undefined);
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
                      className="grid min-w-0 gap-1 overflow-x-hidden py-1 ps-1"
                    >
                      {recent.data.entries
                        .slice(0, limits.recent)
                        .map((entry) => (
                          <SidebarNavigationRow
                            key={contentRecentTargetKey(entry.target)}
                            to={contentRecentHref(entry.target)}
                            icon={entry.icon}
                            onClick={onNavigate}
                            title={
                              entry.viewName
                                ? `${entry.title} · ${entry.viewName}`
                                : entry.title
                            }
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {entry.title || t("sidebar.untitled")}
                            </span>
                            {entry.viewName && (
                              <span className="truncate text-muted-foreground">
                                {entry.viewName}
                              </span>
                            )}
                          </SidebarNavigationRow>
                        ))}
                    </nav>
                  ) : (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {t("sidebar.noRecentVisits")}
                    </p>
                  )}
                  {canShowMore(id) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLimits((current) => ({
                          ...current,
                          [id]: Math.min(50, current[id] + 5),
                        }))
                      }
                    >
                      {t("sidebar.showMore")}
                    </Button>
                  )}
                  {limits[id] > 5 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLimits((current) => ({ ...current, [id]: 5 }))
                      }
                    >
                      {t("sidebar.showLess")}
                    </Button>
                  )}
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
  sections: ContentSidebarSections;
  labels: Record<ContentSidebarSectionId, string>;
  onChangeVisible: (id: "pinned" | "recent", visible: boolean) => void;
  children: ReactNode;
}) {
  const t = useT();
  const reorder = useSidebarReorderItem(id);
  const SectionIcon =
    id === "pinned" ? IconPin : id === "recent" ? IconClock : IconFiles;
  return (
    <section
      ref={reorder.setNodeRef}
      style={reorder.style}
      className="mb-2 min-w-0 px-2"
    >
      <div className="flex h-7 min-w-0 items-center gap-1">
        {onToggle && (
          <button
            type="button"
            aria-label={label}
            aria-expanded={expanded}
            onClick={onToggle}
            className="group/toggle flex min-w-0 flex-1 items-center rounded text-start text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
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
        <button
          type="button"
          {...reorder.attributes}
          {...reorder.listeners}
          aria-label={reorderLabels.drag(label)}
          className="flex size-7 shrink-0 touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconGripVertical className="size-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("sidebar.customizeSidebar")}
            >
              <IconDots className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={reorder.siblingIndex === 0}
                onSelect={reorder.moveUp}
              >
                {reorderLabels.moveUp}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={reorder.siblingIndex === reorder.siblings.length - 1}
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
      {children}
    </section>
  );
}
