import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useLocation } from "react-router";
import { useTheme } from "next-themes";
import { cn, shortcutModifierLabel } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { toast } from "sonner";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  IconChartBar,
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
  IconArchive,
  IconHome,
  IconTemplate,
  IconFilter,
  IconBuilding,
  IconLock,
  IconLink,
  IconMessageCircle,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";
import { getIdToken } from "@/lib/auth";
import {
  dashboards,
  hideDashboard,
  getHiddenDashboards,
  getDashboardOrder,
  setDashboardOrder,
  type DashboardSubview,
} from "@/pages/adhoc/registry";

type SidebarDashboard = {
  id: string;
  name: string;
  subviews?: DashboardSubview[];
  source: "static" | "sql";
  visibility?: Visibility;
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Skeleton } from "@/components/ui/skeleton";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  DevDatabaseLink,
  FeedbackButton,
  appApiPath,
  appPath,
  useActionMutation,
  useChangeVersions,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { NewDashboardDialog } from "./NewDashboardDialog";
import { NewAnalysisDialog } from "./NewAnalysisDialog";
import { useUserPref } from "@/hooks/use-user-pref";
import {
  useDashboardViews,
  useDeleteDashboardView,
  type DashboardView,
} from "@/hooks/use-dashboard-views";
import { usePopularity, popularityOf } from "@/lib/item-popularity";
import {
  analysisDetailPrefetchKey,
  sqlDashboardPrefetchKey,
  type PrefetchSnapshot,
} from "@/lib/prefetch-keys";
import type { ResourceAccess } from "@/lib/resource-access";

type AnalysisHiddenFilter = "visible" | "hidden";

const SIDEBAR_PREVIEW_COUNT = 5;
const DASHBOARD_SORT_MODE_KEY = "dashboard-sort-mode";
const ANALYSIS_SORT_MODE_KEY = "analysis-sort-mode";
const DASHBOARDS_OPEN_KEY = "analytics-sidebar-dashboards-open";
const ANALYSES_OPEN_KEY = "analytics-sidebar-analyses-open";

type SidebarSortMode = "most-used" | "alphabetical" | "manual";

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

function getStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function setStoredBoolean(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage unavailable — ignore, section state is best-effort.
  }
}

function getStoredSortMode(key: string): SidebarSortMode {
  if (typeof window === "undefined") return "most-used";
  const raw = window.localStorage.getItem(key);
  if (raw === "alphabetical" || raw === "manual" || raw === "most-used") {
    return raw;
  }
  return "most-used";
}

function setStoredSortMode(key: string, value: SidebarSortMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable — ignore, sort mode is best-effort.
  }
}

function sortByName<T extends { id: string; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const name = a.name.localeCompare(b.name);
    return name !== 0 ? name : a.id.localeCompare(b.id);
  });
}

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

