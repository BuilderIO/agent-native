import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  useQuery,
  useQueryClient as __useQueryClient,
} from "@tanstack/react-query";
import {
  FlaskConical,
  LogOut,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Plus,
  Sun,
  Moon,
  Info,
  Trash2,
  Star,
  Wrench,
  GripVertical,
  Home,
  BarChart3,
  LayoutDashboard,
} from "lucide-react";
import { getIdToken } from "@/lib/auth";
import {
  getTotalCost,
  getTotalBytes,
  formatCost,
  formatBytes,
  subscribe,
  resetSession,
} from "@/lib/cost-tracker";
import {
  dashboards,
  hideDashboard,
  getHiddenDashboards,
  getFavoriteDashboards,
  toggleFavoriteDashboard,
  getDashboardOrder,
  setDashboardOrder,
  getToolsOrder,
  setToolsOrder,
  type DashboardMeta,
} from "@/pages/adhoc/registry";
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
import { NewDashboardDialog } from "./NewDashboardDialog";
import { FeedbackButton } from "./FeedbackButton";
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
  { icon: Wrench, label: "Settings", href: "/settings" },
  { icon: Info, label: "About", href: "/about" },
];

interface ToolItem {
  id: string;
  name: string;
  href: string;
}

const defaultTools: ToolItem[] = [
  { id: "explorer", name: "Explorer", href: "/adhoc/explorer" },
  {
    id: "customer-health",
    name: "Customer Health",
    href: "/adhoc/customer-health",
  },
  { id: "stripe", name: "Stripe Billing", href: "/adhoc/stripe" },
  {
    id: "slack-feedback",
    name: "Slack Feedback",
    href: "/adhoc/slack-feedback",
  },
  { id: "query-explorer", name: "Query Explorer", href: "/query" },
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
  setFavoriteIds,
  setDeletingId,
  setHiddenIds,
}: {
  d: DashboardMeta;
  isActive: boolean;
  location: ReturnType<typeof useLocation>;
  favoriteIds: Set<string>;
  deletingId: string | null;
  setFavoriteIds: (ids: Set<string>) => void;
  setDeletingId: (id: string | null) => void;
  setHiddenIds: (ids: Set<string>) => void;
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

  return (
    <div ref={setNodeRef} style={style} className="group relative min-w-0">
      <div className="flex items-center min-w-0">
        <button
          className="p-1 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3 w-3" />
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
          onClick={() => setFavoriteIds(toggleFavoriteDashboard(d.id))}
          className={cn(
            "p-1 rounded transition-all shrink-0",
            favoriteIds.has(d.id)
              ? "text-yellow-500 opacity-100"
              : "opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-yellow-500",
          )}
          title={favoriteIds.has(d.id) ? "Unfavorite" : "Favorite"}
        >
          <Star
            className={cn("h-3 w-3", favoriteIds.has(d.id) && "fill-current")}
          />
        </button>
        <Popover
          open={deletingId === d.id}
          onOpenChange={(open) => setDeletingId(open ? d.id : null)}
        >
          <PopoverTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground/50 hover:text-destructive transition-all shrink-0 mr-1"
              title={`Remove ${d.name}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-3" side="right" align="start">
            <p className="text-sm mb-3">
              Remove <strong>{d.name}</strong>?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  hideDashboard(d.id);
                  setHiddenIds(getHiddenDashboards());
                  setDeletingId(null);
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
      {isActive && d.subviews && d.subviews.length > 0 && (
        <div className="ml-6 mt-0.5 space-y-0.5">
          {d.subviews.map((sv) => {
            const svSearch = new URLSearchParams(sv.params).toString();
            const svHref = `${href}?${svSearch}`;
            const currentSearch = new URLSearchParams(location.search);
            const isSubviewActive = Array.from(Object.entries(sv.params)).every(
              ([k, v]) => currentSearch.get(k) === v,
            );
            return (
              <Link
                key={sv.id}
                to={svHref}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1 text-[11px] transition-all hover:text-primary truncate",
                  isSubviewActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground/70 hover:bg-sidebar-accent/50",
                )}
              >
                {sv.name}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Sortable Tool Item ---

async function fetchSavedCharts(): Promise<{ id: string; name: string }[]> {
  const token = await getIdToken();
  const res = await fetch("/api/explorer-configs", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.configs ?? [])
    .filter((c: any) => c.id !== "_autosave")
    .map((c: any) => ({ id: c.id, name: c.name }));
}

async function fetchExplorerDashboards(): Promise<
  { id: string; name: string }[]
> {
  const token = await getIdToken();
  const res = await fetch("/api/explorer-dashboards", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.dashboards ?? []).map((d: any) => ({ id: d.id, name: d.name }));
}

function NewExplorerDashboardButton() {
  const navigate = useNavigate();
  const queryClient = __useQueryClient();
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    const id = `dashboard-${Date.now()}`;
    const token = await getIdToken();
    await fetch(`/api/explorer-dashboards/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ name: "Untitled Dashboard", charts: [] }),
    });
    queryClient.invalidateQueries({
      queryKey: ["explorer-dashboards-sidebar"],
    });
    queryClient.invalidateQueries({
      queryKey: ["explorer-dashboards-palette"],
    });
    navigate(`/adhoc/explorer-dashboard?id=${id}`);
    setCreating(false);
  };

  return (
    <button
      onClick={handleCreate}
      disabled={creating}
      className="flex items-center gap-2 rounded-md px-3 py-1 text-[11px] text-muted-foreground/50 hover:text-primary hover:bg-sidebar-accent/50 transition-all w-full"
    >
      <Plus className="h-3 w-3 shrink-0" />
      New Dashboard
    </button>
  );
}

