import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconFlask,
  IconLogout,
  IconChevronDown,
  IconSun,
  IconMoon,
  IconInfoCircle,
  IconTrash,
  IconLoader2,
  IconStar,
  IconSettings,
  IconGripVertical,
  IconBook2,
  IconDatabase,
  IconUsers,
  IconReportAnalytics,
} from "@tabler/icons-react";
import { getIdToken } from "@/lib/auth";
import {
  dashboards,
  hideDashboard,
  getHiddenDashboards,
  getDashboardOrder,
  setDashboardOrder,
  type DashboardMeta,
  type DashboardSubview,
} from "@/pages/adhoc/registry";

type SidebarDashboard = {
  id: string;
  name: string;
  subviews?: DashboardSubview[];
  source: "static" | "sql";
};
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { NewDashboardDialog } from "./NewDashboardDialog";
import { useUserPref } from "@/hooks/use-user-pref";
import {
  useAllDashboardViews,
  useDeleteDashboardView,
  type DashboardView,
} from "@/hooks/use-dashboard-views";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const bottomItems = [
  { icon: IconUsers, label: "Team", href: "/team" },
  { icon: IconSettings, label: "Settings", href: "/settings" },
  { icon: IconInfoCircle, label: "About", href: "/about" },
];

function applyOrder<T extends { id: string }>(
  items: T[],
  savedOrder: string[],
): T[] {
  if (savedOrder.length === 0) return items;
  const idToItem = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  for (const id of savedOrder) {
    const item = idToItem.get(id);
    if (item) {
      ordered.push(item);
      idToItem.delete(id);
    }
  }
  // Append any new items not in the saved order
  for (const item of idToItem.values()) {
    ordered.push(item);
  }
  return ordered;
}

// --- Sortable Dashboard Item ---