function SidebarSectionSortMenu({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SidebarSortMode;
  onChange: (value: SidebarSortMode) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/45 opacity-0 transition-all hover:bg-sidebar-accent hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover/section:opacity-100"
              aria-label={`${label} sort options`}
            >
              <IconSettings className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{`${label} sort`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-44">
        <DropdownMenuLabel className="text-xs">Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (
              next === "most-used" ||
              next === "alphabetical" ||
              next === "manual"
            ) {
              onChange(next);
            }
          }}
        >
          <DropdownMenuRadioItem value="most-used">
            Most used
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="alphabetical">
            Alphabetical
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="manual">
            Manual order
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Visibility types and helpers ---

type Visibility = "private" | "org" | "public";

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
  onArchive,
  onHide,
  onUnhide,
  hidden,
  onPrefetch,
  visibility,
  onSetVisibility,
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
  /** When provided, the menu shows Archive as the primary destructive action
   *  and Delete becomes a confirm-gated "Delete permanently". */
  onArchive?: () => Promise<void> | void;
  /** When provided, the menu shows a Hide item (and Unhide when `hidden`). */
  onHide?: () => Promise<void> | void;
  onUnhide?: () => Promise<void> | void;
  hidden?: boolean;
  onPrefetch?: () => void;
  visibility?: Visibility;
  onSetVisibility?: (visibility: Visibility) => Promise<void> | void;
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
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
    setConfirmDeleteOpen(false);
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

  const runArchive = useCallback(async () => {
    setMenuOpen(false);
    if (!onArchive) return;
    try {
      await onArchive();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Couldn't archive ${name}: ${e.message}`
          : `Couldn't archive ${name}`,
      );
    }
  }, [name, onArchive]);

  const runHide = useCallback(async () => {
    setMenuOpen(false);
    if (!onHide) return;
    try {
      await onHide();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Couldn't hide ${name}: ${e.message}`
          : `Couldn't hide ${name}`,
      );
    }
  }, [name, onHide]);

  const runUnhide = useCallback(async () => {
    setMenuOpen(false);
    if (!onUnhide) return;
    try {
      await onUnhide();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Couldn't unhide ${name}: ${e.message}`
          : `Couldn't unhide ${name}`,
      );
    }
  }, [name, onUnhide]);

  const runSetVisibility = useCallback(
    async (visibility: Visibility) => {
      setMenuOpen(false);
      if (!onSetVisibility) return;
      try {
        await onSetVisibility(visibility);
      } catch (e) {
        toast.error(
          e instanceof Error
            ? `Couldn't update visibility: ${e.message}`
            : "Couldn't update visibility",
        );
      }
    },
    [onSetVisibility],
  );

  const copyLink = useCallback(() => {
    const url = window.location.origin + href;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy link"),
    );
    setMenuOpen(false);
  }, [href]);

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
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={href}
                onFocus={onPrefetch}
                onMouseEnter={onPrefetch}
                onTouchStart={onPrefetch}
                className="min-w-0 flex-1 px-2 py-1.5 pr-12 text-xs transition-[padding] md:pr-2 md:group-hover/item:pr-12 md:group-focus-within/item:pr-12"
              >
                <span className="truncate">{name}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{name}</TooltipContent>
          </Tooltip>
        )}
        <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/item:opacity-100 md:group-focus-within/item:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggleFavorite(favoriteKey)}
                className={cn(
                  "pointer-events-auto rounded p-0.5 transition-colors",
                  isFav
                    ? "text-yellow-500"
                    : "text-muted-foreground/50 hover:text-yellow-500",
                )}
                aria-label={isFav ? "Unfavorite" : "Favorite"}
              >
                <IconStar className={cn("h-3 w-3", isFav && "fill-current")} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isFav ? "Unfavorite" : "Favorite"}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="pointer-events-auto rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                    aria-label={`${name} actions`}
                  >
                    <IconDots className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{`${name} actions`}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="right" align="start" className="w-44">
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(name);
                  setIsRenaming(true);
                }}
              >
                <IconPencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              {onSetVisibility && visibility !== undefined && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    void runSetVisibility(
                      visibility === "private" ? "org" : "private",
                    );
                  }}
                >
                  {visibility === "private" ? (
                    <IconBuilding className="mr-2 h-3.5 w-3.5" />
                  ) : (
                    <IconLock className="mr-2 h-3.5 w-3.5" />
                  )}
                  {visibility === "private" ? "Share with org" : "Make private"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={copyLink}>
                <IconLink className="mr-2 h-3.5 w-3.5" />
                Copy link
              </DropdownMenuItem>
              {onUnhide && hidden ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    void runUnhide();
                  }}
                >
                  <IconEye className="mr-2 h-3.5 w-3.5" />
                  Unhide
                </DropdownMenuItem>
              ) : onHide ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    void runHide();
                  }}
                >
                  <IconEyeOff className="mr-2 h-3.5 w-3.5" />
                  Hide
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              {onArchive ? (
                <>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      void runArchive();
                    }}
                  >
                    <IconArchive className="mr-2 h-3.5 w-3.5" />
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setMenuOpen(false);
                      setConfirmDeleteOpen(true);
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <IconTrash className="mr-2 h-3.5 w-3.5" />
                    Delete permanently
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setMenuOpen(false);
                    setConfirmDeleteOpen(true);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <IconTrash className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {children}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes &ldquo;{name}&rdquo; and cannot be
              undone.
              {onArchive
                ? " To keep it recoverable, choose Archive instead."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void runDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  onArchive,
  onPrefetch,
  views,
  onSetVisibility,
}: {
  d: SidebarDashboard;
  isActive: boolean;
  location: ReturnType<typeof useLocation>;
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  onDelete: (d: SidebarDashboard) => Promise<void>;
  onRename: (d: SidebarDashboard, name: string) => Promise<void>;
  onArchive?: (d: SidebarDashboard) => Promise<void>;
  onPrefetch?: (d: SidebarDashboard) => void;
  views?: DashboardView[];
  onSetVisibility?: (
    d: SidebarDashboard,
    visibility: Visibility,
  ) => Promise<void>;
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
      onArchive={onArchive ? () => onArchive(d) : undefined}
      onPrefetch={() => onPrefetch?.(d)}
      visibility={d.visibility}
      onSetVisibility={
        onSetVisibility ? (v) => onSetVisibility(d, v) : undefined
      }
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
                    <Tooltip>
                      <TooltipTrigger asChild>
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
                        >
                          <IconStar
                            className={cn(
                              "h-2.5 w-2.5",
                              favoriteIds.has(`view:${d.id}:${sv.id}`) &&
                                "fill-current",
                            )}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {favoriteIds.has(`view:${d.id}:${sv.id}`)
                          ? "Unfavorite"
                          : "Favorite"}
                      </TooltipContent>
                    </Tooltip>
                    <Popover
                      open={deletingViewId === sv.id}
                      onOpenChange={(open) =>
                        setDeletingViewId(open ? sv.id : null)
                      }
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <PopoverTrigger asChild>
                            <button className="opacity-0 group-hover/sv:opacity-100 p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-all shrink-0">
                              <IconTrash className="h-2.5 w-2.5" />
                            </button>
                          </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="right">{`Delete ${sv.name}`}</TooltipContent>
                      </Tooltip>
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

type SqlDashboardListItem = {
  id: string;
  name: string;
  visibility?: Visibility;
};

async function fetchSqlDashboards(): Promise<SqlDashboardListItem[]> {
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
      visibility:
        d.visibility === "org" || d.visibility === "public"
          ? (d.visibility as Visibility)
          : ("private" as Visibility),
    }));
}