function SortableToolItem({
  tool,
  isActive,
  savedCharts,
  explorerDashboards,
  location,
}: {
  tool: ToolItem;
  isActive: boolean;
  savedCharts?: { id: string; name: string }[];
  explorerDashboards?: { id: string; name: string }[];
  location: ReturnType<typeof useLocation>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tool.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className="group flex items-center min-w-0"
      >
        <button
          className="p-1 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <Link
          to={tool.href}
          className={cn(
            "flex-1 min-w-0 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-all hover:text-primary",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50",
          )}
        >
          <span className="truncate">{tool.name}</span>
        </Link>
      </div>
      {/* Sub-items for Explorer: saved charts + explorer dashboards */}
      {tool.id === "explorer" &&
        (isActive ||
          location.pathname === "/adhoc/explorer" ||
          location.pathname === "/adhoc/explorer-dashboard") && (
          <div className="ml-6 mt-0.5 space-y-0.5">
            {(explorerDashboards ?? []).map((d) => {
              const href = `/adhoc/explorer-dashboard?id=${d.id}`;
              const isSubActive =
                location.pathname === "/adhoc/explorer-dashboard" &&
                location.search.includes(d.id);
              return (
                <Link
                  key={`ed-${d.id}`}
                  to={href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1 text-[11px] transition-all hover:text-primary truncate",
                    isSubActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground/70 hover:bg-sidebar-accent/50",
                  )}
                >
                  <LayoutDashboard className="h-3 w-3 shrink-0" />
                  {d.name}
                </Link>
              );
            })}
            {(savedCharts ?? []).map((c) => {
              const href = `/adhoc/explorer?config=${c.id}`;
              const isSubActive =
                location.pathname === "/adhoc/explorer" &&
                location.search.includes(c.id);
              return (
                <Link
                  key={`sc-${c.id}`}
                  to={href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1 text-[11px] transition-all hover:text-primary truncate",
                    isSubActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground/70 hover:bg-sidebar-accent/50",
                  )}
                >
                  <BarChart3 className="h-3 w-3 shrink-0" />
                  {c.name}
                </Link>
              );
            })}
            <NewExplorerDashboardButton />
          </div>
        )}
    </>
  );
}

// --- Sidebar ---