function SortableDashboardItem({
  d,
  isActive,
  location,
  favoriteIds,
  deletingId,
  onToggleFavorite,
  setDeletingId,
  onDelete,
  views,
}: {
  d: SidebarDashboard;
  isActive: boolean;
  location: ReturnType<typeof useLocation>;
  favoriteIds: Set<string>;
  deletingId: string | null;
  onToggleFavorite: (id: string) => void;
  setDeletingId: (id: string | null) => void;
  onDelete: (d: SidebarDashboard) => void;
  views?: DashboardView[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: d.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const href = `/adhoc/${d.id}`;

  const { mutateAsync: deleteView } = useDeleteDashboardView();
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);

  // Merge static subviews with dynamic views
  const allSubviews = useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      href: string;
      isDynamic: boolean;
    }> = [];

    // Static subviews from registry
    if (d.subviews) {
      for (const sv of d.subviews) {
        const svSearch = new URLSearchParams(sv.params).toString();
        items.push({
          id: sv.id,
          name: sv.name,
          href: `${href}?${svSearch}`,
          isDynamic: false,
        });
      }
    }

    // Dynamic views from server
    if (views) {
      for (const v of views) {
        const params = new URLSearchParams(v.filters);
        params.set("view", v.id);
        items.push({
          id: v.id,
          name: v.name,
          href: `${href}?${params.toString()}`,
          isDynamic: true,
        });
      }
    }

    return items;
  }, [d.subviews, views, href]);

  return (
    <div ref={setNodeRef} style={style} className="group/dash relative min-w-0">
      <div className="flex items-center min-w-0">
        <button
          className="p-1 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0 opacity-0 group-hover/dash:opacity-100"
          {...attributes}
          {...listeners}
        >
          <IconGripVertical className="h-3 w-3" />
        </button>
        <Link
          to={href}
          className={cn(
            "flex-1 min-w-0 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all hover:text-primary",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50",
          )}
        >
          <span className="truncate">{d.name}</span>
        </Link>
        <button
          onClick={() => onToggleFavorite(d.id)}
          className={cn(
            "p-1 rounded transition-all shrink-0",
            favoriteIds.has(d.id)
              ? "text-yellow-500 opacity-100"
              : "opacity-0 group-hover/dash:opacity-100 text-muted-foreground/50 hover:text-yellow-500",
          )}
          title={favoriteIds.has(d.id) ? "Unfavorite" : "Favorite"}
        >
          <IconStar
            className={cn("h-3 w-3", favoriteIds.has(d.id) && "fill-current")}
          />
        </button>
        <Popover
          open={deletingId === d.id}
          onOpenChange={(open) => setDeletingId(open ? d.id : null)}
        >
          <PopoverTrigger asChild>
            <button
              className="opacity-0 group-hover/dash:opacity-100 p-1 rounded text-muted-foreground/50 hover:text-destructive transition-all shrink-0 mr-1"
              title={`Remove ${d.name}`}
            >
              <IconTrash className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-3" side="right" align="start">
            <p className="text-sm mb-3">
              Remove <strong>{d.name}</strong>?
            </p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    await onDelete(d);
                    setDeletingId(null);
                  } catch (e) {
                    // Keep the dialog open so the user can retry or cancel.
                    toast.error(
                      e instanceof Error
                        ? `Couldn't remove ${d.name}: ${e.message}`
                        : `Couldn't remove ${d.name}`,
                    );
                  }
                }}
                className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Remove
              </button>
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-sidebar-accent/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {isActive && allSubviews.length > 0 && (
        <div className="ml-6 mt-0.5 space-y-0.5">
          {allSubviews.map((sv) => {
            const currentSearch = new URLSearchParams(location.search);
            const svUrl = new URL(sv.href, window.location.origin);
            const svParams = new URLSearchParams(svUrl.search);
            const isSubviewActive = sv.isDynamic
              ? currentSearch.get("view") === sv.id
              : Array.from(svParams.entries()).every(
                  ([k, v]) => currentSearch.get(k) === v,
                );
            const isDeleting =
              sv.isDynamic && deletingViewId === `pending:${sv.id}`;
            return (
              <div
                key={sv.id}
                className={cn(
                  "group/sv flex items-center gap-1 rounded-md pr-1 transition-all",
                  isSubviewActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground/70 hover:bg-sidebar-accent/50 hover:text-primary",
                )}
              >
                <Link
                  to={sv.href}
                  className="flex-1 min-w-0 px-3 py-1 text-[11px] truncate"
                >
                  <span className="truncate">{sv.name}</span>
                </Link>
                {sv.isDynamic && (
                  <>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleFavorite(`view:${d.id}:${sv.id}`);
                      }}
                      className={cn(
                        "p-0.5 rounded shrink-0",
                        favoriteIds.has(`view:${d.id}:${sv.id}`)
                          ? "text-yellow-500 opacity-100"
                          : "opacity-0 group-hover/sv:opacity-100 text-muted-foreground/50 hover:text-yellow-500",
                      )}
                      title={
                        favoriteIds.has(`view:${d.id}:${sv.id}`)
                          ? "Unfavorite"
                          : "Favorite"
                      }
                    >
                      <IconStar
                        className={cn(
                          "h-2.5 w-2.5",
                          favoriteIds.has(`view:${d.id}:${sv.id}`) &&
                            "fill-current",
                        )}
                      />
                    </button>
                    <Popover
                      open={deletingViewId === sv.id}
                      onOpenChange={(open) =>
                        setDeletingViewId(open ? sv.id : null)
                      }
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="opacity-0 group-hover/sv:opacity-100 p-0.5 rounded text-muted-foreground/50 hover:text-destructive transition-all shrink-0"
                          title={`Delete ${sv.name}`}
                        >
                          <IconTrash className="h-2.5 w-2.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-56 p-3"
                        side="right"
                        align="start"
                      >
                        <p className="text-sm mb-3">
                          Delete view <strong>{sv.name}</strong>?
                        </p>
                        <div className="flex gap-2">
                          <button
                            disabled={isDeleting}
                            onClick={async () => {
                              setDeletingViewId(`pending:${sv.id}`);
                              try {
                                await deleteView({
                                  dashboardId: d.id,
                                  viewId: sv.id,
                                });
                                setDeletingViewId(null);
                              } catch (err) {
                                setDeletingViewId(sv.id);
                                toast.error(
                                  err instanceof Error
                                    ? `Couldn't delete view: ${err.message}`
                                    : "Couldn't delete view",
                                );
                              }
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
                          >
                            {isDeleting && (
                              <IconLoader2 className="h-3 w-3 animate-spin" />
                            )}
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                          <button
                            disabled={isDeleting}
                            onClick={() => setDeletingViewId(null)}
                            className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-sidebar-accent/50 transition-colors disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function fetchSqlDashboards(): Promise<{ id: string; name: string }[]> {
  const token = await getIdToken();
  const res = await fetch("/api/sql-dashboards", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.dashboards ?? []).map((d: any) => ({ id: d.id, name: d.name }));
}

// --- Sidebar ---

export function Sidebar({ mobile }: { mobile?: boolean } = {}) {
  const location = useLocation();
  const { logout } = useAuth();
  const queryClient = useQueryClient();

  const [dashOpen, setDashOpen] = useState(true);

  const [light, setLight] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("light")
      : false,
  );

  useEffect(() => {
    fetch("/api/theme")
      .then((r) => r.json())
      .then((d) => {
        const isLight = d.theme === "light";
        setLight(isLight);
        document.documentElement.classList.toggle("light", isLight);
      })
      .catch(() => {});
  }, []);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 256;
    const saved = localStorage.getItem("sidebar-width");
    return saved ? Math.max(180, Math.min(480, Number(saved))) : 256;
  });
  const isResizing = useRef(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState(() =>
    typeof window === "undefined" ? new Set<string>() : getHiddenDashboards(),
  );
  const [dashboardOrderState, setDashboardOrderState] = useState(() =>
    typeof window === "undefined" ? [] : getDashboardOrder(),
  );

  // Server-backed favorites
  const { data: favoritesData, save: saveFavorites } = useUserPref<{
    ids: string[];
  }>("favorites");
  const favoriteIds = useMemo(
    () => new Set(favoritesData?.ids ?? []),
    [favoritesData],
  );
  const toggleFavorite = useCallback(
    (id: string) => {
      const next = new Set(favoriteIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveFavorites({ ids: Array.from(next) });
    },
    [favoriteIds, saveFavorites],
  );

  const { data: sqlDashboards = [], isLoading: sqlDashboardsLoading } =
    useQuery({
      queryKey: ["sql-dashboards-sidebar"],
      queryFn: fetchSqlDashboards,
      staleTime: 30_000,
    });

  // Fetch views for all dashboards (for sidebar sub-items)
  const allDashboardIds = useMemo(() => {
    const ids = dashboards.map((d) => d.id);
    for (const sd of sqlDashboards) {
      if (!ids.includes(sd.id)) ids.push(sd.id);
    }
    return ids;
  }, [sqlDashboards]);

  const { data: allViewsMap = {} } = useAllDashboardViews(allDashboardIds);

  const visibleDashboards = useMemo<SidebarDashboard[]>(() => {
    const staticItems: SidebarDashboard[] = dashboards
      .filter((d) => !hiddenIds.has(d.id))
      .map((d) => ({
        id: d.id,
        name: d.name,
        subviews: d.subviews,
        source: "static",
      }));
    const sqlItems: SidebarDashboard[] = sqlDashboards.map((d) => ({
      id: d.id,
      name: d.name,
      source: "sql",
    }));
    const all = [...staticItems, ...sqlItems];
    // If no custom order yet, sort favorites to top
    if (dashboardOrderState.length === 0) {
      return all.sort((a, b) => {
        const aFav = favoriteIds.has(a.id) ? 0 : 1;
        const bFav = favoriteIds.has(b.id) ? 0 : 1;
        return aFav - bFav;
      });
    }
    return applyOrder(all, dashboardOrderState);
  }, [hiddenIds, favoriteIds, dashboardOrderState, sqlDashboards]);

  const handleDashboardDelete = useCallback(
    async (d: SidebarDashboard) => {
      if (d.source === "static") {
        hideDashboard(d.id);
        setHiddenIds(getHiddenDashboards());
        return;
      }
      const token = await getIdToken();
      const res = await fetch(`/api/sql-dashboards/${d.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        // Surface failures instead of silently "succeeding" — otherwise the
        // sidebar refreshes and the deleted-looking row reappears, leaving
        // the user confused about what happened.
        throw new Error(`Delete failed: ${res.status}`);
      }
      queryClient.invalidateQueries({ queryKey: ["sql-dashboards-sidebar"] });
    },
    [queryClient],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDashboardDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setDashboardOrderState((prev) => {
        const ids = prev.length > 0 ? prev : visibleDashboards.map((d) => d.id);
        const oldIndex = ids.indexOf(active.id as string);
        const newIndex = ids.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const newOrder = arrayMove(ids, oldIndex, newIndex);
        setDashboardOrder(newOrder);
        return newOrder;
      });
    },
    [visibleDashboards],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.max(
          180,
          Math.min(480, startWidth + ev.clientX - startX),
        );
        setSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setSidebarWidth((w) => {
          localStorage.setItem("sidebar-width", String(w));
          return w;
        });
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  const isAdhocActive = location.pathname.startsWith("/adhoc");

  return (
    <div
      className="relative flex h-screen flex-col border-r border-border bg-sidebar text-sidebar-foreground"
      style={mobile ? undefined : { width: sidebarWidth }}
    >
      {!mobile && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
        />
      )}
      <div className="flex h-14 items-center border-b border-border px-4 lg:h-[60px] lg:px-6">
        <Link to="/" className="font-semibold">
          <span className="text-lg font-bold tracking-tight">Analytics</span>
        </Link>
      </div>
      <div className="flex-1 overflow-auto py-2">
        <nav className="grid items-start px-2 text-sm font-medium lg:px-4 space-y-1">
          {/* Data Sources link */}
          <Link
            to="/data-sources"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              location.pathname === "/data-sources"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <IconDatabase className="h-4 w-4" />
            Data Sources
          </Link>

          {/* Analyses link */}
          <Link
            to="/analyses"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              location.pathname.startsWith("/analyses")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <IconReportAnalytics className="h-4 w-4" />
            Analyses
          </Link>

          {/* Data Dictionary link */}
          <Link
            to="/data-dictionary"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              location.pathname.startsWith("/data-dictionary")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <IconBook2 className="h-4 w-4" />
            Data Dictionary
          </Link>

          {/* Dashboards section */}
          <button
            onClick={() => setDashOpen(!dashOpen)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary text-left",
              isAdhocActive
                ? "text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <IconFlask className="h-4 w-4" />
            <span className="flex-1">Dashboards</span>
            <IconChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                !dashOpen && "-rotate-90",
              )}
            />
          </button>

          {dashOpen && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDashboardDragEnd}
            >
              <SortableContext
                items={visibleDashboards.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="ml-4 space-y-0.5">
                  {visibleDashboards.map((d) => (
                    <SortableDashboardItem
                      key={d.id}
                      d={d}
                      isActive={location.pathname === `/adhoc/${d.id}`}
                      location={location}
                      favoriteIds={favoriteIds}
                      deletingId={deletingId}
                      onToggleFavorite={toggleFavorite}
                      setDeletingId={setDeletingId}
                      onDelete={handleDashboardDelete}
                      views={allViewsMap[d.id]}
                    />
                  ))}
                  {sqlDashboardsLoading &&
                    sqlDashboards.length === 0 &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={`sql-skeleton-${i}`}
                        className="flex items-center gap-2 px-3 py-1"
                      >
                        <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                        <Skeleton
                          className="h-3 rounded"
                          style={{ width: `${60 + ((i * 17) % 30)}%` }}
                        />
                      </div>
                    ))}
                  <NewDashboardDialog />
                </div>
              </SortableContext>
            </DndContext>
          )}

          {bottomItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="p-4 border-t border-border space-y-2">
        <OrgSwitcher />
        <button
          onClick={() =>
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "p", metaKey: true }),
            )
          }
          className="flex items-center justify-between w-full rounded-lg px-3 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <span>Search</span>
          <kbd className="text-[10px] bg-sidebar-accent/50 px-1.5 py-0.5 rounded border border-border/50 font-mono">
            {navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl+"}P
          </kbd>
        </button>

        <TooltipProvider delayDuration={200}>
          <div className="flex items-center justify-between">
            <Popover open={logoutOpen} onOpenChange={setLogoutOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-all hover:text-primary cursor-pointer hover:bg-sidebar-accent/50">
                      <IconLogout className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Sign Out</p>
                </TooltipContent>
              </Tooltip>
              <PopoverContent className="w-48 p-3" side="top" align="start">
                <p className="text-sm mb-3">Sign out?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setLogoutOpen(false);
                      logout();
                    }}
                    className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setLogoutOpen(false)}
                    className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-sidebar-accent/50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    const next = !light;
                    setLight(next);
                    document.documentElement.classList.toggle("light", next);
                    fetch("/api/theme", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ theme: next ? "light" : "dark" }),
                    }).catch(() => {});
                  }}
                  className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-all hover:text-primary cursor-pointer hover:bg-sidebar-accent/50"
                >
                  {light ? (
                    <IconMoon className="h-4 w-4" />
                  ) : (
                    <IconSun className="h-4 w-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{light ? "Dark mode" : "Light mode"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