async function fetchSidebarAnalyses(
  hidden: AnalysisHiddenFilter = "visible",
): Promise<
  {
    id: string;
    name: string;
    visibility: Visibility;
    hiddenAt: string | null;
  }[]
> {
  const token = await getIdToken();
  const path =
    hidden === "hidden" ? "/api/analyses?hidden=hidden" : "/api/analyses";
  const res = await fetch(appApiPath(path), {
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
      visibility:
        a.visibility === "org" || a.visibility === "public"
          ? a.visibility
          : ("private" as Visibility),
      hiddenAt: typeof a.hiddenAt === "string" ? a.hiddenAt : null,
    }));
}

type PrefetchedSqlDashboard = {
  id: string;
  config: {
    name: string;
    description?: string;
    filters?: unknown;
    variables?: unknown;
    columns?: number;
    panels: unknown[];
  };
  archivedAt: string | null;
  hiddenAt: string | null;
} & ResourceAccess;

async function fetchSqlDashboardForPrefetch(
  id: string,
): Promise<PrefetchedSqlDashboard | null> {
  const token = await getIdToken();
  const res = await fetch(appApiPath(`/api/sql-dashboards/${id}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Dashboard prefetch failed (${res.status})`);
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error("Dashboard prefetch returned invalid JSON");
  }
  return {
    id,
    config: {
      name:
        typeof data.name === "string" && data.name.trim().length > 0
          ? data.name
          : "Untitled Dashboard",
      description: data.description,
      filters: data.filters,
      variables: data.variables,
      columns: typeof data.columns === "number" ? data.columns : undefined,
      panels: Array.isArray(data.panels) ? data.panels : [],
    },
    archivedAt: typeof data.archivedAt === "string" ? data.archivedAt : null,
    hiddenAt: typeof data.hiddenAt === "string" ? data.hiddenAt : null,
    role: typeof data.role === "string" ? data.role : undefined,
    canEdit: typeof data.canEdit === "boolean" ? data.canEdit : undefined,
    canManage: typeof data.canManage === "boolean" ? data.canManage : undefined,
  };
}