export function Sidebar() {
  const location = useLocation();
  const { logout } = useAuth();

  const [cost, setCost] = useState(getTotalCost());
  const [bytes, setBytes] = useState(getTotalBytes());
  const [costOpen, setCostOpen] = useState(() => getTotalCost() > 50);
  const [dashOpen, setDashOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);

  const [light, setLight] = useState(() =>
    document.documentElement.classList.contains("light"),
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
    const saved = localStorage.getItem("sidebar-width");
    return saved ? Math.max(180, Math.min(480, Number(saved))) : 256;
  });
  const isResizing = useRef(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState(() => getHiddenDashboards());
  const [favoriteIds, setFavoriteIds] = useState(() => getFavoriteDashboards());
  const [dashboardOrderState, setDashboardOrderState] = useState(() =>
    getDashboardOrder(),
  );
  const [toolsOrderState, setToolsOrderState] = useState(() => getToolsOrder());

  const { data: savedCharts = [] } = useQuery({
    queryKey: ["explorer-configs-sidebar"],
    queryFn: fetchSavedCharts,
    staleTime: 30_000,
  });

  const { data: explorerDashboards = [] } = useQuery({
    queryKey: ["explorer-dashboards-sidebar"],
    queryFn: fetchExplorerDashboards,
    staleTime: 30_000,
  });

  const visibleDashboards = useMemo(() => {
    const filtered = dashboards.filter((d) => !hiddenIds.has(d.id));
    // If no custom order yet, sort favorites to top
    if (dashboardOrderState.length === 0) {
      return filtered.sort((a, b) => {
        const aFav = favoriteIds.has(a.id) ? 0 : 1;
        const bFav = favoriteIds.has(b.id) ? 0 : 1;
        return aFav - bFav;
      });
    }
    return applyOrder(filtered, dashboardOrderState);
  }, [hiddenIds, favoriteIds, dashboardOrderState]);

  const orderedTools = useMemo(
    () => applyOrder(defaultTools, toolsOrderState),
    [toolsOrderState],
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

  const handleToolsDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setToolsOrderState((prev) => {
        const ids = prev.length > 0 ? prev : orderedTools.map((t) => t.id);
        const oldIndex = ids.indexOf(active.id as string);
        const newIndex = ids.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const newOrder = arrayMove(ids, oldIndex, newIndex);
        setToolsOrder(newOrder);
        return newOrder;
      });
    },
    [orderedTools],
  );

  useEffect(() => {
    return subscribe(() => {
      const newCost = getTotalCost();
      setCost(newCost);
      setBytes(getTotalBytes());
      if (newCost > 50) setCostOpen(true);
    });
  }, []);

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
      style={{ width: sidebarWidth }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
      />
      <div className="flex h-14 items-center border-b border-border px-4 lg:h-[60px] lg:px-6">
        <Link
          to="/adhoc/overview"
          className="flex items-center gap-2 font-semibold"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 shrink-0"
          >
            <path
              d="M11.6875 5.11344C11.6875 4.29267 11.3633 3.5055 10.7862 2.92507C10.2091 2.34464 9.42642 2.01847 8.61023 2.01831L3.41156 2.01831C3.19673 2.01831 2.99071 2.10413 2.8388 2.25688C2.6869 2.40964 2.60156 2.61682 2.60156 2.83285C2.60156 3.668 4.36017 4.30193 4.36017 7.17646C4.36017 10.051 2.60156 10.6849 2.60156 11.5195C2.60156 11.7355 2.68688 11.9428 2.83877 12.0956C2.99065 12.2485 3.19668 12.3345 3.41156 12.3346H8.61023C9.20428 12.3345 9.7856 12.1615 10.284 11.8365C10.7825 11.5115 11.1768 11.0483 11.4193 10.503C11.6618 9.95765 11.7422 9.35339 11.6507 8.76312C11.5593 8.17285 11.3 7.6218 10.904 7.17646C11.4094 6.60957 11.6884 5.87478 11.6875 5.11344ZM3.67191 2.90255H8.61023C9.03981 2.90267 9.45995 3.02936 9.81874 3.26694C10.1775 3.50453 10.4592 3.84262 10.6291 4.23942C10.7989 4.63623 10.8494 5.07438 10.7743 5.49973C10.6993 5.92508 10.5019 6.31901 10.2067 6.63283L3.67191 2.90255ZM10.1627 10.8025C9.95932 11.0082 9.7174 11.1714 9.45093 11.2826C9.18446 11.3938 8.89873 11.4508 8.61023 11.4504H3.67372L10.2067 7.72009C10.6001 8.13829 10.8158 8.69429 10.8079 9.26991C10.8001 9.84553 10.5692 10.3954 10.1645 10.8025H10.1627ZM4.63017 9.88675C5.03255 9.04061 5.24078 8.11438 5.23947 7.17646C5.24083 6.23835 5.0326 5.31191 4.63017 4.46557L9.37743 7.17646L4.63017 9.88675Z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="0.33"
            />
          </svg>
          <span className="text-lg font-bold tracking-tight">Analytics</span>
        </Link>
      </div>
      <div className="flex-1 overflow-auto py-2">
        <nav className="grid items-start px-2 text-sm font-medium lg:px-4 space-y-1">
          {/* Home link */}
          <Link
            to="/"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              location.pathname === "/"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <Home className="h-4 w-4" />
            Guidelines
          </Link>

          {/* Overview link */}
          <Link
            to="/overview"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              location.pathname === "/overview"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <BarChart3 className="h-4 w-4" />
            Overview
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
            <FlaskConical className="h-4 w-4" />
            <span className="flex-1">Dashboards</span>
            <ChevronDown
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
                      setFavoriteIds={setFavoriteIds}
                      setDeletingId={setDeletingId}
                      setHiddenIds={setHiddenIds}
                    />
                  ))}
                  <NewDashboardDialog />
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Tools section */}
          <button
            onClick={() => setToolsOpen(!toolsOpen)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary text-left",
              location.pathname.startsWith("/adhoc/customer-health") ||
                location.pathname.startsWith("/adhoc/explorer") ||
                location.pathname === "/query"
                ? "text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <Wrench className="h-4 w-4" />
            <span className="flex-1">Tools</span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                !toolsOpen && "-rotate-90",
              )}
            />
          </button>

          {toolsOpen && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleToolsDragEnd}
            >
              <SortableContext
                items={orderedTools.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="ml-4 space-y-0.5">
                  {orderedTools.map((tool) => (
                    <SortableToolItem
                      key={tool.id}
                      tool={tool}
                      isActive={
                        location.pathname === tool.href ||
                        (tool.id === "explorer" &&
                          (location.pathname === "/adhoc/explorer" ||
                            location.pathname === "/adhoc/explorer-dashboard"))
                      }
                      savedCharts={
                        tool.id === "explorer" ? savedCharts : undefined
                      }
                      explorerDashboards={
                        tool.id === "explorer" ? explorerDashboards : undefined
                      }
                      location={location}
                    />
                  ))}
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
        <div className="rounded-lg bg-sidebar-accent/30">
          <button
            onClick={() => setCostOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1.5 w-full text-left cursor-pointer hover:bg-sidebar-accent/50 rounded-lg transition-colors"
          >
            <DollarSign
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                cost > 50 ? "text-destructive" : "text-muted-foreground",
              )}
            />
            <p className="text-xs font-medium flex-1">
              {formatCost(cost)}
              <span className="text-muted-foreground font-normal">
                {" "}
                session cost
              </span>
            </p>
            <ChevronDown
              className={cn(
                "h-3 w-3 text-muted-foreground transition-transform",
                !costOpen && "-rotate-90",
              )}
            />
          </button>
          {costOpen && (
            <div className="px-3 pb-1.5 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                {formatBytes(bytes)} queried
              </p>
              {bytes > 0 && (
                <button
                  onClick={resetSession}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title="Reset cost counter"
                >
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
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
        <FeedbackButton />
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center justify-between">
            <Popover open={logoutOpen} onOpenChange={setLogoutOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-all hover:text-primary cursor-pointer hover:bg-sidebar-accent/50">
                      <LogOut className="h-4 w-4" />
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
                    <Moon className="h-4 w-4" />
                  ) : (
                    <Sun className="h-4 w-4" />
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
