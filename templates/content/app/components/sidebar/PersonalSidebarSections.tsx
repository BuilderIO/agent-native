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
import { IconChevronRight, IconDots } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentRecent } from "@/hooks/use-content-recent";
import { cn } from "@/lib/utils";

import {
  SidebarReorderProvider,
  useSidebarReorderItem,
  type SidebarReorderLabels,
} from "./sidebar-reorder";

const stateKey = ["action", "get-content-sidebar-state", {}];

export function PersonalSidebarSections({
  renderPinned,
  pinnedCount,
  renderWorkspaces,
  onNavigate,
  reorderLabels,
}: {
  renderPinned: (limit: number) => ReactNode;
  pinnedCount: number;
  renderWorkspaces: () => ReactNode;
  onNavigate?: () => void;
  reorderLabels: SidebarReorderLabels;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const state = useActionQuery("get-content-sidebar-state", {});
  const recent = useContentRecent();
  const update = useActionMutation("update-content-sidebar-state", {
    skipActionQueryInvalidation: true,
  });
  const [optimistic, setOptimistic] = useState<ContentSidebarSections | null>(
    null,
  );
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
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
            version: 1,
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
    id: "pinned" | "recent",
    patch: Partial<ContentSidebarSections["pinned"]>,
  ) {
    save({ ...sections, [id]: { ...sections[id], ...patch } });
  }
  const labels = {
    pinned: t("sidebar.pinned"),
    recent: t("sidebar.recent"),
    workspaces: t("sidebar.workspaces"),
  };
  function canShowMore(id: "pinned" | "recent") {
    const count =
      id === "pinned" ? pinnedCount : (recent.data?.entries.length ?? 0);
    if (sections[id].limit >= 50) return false;
    return count > sections[id].limit;
  }
  if (state.isError)
    return (
      <>
        <QueryErrorState compact onRetry={() => void state.refetch()} />
        {renderWorkspaces()}
      </>
    );
  if (state.isLoading)
    return (
      <>
        <Skeleton className="mx-3 my-2 h-7" />
        {renderWorkspaces()}
      </>
    );
  return (
    <>
      <div className="flex justify-end px-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("sidebar.customizeSidebar")}
            >
              <IconDots className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {(["pinned", "recent"] as const).map((id) => (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={sections[id].visible}
                  onCheckedChange={(visible) => change(id, { visible })}
                >
                  {labels[id]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
          id === "workspaces" ? (
            <PersonalSection
              key={id}
              id={id}
              label={labels[id]}
              reorderLabels={reorderLabels}
            >
              {renderWorkspaces()}
            </PersonalSection>
          ) : sections[id].visible ? (
            <PersonalSection
              key={id}
              id={id}
              label={labels[id]}
              expanded={sections[id].expanded}
              onToggle={() => change(id, { expanded: !sections[id].expanded })}
              reorderLabels={reorderLabels}
            >
              {sections[id].expanded && (
                <>
                  {id === "pinned" ? (
                    renderPinned(sections.pinned.limit)
                  ) : recent.isError ? (
                    <QueryErrorState
                      compact
                      onRetry={() => void recent.refetch()}
                      retrying={recent.isFetching}
                    />
                  ) : recent.isLoading ? (
                    <Skeleton className="mx-2 h-20" />
                  ) : recent.data?.entries.length ? (
                    <nav aria-label={labels.recent}>
                      {recent.data.entries
                        .slice(0, sections.recent.limit)
                        .map((entry) => (
                          <Link
                            key={contentRecentTargetKey(entry.target)}
                            to={contentRecentHref(entry.target)}
                            onClick={onNavigate}
                            className="flex h-7 min-w-0 items-center gap-1.5 rounded px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={
                              entry.viewName
                                ? `${entry.title} · ${entry.viewName}`
                                : entry.title
                            }
                          >
                            <span className="truncate">
                              {entry.title || t("sidebar.untitled")}
                            </span>
                            {entry.viewName && (
                              <span className="truncate text-muted-foreground">
                                {entry.viewName}
                              </span>
                            )}
                          </Link>
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
                        change(id, {
                          limit: Math.min(50, sections[id].limit + 5),
                        })
                      }
                    >
                      {t("sidebar.showMore")}
                    </Button>
                  )}
                  {sections[id].limit > 5 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => change(id, { limit: 5 })}
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
  children,
}: {
  id: ContentSidebarSectionId;
  label: string;
  expanded?: boolean;
  onToggle?: () => void;
  reorderLabels: SidebarReorderLabels;
  children: ReactNode;
}) {
  const reorder = useSidebarReorderItem(id);
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
            className="flex size-7 items-center justify-center rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconChevronRight
              className={cn("size-3.5", expanded && "rotate-90")}
            />
          </button>
        )}
        <button
          type="button"
          {...reorder.attributes}
          {...reorder.listeners}
          aria-label={reorderLabels.drag(label)}
          className="min-w-0 flex-1 truncate text-start text-xs font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={reorderLabels.drag(label)}
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children}
    </section>
  );
}