async function fetchAnalysisDetailForPrefetch(id: string): Promise<unknown> {
  const token = await getIdToken();
  const res = await fetch(appApiPath(`/api/analyses/${id}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Analysis prefetch failed (${res.status})`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error("Analysis prefetch returned invalid JSON");
  }
}

function getQuerySnapshots<T>(queryClient: QueryClient, queryKey: QueryKey) {
  return queryClient.getQueriesData<T>({ queryKey });
}

function restoreQuerySnapshots<T>(
  queryClient: QueryClient,
  snapshots: Array<[QueryKey, T | undefined]>,
) {
  for (const [key, data] of snapshots) {
    queryClient.setQueryData(key, data);
  }
}

function persistThemePreference(theme: "light" | "dark") {
  fetch(appApiPath("/api/theme"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  }).catch(() => {});
}

// --- Sidebar ---

export function Sidebar({ mobile }: { mobile?: boolean } = {}) {
  const location = useLocation();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();

  const [dashOpen, setDashOpen] = useState(() =>
    getStoredBoolean(DASHBOARDS_OPEN_KEY, true),
  );
  const [dashShowAll, setDashShowAll] = useState(false);
  const [dashFilter, setDashFilter] = useState<"all" | "org">("all");
  const [analysesOpen, setAnalysesOpen] = useState(() =>
    getStoredBoolean(ANALYSES_OPEN_KEY, true),
  );
  const [analysesShowAll, setAnalysesShowAll] = useState(false);
  const [analysisFilter, setAnalysisFilter] = useState<"all" | "org">("all");
  const [analysisHiddenFilter, setAnalysisHiddenFilter] =
    useState<AnalysisHiddenFilter>("visible");
  const [dashboardSortMode, setDashboardSortModeState] =
    useState<SidebarSortMode>(() => getStoredSortMode(DASHBOARD_SORT_MODE_KEY));
  const [analysisSortMode, setAnalysisSortModeState] =
    useState<SidebarSortMode>(() => getStoredSortMode(ANALYSIS_SORT_MODE_KEY));
  const popularity = usePopularity();

  const light = resolvedTheme === "light";

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem("theme")) {
      return;
    }
    fetch(appApiPath("/api/theme"))
      .then((r) => r.json())
      .then((d) => {
        if (d.theme === "light" || d.theme === "dark") {
          setTheme(d.theme);
        }
      })
      .catch(() => {});
  }, [setTheme]);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { mutateAsync: renameDashboard } =
    useActionMutation("rename-dashboard");
  const { mutateAsync: renameAnalysis } = useActionMutation("rename-analysis");
  const { mutateAsync: hideAnalysisMut } = useActionMutation("hide-analysis");
  const { mutateAsync: setResourceVisibility } = useActionMutation(
    "set-resource-visibility",
  );
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

  const setDashboardSortMode = useCallback((mode: SidebarSortMode) => {
    setStoredSortMode(DASHBOARD_SORT_MODE_KEY, mode);
    setDashboardSortModeState(mode);
  }, []);

  const setAnalysisSortMode = useCallback((mode: SidebarSortMode) => {
    setStoredSortMode(ANALYSIS_SORT_MODE_KEY, mode);
    setAnalysisSortModeState(mode);
  }, []);

  const toggleDashOpen = useCallback(() => {
    setDashOpen((current) => {
      const next = !current;
      setStoredBoolean(DASHBOARDS_OPEN_KEY, next);
      return next;
    });
  }, []);

  const toggleAnalysesOpen = useCallback(() => {
    setAnalysesOpen((current) => {
      const next = !current;
      setStoredBoolean(ANALYSES_OPEN_KEY, next);
      return next;
    });
  }, []);

  // Fold per-source counters into sidebar list query keys so agent-driven
  // create/rename/archive/delete shows up without a manual refresh. We
  // depend on `action` too because the agent runner emits an `action`
  // event for every successful tool call — even when the matching
  // resource-table emit (`dashboards` / `analyses`) is missed (e.g. event
  // batching). See `use-change-version.ts` in @agent-native/core.
  const dashboardsSync = useChangeVersions(["dashboards", "action"]);
  const analysesSync = useChangeVersions(["analyses", "action"]);
  const dashboardsSyncRef = useRef(dashboardsSync);
  const analysesSyncRef = useRef(analysesSync);
  dashboardsSyncRef.current = dashboardsSync;
  analysesSyncRef.current = analysesSync;

  const { data: sqlDashboards = [], isLoading: sqlDashboardsLoading } =
    useQuery({
      queryKey: ["sql-dashboards-sidebar", dashboardsSync],
      queryFn: fetchSqlDashboards,
      staleTime: 30_000,
      placeholderData: (prev) => prev,
    });

  const { data: analysesList = [], isLoading: analysesLoading } = useQuery({
    queryKey: ["analyses-sidebar", analysesSync, analysisHiddenFilter],
    queryFn: () => fetchSidebarAnalyses(analysisHiddenFilter),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const sortedAnalyses = useMemo(() => {
    if (analysisSortMode === "alphabetical") {
      return sortByName(analysesList);
    }
    if (analysisSortMode === "manual" && analysisOrderState.length > 0) {
      return applyOrder(analysesList, analysisOrderState);
    }
    return [...analysesList].sort((a, b) => {
      const aFav = favoriteIds.has(`analysis:${a.id}`) ? 0 : 1;
      const bFav = favoriteIds.has(`analysis:${b.id}`) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      const aPop = popularityOf(popularity, "analysis", a.id);
      const bPop = popularityOf(popularity, "analysis", b.id);
      if (aPop !== bPop) return bPop - aPop;
      return a.name.localeCompare(b.name);
    });
  }, [
    analysesList,
    analysisSortMode,
    analysisOrderState,
    popularity,
    favoriteIds,
  ]);

  const filteredAnalyses = useMemo(
    () =>
      analysisFilter === "org"
        ? sortedAnalyses.filter(
            (a) => a.visibility === "org" || a.visibility === "public",
          )
        : sortedAnalyses,
    [sortedAnalyses, analysisFilter],
  );

  const displayedAnalyses = useMemo(
    () =>
      analysesShowAll
        ? filteredAnalyses
        : filteredAnalyses.slice(0, SIDEBAR_PREVIEW_COUNT),
    [filteredAnalyses, analysesShowAll],
  );

  const activeDashboardId = useMemo(() => {
    const match = location.pathname.match(/^\/adhoc\/([^/]+)/);
    if (!match?.[1]) return null;
    return new URLSearchParams(location.search).get("id") || match[1];
  }, [location.pathname, location.search]);

  // Only the active dashboard can display saved views in the sidebar, so avoid
  // issuing one request per dashboard on every sidebar mount.
  const { views: activeDashboardViews = [] } = useDashboardViews(
    activeDashboardId ?? undefined,
  );
  const allViewsMap = useMemo<Record<string, DashboardView[]>>(
    () =>
      activeDashboardId ? { [activeDashboardId]: activeDashboardViews } : {},
    [activeDashboardId, activeDashboardViews],
  );

  const prefetchDashboard = useCallback(
    (d: SidebarDashboard) => {
      if (d.source !== "sql") return;
      const queryKey = sqlDashboardPrefetchKey(d.id);
      const cached =
        queryClient.getQueryData<
          PrefetchSnapshot<PrefetchedSqlDashboard | null>
        >(queryKey);
      void import("@/pages/adhoc/sql-dashboard");
      void queryClient.prefetchQuery({
        queryKey,
        queryFn: async () => ({
          data: await fetchSqlDashboardForPrefetch(d.id),
          syncVersion: dashboardsSync,
        }),
        staleTime: cached?.syncVersion === dashboardsSync ? 30_000 : 0,
      });
    },
    [dashboardsSync, queryClient],
  );

  const prefetchAnalysis = useCallback(
    (id: string) => {
      const queryKey = analysisDetailPrefetchKey(id);
      const cached =
        queryClient.getQueryData<PrefetchSnapshot<unknown | null>>(queryKey);
      void import("@/pages/analyses/AnalysisDetail");
      void queryClient.prefetchQuery({
        queryKey,
        queryFn: async () => ({
          data: await fetchAnalysisDetailForPrefetch(id),
          syncVersion: analysesSync,
        }),
        staleTime: cached?.syncVersion === analysesSync ? 30_000 : 0,
      });
    },
    [analysesSync, queryClient],
  );

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
      visibility: d.visibility,
    }));
    const all = [...staticItems, ...sqlItems];
    if (dashboardSortMode === "alphabetical") {
      return sortByName(all);
    }
    if (dashboardSortMode === "manual" && dashboardOrderState.length > 0) {
      return applyOrder(all, dashboardOrderState);
    }
    return [...all].sort((a, b) => {
      const aFav = favoriteIds.has(a.id) ? 0 : 1;
      const bFav = favoriteIds.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      const aPop = popularityOf(popularity, "dashboard", a.id);
      const bPop = popularityOf(popularity, "dashboard", b.id);
      if (aPop !== bPop) return bPop - aPop;
      return a.name.localeCompare(b.name);
    });
  }, [
    hiddenIds,
    staticDashboardRenames,
    favoriteIds,
    dashboardSortMode,
    dashboardOrderState,
    sqlDashboards,
    popularity,
  ]);

  const filteredDashboards = useMemo(
    () =>
      dashFilter === "org"
        ? visibleDashboards.filter(
            (d) => d.visibility === "org" || d.visibility === "public",
          )
        : visibleDashboards,
    [visibleDashboards, dashFilter],
  );

  const displayedDashboards = useMemo(
    () =>
      dashShowAll
        ? filteredDashboards
        : filteredDashboards.slice(0, SIDEBAR_PREVIEW_COUNT),
    [filteredDashboards, dashShowAll],
  );

  const handleDashboardDelete = useCallback(
    async (d: SidebarDashboard) => {
      if (d.source === "static") {
        hideDashboard(d.id);
        setHiddenIds(getHiddenDashboards());
        return;
      }
      // Optimistic: remove from the sidebar query cache immediately so the row
      // disappears without waiting for the DELETE round-trip. Snapshot the
      // prior value so we can roll back on failure.
      const activeKey = ["sql-dashboards-sidebar"] as const;
      const prevActive = getQuerySnapshots<SqlDashboardListItem[]>(
        queryClient,
        activeKey,
      );
      queryClient.setQueriesData<SqlDashboardListItem[]>(
        { queryKey: activeKey },
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
        queryClient.removeQueries({ queryKey: sqlDashboardPrefetchKey(d.id) });
        queryClient.invalidateQueries({ queryKey: activeKey });
      } catch (err) {
        restoreQuerySnapshots(queryClient, prevActive);
        throw err;
      }
    },
    [queryClient],
  );

  const handleDashboardArchive = useCallback(
    async (d: SidebarDashboard) => {
      if (d.source === "static") {
        // Static dashboards can only be hidden, not archived; route to delete
        // (which calls hideDashboard for static items).
        hideDashboard(d.id);
        setHiddenIds(getHiddenDashboards());
        return;
      }
      const activeKey = ["sql-dashboards-sidebar"] as const;
      const prevActive = getQuerySnapshots<SqlDashboardListItem[]>(
        queryClient,
        activeKey,
      );
      queryClient.setQueriesData<SqlDashboardListItem[]>(
        { queryKey: activeKey },
        (old) => (old ?? []).filter((item) => item.id !== d.id),
      );
      try {
        const token = await getIdToken();
        const res = await fetch(
          appApiPath(`/api/sql-dashboards/${d.id}/archive`),
          {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!res.ok) throw new Error(`archive failed: ${res.status}`);
        queryClient.removeQueries({ queryKey: sqlDashboardPrefetchKey(d.id) });
        queryClient.invalidateQueries({ queryKey: activeKey });
        toast.success(`Archived "${d.name}"`);
      } catch (err) {
        restoreQuerySnapshots(queryClient, prevActive);
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
      const prev = getQuerySnapshots<SqlDashboardListItem[]>(
        queryClient,
        queryKey,
      );
      queryClient.setQueriesData<SqlDashboardListItem[]>({ queryKey }, (old) =>
        (old ?? []).map((item) =>
          item.id === d.id ? { ...item, name: trimmed } : item,
        ),
      );
      try {
        await renameDashboard({ id: d.id, name: trimmed });
        queryClient.removeQueries({ queryKey: sqlDashboardPrefetchKey(d.id) });
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({
          queryKey: ["sql-dashboards-palette"],
        });
      } catch (err) {
        restoreQuerySnapshots(queryClient, prev);
        throw err;
      }
    },
    [queryClient, renameDashboard],
  );

  const handleAnalysisDelete = useCallback(
    async (a: { id: string; name: string }) => {
      const queryKey = ["analyses-sidebar"] as const;
      const prev = getQuerySnapshots<{ id: string; name: string }[]>(
        queryClient,
        queryKey,
      );
      queryClient.setQueriesData<{ id: string; name: string }[]>(
        { queryKey },
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
        queryClient.removeQueries({
          queryKey: analysisDetailPrefetchKey(a.id),
        });
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ["analyses-list"] });
      } catch (err) {
        restoreQuerySnapshots(queryClient, prev);
        throw err;
      }
    },
    [queryClient],
  );

  const handleDashboardSetVisibility = useCallback(
    async (d: SidebarDashboard, visibility: Visibility) => {
      if (d.source === "static") return;
      const queryKey = [
        "sql-dashboards-sidebar",
        dashboardsSyncRef.current,
      ] as const;
      const prev = getQuerySnapshots<SqlDashboardListItem[]>(
        queryClient,
        queryKey,
      );
      queryClient.setQueriesData<SqlDashboardListItem[]>({ queryKey }, (old) =>
        (old ?? []).map((item) =>
          item.id === d.id ? { ...item, visibility } : item,
        ),
      );
      try {
        await setResourceVisibility({
          resourceType: "dashboard",
          resourceId: d.id,
          visibility,
        } as any);
        queryClient.invalidateQueries({ queryKey });
        toast.success(
          visibility === "org"
            ? `"${d.name}" shared with org`
            : `"${d.name}" made private`,
        );
      } catch (err) {
        restoreQuerySnapshots(queryClient, prev);
        throw err;
      }
    },
    [queryClient, setResourceVisibility],
  );

  const handleAnalysisSetVisibility = useCallback(
    async (a: { id: string; name: string }, visibility: Visibility) => {
      const sidebarKey = ["analyses-sidebar", analysesSyncRef.current] as const;
      const listKey = ["analyses-list"] as const;
      const prevSidebar = getQuerySnapshots<
        { id: string; name: string; visibility?: Visibility }[]
      >(queryClient, sidebarKey);
      const prevList = getQuerySnapshots<any[]>(queryClient, listKey);
      queryClient.setQueriesData<
        { id: string; name: string; visibility?: Visibility }[]
      >({ queryKey: sidebarKey }, (old) =>
        (old ?? []).map((item) =>
          item.id === a.id ? { ...item, visibility } : item,
        ),
      );
      queryClient.setQueriesData<any[]>({ queryKey: listKey }, (old) =>
        (old ?? []).map((item) =>
          item.id === a.id ? { ...item, visibility } : item,
        ),
      );
      try {
        await setResourceVisibility({
          resourceType: "analysis",
          resourceId: a.id,
          visibility,
        } as any);
        queryClient.invalidateQueries({ queryKey: sidebarKey });
        queryClient.invalidateQueries({ queryKey: listKey });
        toast.success(
          visibility === "org"
            ? `"${a.name}" shared with org`
            : `"${a.name}" made private`,
        );
      } catch (err) {
        restoreQuerySnapshots(queryClient, prevSidebar);
        restoreQuerySnapshots(queryClient, prevList);
        throw err;
      }
    },
    [queryClient, setResourceVisibility],
  );

  const handleAnalysisRename = useCallback(
    async (a: { id: string; name: string }, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === a.name) return;

      const sidebarKey = ["analyses-sidebar"] as const;
      const listKey = ["analyses-list"] as const;
      const detailKey = ["analysis-detail", a.id] as const;
      const prevSidebar = getQuerySnapshots<{ id: string; name: string }[]>(
        queryClient,
        sidebarKey,
      );
      const prevList = getQuerySnapshots<any[]>(queryClient, listKey);
      const prevDetail = getQuerySnapshots<any>(queryClient, detailKey);

      queryClient.setQueriesData<{ id: string; name: string }[]>(
        { queryKey: sidebarKey },
        (old) =>
          (old ?? []).map((item) =>
            item.id === a.id ? { ...item, name: trimmed } : item,
          ),
      );
      queryClient.setQueriesData<any[]>({ queryKey: listKey }, (old) =>
        (old ?? []).map((item) =>
          item.id === a.id ? { ...item, name: trimmed } : item,
        ),
      );
      queryClient.setQueriesData<any>({ queryKey: detailKey }, (old) =>
        old ? { ...old, name: trimmed } : old,
      );

      try {
        await renameAnalysis({ id: a.id, name: trimmed });
        queryClient.removeQueries({
          queryKey: analysisDetailPrefetchKey(a.id),
        });
        queryClient.invalidateQueries({ queryKey: sidebarKey });
        queryClient.invalidateQueries({ queryKey: listKey });
        queryClient.invalidateQueries({ queryKey: detailKey });
      } catch (err) {
        restoreQuerySnapshots(queryClient, prevSidebar);
        restoreQuerySnapshots(queryClient, prevList);
        restoreQuerySnapshots(queryClient, prevDetail);
        throw err;
      }
    },
    [queryClient, renameAnalysis],
  );

  const handleAnalysisHide = useCallback(
    async (a: { id: string; name: string }) => {
      const sidebarKey = ["analyses-sidebar"] as const;
      const prev = getQuerySnapshots<{ id: string }[]>(queryClient, sidebarKey);
      // Optimistically drop it from the visible list (the hidden-filter
      // variant is invalidated below to pick it up).
      queryClient.setQueriesData<{ id: string }[]>(
        { queryKey: sidebarKey },
        (old) => (old ?? []).filter((item) => item.id !== a.id),
      );
      try {
        await hideAnalysisMut({ id: a.id, hidden: true });
        queryClient.invalidateQueries({ queryKey: sidebarKey });
        queryClient.invalidateQueries({ queryKey: ["analyses-list"] });
        toast.success(`"${a.name}" hidden`);
      } catch (err) {
        restoreQuerySnapshots(queryClient, prev);
        throw err;
      }
    },
    [queryClient, hideAnalysisMut],
  );

  const handleAnalysisUnhide = useCallback(
    async (a: { id: string; name: string }) => {
      const sidebarKey = ["analyses-sidebar"] as const;
      const prev = getQuerySnapshots<{ id: string }[]>(queryClient, sidebarKey);
      // Optimistically drop it from the hidden list (the visible variant is
      // invalidated below to pick it up).
      queryClient.setQueriesData<{ id: string }[]>(
        { queryKey: sidebarKey },
        (old) => (old ?? []).filter((item) => item.id !== a.id),
      );
      try {
        await hideAnalysisMut({ id: a.id, hidden: false });
        queryClient.invalidateQueries({ queryKey: sidebarKey });
        queryClient.invalidateQueries({ queryKey: ["analyses-list"] });
        toast.success(`"${a.name}" unhidden`);
      } catch (err) {
        restoreQuerySnapshots(queryClient, prev);
        throw err;
      }
    },
    [queryClient, hideAnalysisMut],
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
      setDashboardSortMode("manual");
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
    [setDashboardSortMode, visibleDashboards],
  );

  const handleAnalysisDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setAnalysisSortMode("manual");
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
    [setAnalysisSortMode, sortedAnalyses],
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-2">
        <nav className="grid min-w-0 items-start px-2 text-sm font-medium lg:px-4 space-y-1">
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
            <IconHome className="h-4 w-4" />
            Overview
          </Link>

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

          {/* Catalog link */}
          <Link
            to="/catalog"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              location.pathname === "/catalog"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <IconTemplate className="h-4 w-4" />
            Catalog
          </Link>

          {/* Ask link */}
          <Link
            to="/ask"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary",
              location.pathname === "/ask"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <IconMessageCircle className="h-4 w-4" />
            Ask
          </Link>

          {/* Dashboards section */}
          <div
            className={cn(
              "group/section flex w-full min-w-0 items-center rounded-lg transition-all hover:text-primary",
              isAdhocActive
                ? "text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <button
              type="button"
              onClick={toggleDashOpen}
              className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
              aria-expanded={dashOpen}
            >
              <IconChartBar className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Dashboards</span>
            </button>
            <SidebarSectionSortMenu
              label="Dashboards"
              value={dashboardSortMode}
              onChange={setDashboardSortMode}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() =>
                    setDashFilter((f) => (f === "all" ? "org" : "all"))
                  }
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
                    dashFilter === "org"
                      ? "text-blue-400"
                      : "text-muted-foreground/45 opacity-0 hover:bg-sidebar-accent hover:text-foreground group-hover/section:opacity-100",
                  )}
                  aria-label={
                    dashFilter === "org"
                      ? "Showing org-shared only"
                      : "Filter by org-shared"
                  }
                >
                  <IconFilter className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {dashFilter === "org"
                  ? "Showing org-shared (click for all)"
                  : "Show org-shared only"}
              </TooltipContent>
            </Tooltip>
            <button
              type="button"
              onClick={toggleDashOpen}
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
              aria-label={
                dashOpen ? "Collapse dashboards" : "Expand dashboards"
              }
            >
              <IconChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  !dashOpen && "-rotate-90",
                )}
              />
            </button>
          </div>

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
                      isActive={activeDashboardId === d.id}
                      location={location}
                      favoriteIds={favoriteIds}
                      onToggleFavorite={toggleFavorite}
                      onDelete={handleDashboardDelete}
                      onRename={handleDashboardRename}
                      onArchive={handleDashboardArchive}
                      onSetVisibility={handleDashboardSetVisibility}
                      onPrefetch={prefetchDashboard}
                      views={allViewsMap[d.id]}
                    />
                  ))}
                  {filteredDashboards.length > SIDEBAR_PREVIEW_COUNT && (
                    <button
                      onClick={() => setDashShowAll(!dashShowAll)}
                      className="flex items-center gap-1 px-3 py-1 text-[11px] text-muted-foreground/70 hover:text-primary"
                    >
                      {dashShowAll
                        ? "Show less"
                        : `Show ${filteredDashboards.length - SIDEBAR_PREVIEW_COUNT} more`}
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
          <div
            className={cn(
              "group/section flex w-full min-w-0 items-center rounded-lg transition-all hover:text-primary",
              location.pathname.startsWith("/analyses")
                ? "text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <button
              type="button"
              onClick={toggleAnalysesOpen}
              className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
              aria-expanded={analysesOpen}
            >
              <IconReportAnalytics className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Analyses</span>
            </button>
            <SidebarSectionSortMenu
              label="Analyses"
              value={analysisSortMode}
              onChange={setAnalysisSortMode}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() =>
                    setAnalysisFilter((f) => (f === "all" ? "org" : "all"))
                  }
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
                    analysisFilter === "org"
                      ? "text-blue-400"
                      : "text-muted-foreground/45 opacity-0 hover:bg-sidebar-accent hover:text-foreground group-hover/section:opacity-100",
                  )}
                  aria-label={
                    analysisFilter === "org"
                      ? "Showing org-shared only"
                      : "Filter by org-shared"
                  }
                >
                  <IconFilter className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {analysisFilter === "org"
                  ? "Showing org-shared (click for all)"
                  : "Show org-shared only"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() =>
                    setAnalysisHiddenFilter((f) =>
                      f === "hidden" ? "visible" : "hidden",
                    )
                  }
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
                    analysisHiddenFilter === "hidden"
                      ? "text-blue-400"
                      : "text-muted-foreground/45 opacity-0 hover:bg-sidebar-accent hover:text-foreground group-hover/section:opacity-100",
                  )}
                  aria-label={
                    analysisHiddenFilter === "hidden"
                      ? "Showing hidden analyses"
                      : "Show hidden analyses"
                  }
                >
                  <IconEyeOff className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {analysisHiddenFilter === "hidden"
                  ? "Showing hidden (click for visible)"
                  : "Show hidden analyses"}
              </TooltipContent>
            </Tooltip>
            <button
              type="button"
              onClick={toggleAnalysesOpen}
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
              aria-label={
                analysesOpen ? "Collapse analyses" : "Expand analyses"
              }
            >
              <IconChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  !analysesOpen && "-rotate-90",
                )}
              />
            </button>
          </div>

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
                      hidden={analysisHiddenFilter === "hidden"}
                      onHide={
                        analysisHiddenFilter === "hidden"
                          ? undefined
                          : () => handleAnalysisHide(a)
                      }
                      onUnhide={
                        analysisHiddenFilter === "hidden"
                          ? () => handleAnalysisUnhide(a)
                          : undefined
                      }
                      visibility={a.visibility}
                      onSetVisibility={(v) => handleAnalysisSetVisibility(a, v)}
                      onPrefetch={() => prefetchAnalysis(a.id)}
                    />
                  ))}
                  {filteredAnalyses.length > SIDEBAR_PREVIEW_COUNT && (
                    <button
                      onClick={() => setAnalysesShowAll(!analysesShowAll)}
                      className="flex items-center gap-1 px-3 py-1 text-[11px] text-muted-foreground/70 hover:text-primary"
                    >
                      {analysesShowAll
                        ? "Show less"
                        : `Show ${filteredAnalyses.length - SIDEBAR_PREVIEW_COUNT} more`}
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
        </nav>

        <div className="mt-auto min-w-0 px-2 pt-2 text-sm font-medium lg:px-4">
          <nav className="grid min-w-0 items-start space-y-1 pb-1">
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

          <div className="min-w-0 border-t border-border/70">
            <ExtensionsSidebarSection />
          </div>

          <div className="space-y-2 border-t border-border/70 pt-2">
            <OrgSwitcher />
            <TooltipProvider delayDuration={200}>
              <div className="flex items-center gap-1">
                <DevDatabaseLink />
                <FeedbackButton className="min-w-0 flex-1" />
                <div className="flex shrink-0 items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("analytics:open-command-palette"),
                          )
                        }
                        aria-label="Search"
                        className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-all hover:text-primary cursor-pointer hover:bg-sidebar-accent/50"
                      >
                        <IconSearch className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Search ({shortcutModifierLabel()}+K)</p>
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
                    <PopoverContent
                      className="w-48 p-3"
                      side="top"
                      align="start"
                    >
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
                          const next = light ? "dark" : "light";
                          setTheme(next);
                          persistThemePreference(next);
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
              </div>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
