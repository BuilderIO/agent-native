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
  IconDots,
  IconLoader2,
  IconStar,
  IconPencil,
  IconSettings,
  IconGripVertical,
  IconBook2,
  IconDatabase,
  IconUsers,
  IconReportAnalytics,
  IconSearch,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  FeedbackButton,
  appApiPath,
  appPath,
  useActionMutation,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { NewDashboardDialog } from "./NewDashboardDialog";
import { NewAnalysisDialog } from "./NewAnalysisDialog";
import { useUserPref } from "@/hooks/use-user-pref";
import {
  useAllDashboardViews,
  useDeleteDashboardView,
  type DashboardView,
} from "@/hooks/use-dashboard-views";
import { usePopularity, popularityOf } from "@/lib/item-popularity";

const SIDEBAR_PREVIEW_COUNT = 5;

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

// --- Shared sortable row (used by both dashboards and analyses) ---

function SortableRow({
  id,
  favoriteKey,
  name,
  href,
  isActive,
  favoriteIds,
  onToggleFavorite,
  onDelete,
  onRename,
  children,
}: {
  id: string;
  favoriteKey: string;
  name: string;
  href: string;
  isActive: boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (key: string) => void;
  onDelete: () => Promise<void> | void;
  onRename: (name: string) => Promise<void> | void;
  children?: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };
  const isFav = favoriteIds.has(favoriteKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);

  useEffect(() => {
    if (!isRenaming) setRenameValue(name);
  }, [isRenaming, name]);

  const submitRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    setIsRenaming(false);
    if (!trimmed || trimmed === name) {
      setRenameValue(name);
      return;
    }
    try {
      await onRename(trimmed);
    } catch (e) {
      setRenameValue(name);
      toast.error(
        e instanceof Error
          ? `Couldn't rename ${name}: ${e.message}`
          : `Couldn't rename ${name}`,
      );
    }
  }, [name, onRename, renameValue]);

  const runDelete = useCallback(async () => {
    setMenuOpen(false);
    try {
      await onDelete();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Couldn't delete ${name}: ${e.message}`
          : `Couldn't delete ${name}`,
      );
    }
  }, [name, onDelete]);

  return (
    <div ref={setNodeRef} style={style} className="group/item relative min-w-0">
      <button
        type="button"
        className="absolute -left-4 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded p-1 text-muted-foreground/30 opacity-0 transition-colors hover:text-muted-foreground/60 group-hover/item:opacity-100 active:cursor-grabbing"
        aria-label={`Drag ${name}`}
        {...attributes}
        {...listeners}
      >
        <IconGripVertical className="h-3 w-3" />
      </button>
      <div
        className={cn(
          "relative flex min-w-0 items-center rounded-lg transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 group-hover/item:text-primary",
        )}
      >
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setRenameValue(name);
                setIsRenaming(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 pr-12 text-xs outline-none"
          />
        ) : (
          <Link
            to={href}
            title={name}
            className="min-w-0 flex-1 px-2 py-1.5 pr-12 text-xs transition-[padding] md:pr-2 md:group-hover/item:pr-12 md:group-focus-within/item:pr-12"
          >
            <span className="block truncate">{name}</span>
          </Link>
        )}
        <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/item:opacity-100 md:group-focus-within/item:opacity-100">
          <button
            type="button"
            onClick={() => onToggleFavorite(favoriteKey)}
            className={cn(
              "pointer-events-auto rounded p-0.5 transition-colors",
              isFav
                ? "text-yellow-500"
                : "text-muted-foreground/50 hover:text-yellow-500",
            )}
            title={isFav ? "Unfavorite" : "Favorite"}
            aria-label={isFav ? "Unfavorite" : "Favorite"}
          >
            <IconStar className={cn("h-3 w-3", isFav && "fill-current")} />
          </button>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="pointer-events-auto rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                title={`${name} actions`}
                aria-label={`${name} actions`}
              >
                <IconDots className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-36">
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(name);
                  setIsRenaming(true);
                }}
              >
                <IconPencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void runDelete();
                }}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {children}
    </div>
  );
}

// --- Dashboard item: wraps SortableRow + renders dashboard-specific subviews ---

function SortableDashboardItem({
  d,
  isActive,
  location,
  favoriteIds,
  onToggleFavorite,
  onDelete,
  onRename,
  views,
}: {
  d: SidebarDashboard;
  isActive: boolean;
  location: ReturnType<typeof useLocation>;
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  onDelete: (d: SidebarDashboard) => Promise<void>;
  onRename: (d: SidebarDashboard, name: string) => Promise<void>;
  views?: DashboardView[];
}) {
  const href = `/adhoc/${d.id}`;
  const { mutateAsync: deleteView } = useDeleteDashboardView();
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);

  const allSubviews = useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      href: string;
      isDynamic: boolean;
    }> = [];
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
    <SortableRow
      id={d.id}
      favoriteKey={d.id}
      name={d.name}
      href={href}
      isActive={isActive}
      favoriteIds={favoriteIds}
      onToggleFavorite={onToggleFavorite}
      onDelete={() => onDelete(d)}
      onRename={(name) => onRename(d, name)}
    >
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
                          className="opacity-0 group-hover/sv:opacity-100 p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-all shrink-0"
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
    </SortableRow>
  );
}

// Analyses reuse SortableRow directly — no wrapper component needed.

const ANALYSIS_ORDER_KEY = "analysis-order";

function getAnalysisOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ANALYSIS_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function setAnalysisOrder(order: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANALYSIS_ORDER_KEY, JSON.stringify(order));
  } catch {
    // localStorage unavailable / quota — ignore, order is best-effort
  }
}

const STATIC_DASHBOARD_RENAMES_KEY = "dashboard-name-overrides";

function getStaticDashboardRenames(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STATIC_DASHBOARD_RENAMES_KEY) || "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" &&
          typeof entry[1] === "string" &&
          entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function setStaticDashboardRenames(renames: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STATIC_DASHBOARD_RENAMES_KEY,
      JSON.stringify(renames),
    );
  } catch {
    // localStorage unavailable / quota — ignore, rename is best-effort
  }
}

async function fetchSqlDashboards(): Promise<{ id: string; name: string }[]> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/sql-dashboards"), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.dashboards ?? [])
    .filter((d: any) => d && typeof d.id === "string" && d.id.length > 0)
    .map((d: any) => ({
      id: d.id,
      name:
        typeof d.name === "string" && d.name.trim().length > 0
          ? d.name
          : "Untitled dashboard",
    }));
}

async function fetchSidebarAnalyses(): Promise<{ id: string; name: string }[]> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/analyses"), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  const rows = Array.isArray(data) ? data : (data.analyses ?? []);
  return rows
    .filter((a: any) => a && typeof a.id === "string" && a.id.length > 0)
    .map((a: any) => ({
      id: a.id,
      name:
        typeof a.name === "string" && a.name.trim().length > 0
          ? a.name
          : "Untitled analysis",
    }));
}

// --- Sidebar ---

export function Sidebar({ mobile }: { mobile?: boolean } = {}) {
  const location = useLocation();
  const { logout } = useAuth();
  const queryClient = useQueryClient();

  const [dashOpen, setDashOpen] = useState(true);
  const [dashShowAll, setDashShowAll] = useState(false);
  const [analysesOpen, setAnalysesOpen] = useState(true);
  const [analysesShowAll, setAnalysesShowAll] = useState(false);
  const popularity = usePopularity();

  const [light, setLight] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("light")
      : false,
  );

  useEffect(() => {
    fetch(appApiPath("/api/theme"))
      .then((r) => r.json())
      .then((d) => {
        const isLight = d.theme === "light";
        setLight(isLight);
        document.documentElement.classList.toggle("light", isLight);
      })
      .catch(() => {});
  }, []);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { mutateAsync: renameDashboard } =
    useActionMutation("rename-dashboard");
  const { mutateAsync: renameAnalysis } = useActionMutation("rename-analysis");
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 256;
    const saved = localStorage.getItem("sidebar-width");
    return saved ? Math.max(180, Math.min(480, Number(saved))) : 256;
  });
  const isResizing = useRef(false);
  const [hiddenIds, setHiddenIds] = useState(() =>
    typeof window === "undefined" ? new Set<string>() : getHiddenDashboards(),
  );
  const [staticDashboardRenames, setStaticDashboardRenamesState] = useState<
    Record<string, string>
  >(() => (typeof window === "undefined" ? {} : getStaticDashboardRenames()));
  const [dashboardOrderState, setDashboardOrderState] = useState(() =>
    typeof window === "undefined" ? [] : getDashboardOrder(),
  );
  const [analysisOrderState, setAnalysisOrderState] = useState(() =>
    typeof window === "undefined" ? [] : getAnalysisOrder(),
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

  const { data: analysesList = [], isLoading: analysesLoading } = useQuery({
    queryKey: ["analyses-sidebar"],
    queryFn: fetchSidebarAnalyses,
    staleTime: 30_000,
  });

  const sortedAnalyses = useMemo(() => {
    if (analysisOrderState.length === 0) {
      return [...analysesList].sort((a, b) => {
        const aFav = favoriteIds.has(`analysis:${a.id}`) ? 0 : 1;
        const bFav = favoriteIds.has(`analysis:${b.id}`) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        const aPop = popularityOf(popularity, "analysis", a.id);
        const bPop = popularityOf(popularity, "analysis", b.id);
        if (aPop !== bPop) return bPop - aPop;
        return a.name.localeCompare(b.name);
      });
    }
    return applyOrder(analysesList, analysisOrderState);
  }, [analysesList, favoriteIds, popularity, analysisOrderState]);

  const displayedAnalyses = useMemo(
    () =>
      analysesShowAll
        ? sortedAnalyses
        : sortedAnalyses.slice(0, SIDEBAR_PREVIEW_COUNT),
    [sortedAnalyses, analysesShowAll],
  );

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
        name: staticDashboardRenames[d.id] ?? d.name,
        subviews: d.subviews,
        source: "static",
      }));
    const sqlItems: SidebarDashboard[] = sqlDashboards.map((d) => ({
      id: d.id,
      name: d.name,
      source: "sql",
    }));
    const all = [...staticItems, ...sqlItems];
    // If no custom order yet, sort favorites first, then by popularity, then alpha.
    if (dashboardOrderState.length === 0) {
      return all.sort((a, b) => {
        const aFav = favoriteIds.has(a.id) ? 0 : 1;
        const bFav = favoriteIds.has(b.id) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        const aPop = popularityOf(popularity, "dashboard", a.id);
        const bPop = popularityOf(popularity, "dashboard", b.id);
        if (aPop !== bPop) return bPop - aPop;
        return a.name.localeCompare(b.name);
      });
    }
    return applyOrder(all, dashboardOrderState);
  }, [
    hiddenIds,
    staticDashboardRenames,
    favoriteIds,
    dashboardOrderState,
    sqlDashboards,
    popularity,
  ]);

  const displayedDashboards = useMemo(
    () =>
      dashShowAll
        ? visibleDashboards
        : visibleDashboards.slice(0, SIDEBAR_PREVIEW_COUNT),
    [visibleDashboards, dashShowAll],
  );

  const handleDashboardDelete = useCallback(
    async (d: SidebarDashboard) => {
      if (d.source === "static") {
        hideDashboard(d.id);
        setHiddenIds(getHiddenDashboards());
        return;
      }
      // Optimistic: remove from the sidebar query cache immediately so the
      // row disappears without waiting for the DELETE round-trip. Snapshot
      // the prior value so we can roll back on failure.
      const queryKey = ["sql-dashboards-sidebar"] as const;
      const prev =
        queryClient.getQueryData<{ id: string; name: string }[]>(queryKey);
      queryClient.setQueryData<{ id: string; name: string }[]>(
        queryKey,
        (old) => (old ?? []).filter((item) => item.id !== d.id),
      );
      try {
        const token = await getIdToken();
        const res = await fetch(appApiPath(`/api/sql-dashboards/${d.id}`), {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          throw new Error(`Delete failed: ${res.status}`);
        }
        queryClient.invalidateQueries({ queryKey });
      } catch (err) {
        if (prev) queryClient.setQueryData(queryKey, prev);
        throw err;
      }
    },
    [queryClient],
  );

  const handleDashboardRename = useCallback(
    async (d: SidebarDashboard, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === d.name) return;

      if (d.source === "static") {
        setStaticDashboardRenamesState((prev) => {
          const next = { ...prev, [d.id]: trimmed };
          setStaticDashboardRenames(next);
          return next;
        });
        return;
      }

      const queryKey = ["sql-dashboards-sidebar"] as const;
      const prev =
        queryClient.getQueryData<{ id: string; name: string }[]>(queryKey);
      queryClient.setQueryData<{ id: string; name: string }[]>(
        queryKey,
        (old) =>
          (old ?? []).map((item) =>
            item.id === d.id ? { ...item, name: trimmed } : item,
          ),
      );
      try {
        await renameDashboard({ id: d.id, name: trimmed });
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({
          queryKey: ["sql-dashboards-palette"],
        });
      } catch (err) {
        if (prev) queryClient.setQueryData(queryKey, prev);
        throw err;
      }
    },
    [queryClient, renameDashboard],
  );

  const handleAnalysisDelete = useCallback(
    async (a: { id: string; name: string }) => {
      const queryKey = ["analyses-sidebar"] as const;
      const prev =
        queryClient.getQueryData<{ id: string; name: string }[]>(queryKey);
      queryClient.setQueryData<{ id: string; name: string }[]>(
        queryKey,
        (old) => (old ?? []).filter((item) => item.id !== a.id),
      );
      try {
        const token = await getIdToken();
        const res = await fetch(appApiPath(`/api/analyses/${a.id}`), {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          throw new Error(`Delete failed: ${res.status}`);
        }
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ["analyses-list"] });
      } catch (err) {
        if (prev) queryClient.setQueryData(queryKey, prev);
        throw err;
      }
    },
    [queryClient],
  );

  const handleAnalysisRename = useCallback(
    async (a: { id: string; name: string }, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === a.name) return;

      const sidebarKey = ["analyses-sidebar"] as const;
      const listKey = ["analyses-list"] as const;
      const detailKey = ["analysis-detail", a.id] as const;
      const prevSidebar =
        queryClient.getQueryData<{ id: string; name: string }[]>(sidebarKey);
      const prevList = queryClient.getQueryData<any[]>(listKey);
      const prevDetail = queryClient.getQueryData<any>(detailKey);

      queryClient.setQueryData<{ id: string; name: string }[]>(
        sidebarKey,
        (old) =>
          (old ?? []).map((item) =>
            item.id === a.id ? { ...item, name: trimmed } : item,
          ),
      );
      queryClient.setQueryData<any[]>(listKey, (old) =>
        (old ?? []).map((item) =>
          item.id === a.id ? { ...item, name: trimmed } : item,
        ),
      );
      queryClient.setQueryData<any>(detailKey, (old) =>
        old ? { ...old, name: trimmed } : old,
      );

      try {
        await renameAnalysis({ id: a.id, name: trimmed });
        queryClient.invalidateQueries({ queryKey: sidebarKey });
        queryClient.invalidateQueries({ queryKey: listKey });
        queryClient.invalidateQueries({ queryKey: detailKey });
      } catch (err) {
        if (prevSidebar) queryClient.setQueryData(sidebarKey, prevSidebar);
        if (prevList) queryClient.setQueryData(listKey, prevList);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        throw err;
      }
    },
    [queryClient, renameAnalysis],
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

  const handleAnalysisDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setAnalysisOrderState((prev) => {
        const ids = prev.length > 0 ? prev : sortedAnalyses.map((a) => a.id);
        const oldIndex = ids.indexOf(active.id as string);
        const newIndex = ids.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const newOrder = arrayMove(ids, oldIndex, newIndex);
        setAnalysisOrder(newOrder);
        return newOrder;
      });
    },
    [sortedAnalyses],
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
      className="relative flex h-screen min-w-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground"
      style={mobile ? undefined : { width: sidebarWidth }}
    >
      {!mobile && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
        />
      )}
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4 lg:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-5 w-auto shrink-0 dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-5 w-auto shrink-0 dark:block"
          />
          <span className="text-lg font-bold tracking-tight">Analytics</span>
        </Link>
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden py-2">
        <nav className="grid min-w-0 items-start px-2 text-sm font-medium lg:px-4 space-y-1">
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
              "flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary text-left",
              isAdhocActive
                ? "text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <IconFlask className="h-4 w-4 shrink-0" />
            <span className="flex-1 min-w-0 truncate">Dashboards</span>
            <IconChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform",
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
                items={displayedDashboards.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="ml-4 min-w-0 space-y-0.5">
                  {displayedDashboards.map((d) => (
                    <SortableDashboardItem
                      key={d.id}
                      d={d}
                      isActive={location.pathname === `/adhoc/${d.id}`}
                      location={location}
                      favoriteIds={favoriteIds}
                      onToggleFavorite={toggleFavorite}
                      onDelete={handleDashboardDelete}
                      onRename={handleDashboardRename}
                      views={allViewsMap[d.id]}
                    />
                  ))}
                  {visibleDashboards.length > SIDEBAR_PREVIEW_COUNT && (
                    <button
                      onClick={() => setDashShowAll(!dashShowAll)}
                      className="flex items-center gap-1 px-3 py-1 text-[11px] text-muted-foreground/70 hover:text-primary"
                    >
                      {dashShowAll
                        ? "Show less"
                        : `Show ${visibleDashboards.length - SIDEBAR_PREVIEW_COUNT} more`}
                    </button>
                  )}
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

          {/* Analyses section */}
          <button
            onClick={() => setAnalysesOpen(!analysesOpen)}
            className={cn(
              "flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary text-left",
              location.pathname.startsWith("/analyses")
                ? "text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <IconReportAnalytics className="h-4 w-4 shrink-0" />
            <span className="flex-1 min-w-0 truncate">Analyses</span>
            <IconChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform",
                !analysesOpen && "-rotate-90",
              )}
            />
          </button>

          {analysesOpen && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleAnalysisDragEnd}
            >
              <SortableContext
                items={displayedAnalyses.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="ml-4 min-w-0 space-y-0.5">
                  {displayedAnalyses.map((a) => (
                    <SortableRow
                      key={a.id}
                      id={a.id}
                      favoriteKey={`analysis:${a.id}`}
                      name={a.name}
                      href={`/analyses/${a.id}`}
                      isActive={location.pathname === `/analyses/${a.id}`}
                      favoriteIds={favoriteIds}
                      onToggleFavorite={toggleFavorite}
                      onDelete={() => handleAnalysisDelete(a)}
                      onRename={(name) => handleAnalysisRename(a, name)}
                    />
                  ))}
                  {sortedAnalyses.length > SIDEBAR_PREVIEW_COUNT && (
                    <button
                      onClick={() => setAnalysesShowAll(!analysesShowAll)}
                      className="flex items-center gap-1 px-3 py-1 text-[11px] text-muted-foreground/70 hover:text-primary"
                    >
                      {analysesShowAll
                        ? "Show less"
                        : `Show ${sortedAnalyses.length - SIDEBAR_PREVIEW_COUNT} more`}
                    </button>
                  )}
                  {analysesLoading &&
                    sortedAnalyses.length === 0 &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={`analysis-skeleton-${i}`}
                        className="flex items-center gap-2 px-3 py-1"
                      >
                        <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                        <Skeleton
                          className="h-3 rounded"
                          style={{ width: `${60 + ((i * 17) % 30)}%` }}
                        />
                      </div>
                    ))}
                  {!analysesLoading && sortedAnalyses.length === 0 && (
                    <p className="px-3 py-1 text-[11px] text-muted-foreground/60">
                      No analyses yet
                    </p>
                  )}
                  <NewAnalysisDialog />
                </div>
              </SortableContext>
            </DndContext>
          )}

          <div className="min-w-0 border-t border-border mt-2 pt-2">
            <ExtensionsSidebarSection />
          </div>

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
          <FeedbackButton />
        </nav>
      </div>
      <div className="p-4 border-t border-border space-y-2">
        <OrgSwitcher />
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() =>
                    document.dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: "p",
                        metaKey: true,
                      }),
                    )
                  }
                  className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-all hover:text-primary cursor-pointer hover:bg-sidebar-accent/50"
                >
                  <IconSearch className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Search (\u2318P)</p>
              </TooltipContent>
            </Tooltip>
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
                    fetch(appApiPath("/api/theme"), {
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
