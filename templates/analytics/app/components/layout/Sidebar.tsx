import {
  IconChartBar,
  IconChevronDown,
  IconTrash,
  IconDots,
  IconLoader2,
  IconStar,
  IconPencil,
  IconSettings,
  IconFilter,
  IconGripVertical,
  IconBook2,
  IconDatabase,
  IconSearch,
  IconArchive,
  IconActivity,
  IconHeartbeat,
  IconPlus,
  IconLock,
  IconLink,
  IconMessageCircle,
  IconHierarchy2,
  IconUsersGroup,
  IconEye,
  IconEyeOff,
  IconPlayerPlay,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  Fragment,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { getIdToken } from "@/lib/auth";
import { ANALYTICS_CHAT_STORAGE_KEY } from "@/lib/chat-handoff";
import { cn, shortcutModifierLabel } from "@/lib/utils";
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
  source: "static" | "sql" | "analysis";
  resourceId?: string;
  visibility?: Visibility;
  /** Id of the dashboard this one nests under in the sidebar, if any. */
  parentId?: string;
};

const SIDEBAR_SYNC_SETTLE_MS = 500;

function useSettledSyncVersion(version: number): number {
  const [settledVersion, setSettledVersion] = useState(version);
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setSettledVersion(version),
      SIDEBAR_SYNC_SETTLE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [version]);
  return settledVersion;
}
import {
  navigateWithAgentChatViewTransition,
  useChatThreads,
  type ChatThreadSummary,
} from "@agent-native/core/client/agent-chat";
import { appApiPath, appPath } from "@agent-native/core/client/api-path";
import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import {
  callAction,
  useActionMutation,
  useChangeVersions,
} from "@agent-native/core/client/hooks";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { OrgSwitcher } from "@agent-native/core/client/org";
import { FeedbackButton } from "@agent-native/core/client/ui";
import {
  ChatHistoryRail,
  type ChatHistoryItem,
} from "@agent-native/toolkit/chat-history";

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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  useDashboardViews,
  useDeleteDashboardView,
  type DashboardView,
} from "@/hooks/use-dashboard-views";
import { useUserPref } from "@/hooks/use-user-pref";
import { shouldRenderDashboardList } from "@/lib/dashboard-list-loading";
import { usePopularity, popularityOf } from "@/lib/item-popularity";
import {
  sqlDashboardPrefetchKey,
  type PrefetchSnapshot,
} from "@/lib/prefetch-keys";
import type { ResourceAccess } from "@/lib/resource-access";

import { NewDashboardDialog } from "./NewDashboardDialog";
import { SidebarLoadError } from "./SidebarLoadError";

const SIDEBAR_PREVIEW_COUNT = 5;
const ASK_OPEN_KEY = "analytics-sidebar-ask-open";
const DASHBOARD_SORT_MODE_KEY = "dashboard-sort-mode";
const DASHBOARDS_OPEN_KEY = "analytics-sidebar-dashboards-open";
const SIDEBAR_COLLAPSE_KEY = "analytics.sidebar.collapsed";
const SIDEBAR_SKELETON_CLASS =
  "bg-sidebar-foreground/12 dark:bg-sidebar-foreground/10";

type SidebarSortMode = "most-used" | "alphabetical" | "manual";
type SidebarVisibilityFilter = "all" | "private" | "shared";

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
  {
    icon: IconHierarchy2,
    labelKey: "settings.agentTitle",
    href: "/agent",
  },
  { icon: IconSettings, labelKey: "navigation.settings", href: "/settings" },
];

function getStoredBooleanPreference(key: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // localStorage unavailable — ignore, section state is best-effort.
  }
  return null;
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

function matchesVisibilityFilter(
  item: { visibility?: Visibility },
  filter: SidebarVisibilityFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "private") {
    return item.visibility !== "org" && item.visibility !== "public";
  }
  return item.visibility === "org" || item.visibility === "public";
}

function SidebarSectionSettingsPopover({
  label,
  sortMode,
  onSortModeChange,
  visibilityFilter,
  onVisibilityFilterChange,
  showHidden,
  onShowHiddenChange,
}: {
  label: string;
  sortMode: SidebarSortMode;
  onSortModeChange: (value: SidebarSortMode) => void;
  visibilityFilter: SidebarVisibilityFilter;
  onVisibilityFilterChange: (value: SidebarVisibilityFilter) => void;
  showHidden?: boolean;
  onShowHiddenChange?: (value: boolean) => void;
}) {
  const t = useT();
  const settingsLabel = t("sidebar.sectionSettings", { label });
  const segmentedItemClass =
    "h-7 rounded px-2 text-[11px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground data-[state=on]:bg-sidebar-accent data-[state=on]:text-foreground data-[state=on]:shadow-sm";
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/65 opacity-0 transition-[opacity,color,background-color] hover:bg-sidebar-accent hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover/section:opacity-100 data-[state=open]:opacity-100"
              aria-label={settingsLabel}
            >
              <IconFilter className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{settingsLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="start" className="w-64 p-2">
        <div className="px-2 pb-2">
          <p className="text-xs font-medium text-foreground">{label}</p>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("sidebar.show")}
            </p>
            <ToggleGroup
              type="single"
              value={visibilityFilter}
              onValueChange={(next) => {
                if (next === "all" || next === "private" || next === "shared") {
                  onVisibilityFilterChange(next);
                }
              }}
              className="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-background/50 p-1"
            >
              <ToggleGroupItem
                value="all"
                aria-label={t("sidebar.visibilityAllDescription")}
                className={segmentedItemClass}
              >
                {t("sidebar.visibilityAll")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="private"
                aria-label={t("sidebar.visibilityPrivateOnlyDescription")}
                className={segmentedItemClass}
              >
                {t("sidebar.visibilityPrivateOnly")}
              </ToggleGroupItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem
                    value="shared"
                    aria-label={t("sidebar.visibilitySharedOnlyDescription")}
                    className={segmentedItemClass}
                  >
                    {t("sidebar.visibilitySharedOnly")}
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("sidebar.visibilitySharedOnlyDescription")}
                </TooltipContent>
              </Tooltip>
            </ToggleGroup>
          </div>
          <div className="grid gap-1.5">
            <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("sidebar.sortBy")}
            </p>
            <ToggleGroup
              type="single"
              value={sortMode}
              onValueChange={(next) => {
                if (
                  next === "most-used" ||
                  next === "alphabetical" ||
                  next === "manual"
                ) {
                  onSortModeChange(next);
                }
              }}
              className="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-background/50 p-1"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToggleGroupItem
                    value="most-used"
                    aria-label={t("sidebar.sortMostUsedPersonal")}
                    className={segmentedItemClass}
                  >
                    {t("sidebar.used")}
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("sidebar.usedExplainer")}
                </TooltipContent>
              </Tooltip>
              <ToggleGroupItem
                value="alphabetical"
                aria-label={t("sidebar.sortAlphabetically")}
                className={segmentedItemClass}
              >
                {t("sidebar.alphabetical")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="manual"
                aria-label={t("sidebar.sortManually")}
                className={segmentedItemClass}
              >
                {t("sidebar.manual")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid gap-1">
            {onShowHiddenChange && showHidden !== undefined && (
              <label
                htmlFor={`${label.toLowerCase()}-hidden-filter`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-sidebar-accent/60"
              >
                <span className="min-w-0 truncate">
                  {t("sidebar.hiddenAnalyses")}
                </span>
                <Switch
                  id={`${label.toLowerCase()}-hidden-filter`}
                  checked={showHidden}
                  onCheckedChange={onShowHiddenChange}
                  aria-label={`${label} ${t("sidebar.hiddenAnalyses")}`}
                />
              </label>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
  const t = useT();
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
          ? t("sidebar.renameFailedWithMessage", {
              name,
              message: e.message,
            })
          : t("sidebar.renameFailed", { name }),
      );
    }
  }, [name, onRename, renameValue, t]);

  const runDelete = useCallback(async () => {
    setMenuOpen(false);
    setConfirmDeleteOpen(false);
    try {
      await onDelete();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? t("sidebar.deleteFailedWithMessage", {
              name,
              message: e.message,
            })
          : t("sidebar.deleteFailed", { name }),
      );
    }
  }, [name, onDelete, t]);

  const runArchive = useCallback(async () => {
    setMenuOpen(false);
    if (!onArchive) return;
    try {
      await onArchive();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? t("sidebar.archiveFailedWithMessage", {
              name,
              message: e.message,
            })
          : t("sidebar.archiveFailed", { name }),
      );
    }
  }, [name, onArchive, t]);

  const runHide = useCallback(async () => {
    setMenuOpen(false);
    if (!onHide) return;
    try {
      await onHide();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? t("sidebar.hideFailedWithMessage", {
              name,
              message: e.message,
            })
          : t("sidebar.hideFailed", { name }),
      );
    }
  }, [name, onHide, t]);

  const runUnhide = useCallback(async () => {
    setMenuOpen(false);
    if (!onUnhide) return;
    try {
      await onUnhide();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? t("sidebar.unhideFailedWithMessage", {
              name,
              message: e.message,
            })
          : t("sidebar.unhideFailed", { name }),
      );
    }
  }, [name, onUnhide, t]);

  const runSetVisibility = useCallback(
    async (visibility: Visibility) => {
      setMenuOpen(false);
      if (!onSetVisibility) return;
      try {
        await onSetVisibility(visibility);
      } catch (e) {
        toast.error(
          e instanceof Error
            ? t("sidebar.updateVisibilityFailedWithMessage", {
                message: e.message,
              })
            : t("sidebar.updateVisibilityFailed"),
        );
      }
    },
    [onSetVisibility, t],
  );

  const copyLink = useCallback(() => {
    const url = window.location.origin + href;
    navigator.clipboard.writeText(url).then(
      () => toast.success(t("sidebar.linkCopied")),
      () => toast.error(t("sidebar.copyLinkFailed")),
    );
    setMenuOpen(false);
  }, [href, t]);

  return (
    <div ref={setNodeRef} style={style} className="group/item relative min-w-0">
      <button
        type="button"
        className="absolute -start-4 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded p-1 text-muted-foreground/30 opacity-0 transition-[opacity,color] hover:text-muted-foreground/60 group-hover/item:opacity-100 active:cursor-grabbing"
        aria-label={t("sidebar.dragItemPersonal", { name })}
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
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 pe-12 text-xs outline-none"
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={href}
                onFocus={onPrefetch}
                onMouseEnter={onPrefetch}
                onTouchStart={onPrefetch}
                className="min-w-0 flex-1 px-2 py-1.5 pe-12 text-xs transition-[padding] md:pe-2 md:group-hover/item:pe-12 md:group-focus-within/item:pe-12"
              >
                <span className="block truncate">{name}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{name}</TooltipContent>
          </Tooltip>
        )}
        <div className="pointer-events-none absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/item:opacity-100 md:group-focus-within/item:opacity-100">
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
                aria-label={
                  isFav
                    ? t("sidebar.unfavoritePersonal")
                    : t("sidebar.favoritePersonal")
                }
              >
                <IconStar className={cn("h-3 w-3", isFav && "fill-current")} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isFav
                ? t("sidebar.unfavoritePersonal")
                : t("sidebar.favoritePersonal")}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="pointer-events-auto rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                    aria-label={t("sidebar.itemActions", { name })}
                  >
                    <IconDots className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t("sidebar.itemActions", { name })}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="right" align="start" className="w-44">
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(name);
                  setIsRenaming(true);
                }}
              >
                <IconPencil className="me-2 h-3.5 w-3.5" />
                {t("sidebar.rename")}
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
                    <IconUsersGroup className="me-2 h-3.5 w-3.5" />
                  ) : (
                    <IconLock className="me-2 h-3.5 w-3.5" />
                  )}
                  {visibility === "private"
                    ? t("sidebar.shareWithOrg")
                    : t("sidebar.makePrivate")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={copyLink}>
                <IconLink className="me-2 h-3.5 w-3.5" />
                {t("sidebar.copyLink")}
              </DropdownMenuItem>
              {onUnhide && hidden ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    void runUnhide();
                  }}
                >
                  <IconEye className="me-2 h-3.5 w-3.5" />
                  {t("sidebar.unhide")}
                </DropdownMenuItem>
              ) : onHide ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    void runHide();
                  }}
                >
                  <IconEyeOff className="me-2 h-3.5 w-3.5" />
                  {t("sidebar.hide")}
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
                    <IconArchive className="me-2 h-3.5 w-3.5" />
                    {t("sidebar.archive")}
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
                    <IconTrash className="me-2 h-3.5 w-3.5" />
                    {t("sidebar.delete")}
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
                  <IconTrash className="me-2 h-3.5 w-3.5" />
                  {t("sidebar.delete")}
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
            <AlertDialogTitle>
              {t("sidebar.deletePermanentlyTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.deletePermanentlyDescription", { name })}
              {onArchive ? t("sidebar.deletePermanentlyArchiveHint") : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void runDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("sidebar.deletePermanently")}
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
  const resourceId = d.resourceId ?? d.id;
  const href =
    d.source === "analysis" ? `/analyses/${resourceId}` : `/dashboards/${d.id}`;
  const favoriteKey = d.source === "analysis" ? `analysis:${resourceId}` : d.id;
  const t = useT();
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
      favoriteKey={favoriteKey}
      name={d.name}
      href={href}
      isActive={isActive}
      favoriteIds={favoriteIds}
      onToggleFavorite={onToggleFavorite}
      onDelete={() => onDelete(d)}
      onRename={(name) => onRename(d, name)}
      onArchive={
        d.source === "analysis" || !onArchive ? undefined : () => onArchive(d)
      }
      onPrefetch={() => onPrefetch?.(d)}
      visibility={d.visibility}
      onSetVisibility={
        onSetVisibility ? (v) => onSetVisibility(d, v) : undefined
      }
    >
      {isActive && allSubviews.length > 0 && (
        <div className="ms-6 mt-0.5 space-y-0.5">
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
                  "group/sv flex items-center gap-1 rounded-md pe-1 transition-[opacity,color,background-color]",
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
                          type="button"
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
                          aria-label={
                            favoriteIds.has(`view:${d.id}:${sv.id}`)
                              ? t("sidebar.unfavoritePersonal")
                              : t("sidebar.favoritePersonal")
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
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {favoriteIds.has(`view:${d.id}:${sv.id}`)
                          ? t("sidebar.unfavoritePersonal")
                          : t("sidebar.favoritePersonal")}
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
                            <button className="opacity-0 group-hover/sv:opacity-100 p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-[opacity,color,background-color] shrink-0">
                              <IconTrash className="h-2.5 w-2.5" />
                            </button>
                          </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {t("sidebar.deleteView", { name: sv.name })}
                        </TooltipContent>
                      </Tooltip>
                      <PopoverContent
                        className="w-56 p-3"
                        side="right"
                        align="start"
                      >
                        <p className="text-sm mb-3">
                          {t("sidebar.deleteView", { name: sv.name })}
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
                                    ? t("sidebar.deleteViewFailedWithMessage", {
                                        message: err.message,
                                      })
                                    : t("sidebar.deleteViewFailed"),
                                );
                              }
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
                          >
                            {isDeleting && (
                              <IconLoader2 className="h-3 w-3 animate-spin" />
                            )}
                            {isDeleting
                              ? t("sidebar.deleting")
                              : t("sidebar.delete")}
                          </button>
                          <button
                            disabled={isDeleting}
                            onClick={() => setDeletingViewId(null)}
                            className="flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-sidebar-accent/50 transition-colors disabled:opacity-60"
                          >
                            {t("sidebar.cancel")}
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
  parentId?: string;
};

async function fetchSqlDashboards(
  t: (key: string) => string,
): Promise<SqlDashboardListItem[]> {
  const rows = await callAction("list-sql-dashboards", {}, { method: "GET" });
  return (Array.isArray(rows) ? rows : [])
    .filter((d: any) => d && typeof d.id === "string" && d.id.length > 0)
    .map((d: any) => ({
      id: d.id,
      name:
        typeof d.name === "string" && d.name.trim().length > 0
          ? d.name
          : t("sidebar.untitledDashboard"),
      visibility:
        d.visibility === "org" || d.visibility === "public"
          ? (d.visibility as Visibility)
          : ("private" as Visibility),
      parentId:
        typeof d.parentId === "string" && d.parentId.trim().length > 0
          ? d.parentId
          : undefined,
    }));
}

async function fetchSidebarAnalyses(t: (key: string) => string): Promise<
  {
    id: string;
    name: string;
    visibility: Visibility;
    hiddenAt: string | null;
  }[]
> {
  const rows = await callAction("list-analyses", {}, { method: "GET" });
  return (Array.isArray(rows) ? rows : [])
    .filter((a: any) => a && typeof a.id === "string" && a.id.length > 0)
    .map((a: any) => ({
      id: a.id,
      name:
        typeof a.name === "string" && a.name.trim().length > 0
          ? a.name
          : t("sidebar.untitledAnalysis"),
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
  hiddenBy: string | null;
  visibility: Visibility;
  ownerEmail: string | null;
  updatedAt: string | null;
} & ResourceAccess;

async function fetchSqlDashboardForPrefetch(
  id: string,
  t: (key: string) => string,
): Promise<PrefetchedSqlDashboard | null> {
  try {
    const data: any = await callAction(
      "get-sql-dashboard",
      { id, includeConfig: true },
      { method: "GET" },
    );
    if (!data || data.error) return null;
    return {
      id,
      config: {
        name:
          typeof data.name === "string" && data.name.trim().length > 0
            ? data.name
            : t("sidebar.untitledDashboard"),
        description: data.description,
        filters: data.filters,
        variables: data.variables,
        columns: typeof data.columns === "number" ? data.columns : undefined,
        panels: Array.isArray(data.panels) ? data.panels : [],
      },
      archivedAt: typeof data.archivedAt === "string" ? data.archivedAt : null,
      hiddenAt: typeof data.hiddenAt === "string" ? data.hiddenAt : null,
      hiddenBy: typeof data.hiddenBy === "string" ? data.hiddenBy : null,
      visibility:
        data.visibility === "org" || data.visibility === "public"
          ? data.visibility
          : "private",
      ownerEmail: typeof data.ownerEmail === "string" ? data.ownerEmail : null,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      role: typeof data.role === "string" ? data.role : undefined,
      canEdit: typeof data.canEdit === "boolean" ? data.canEdit : undefined,
      canManage:
        typeof data.canManage === "boolean" ? data.canManage : undefined,
    };
  } catch {
    return null;
  }
}

const ANALYTICS_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${ANALYTICS_CHAT_STORAGE_KEY}`;

function formatThreadAge(updatedAt: number) {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(updatedAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function threadTitle(thread: ChatThreadSummary, untitledLabel: string) {
  return thread.title || thread.preview || untitledLabel;
}

function threadUpdatedAt(thread: ChatThreadSummary) {
  return Number.isFinite(thread.updatedAt)
    ? thread.updatedAt
    : Number.isFinite(thread.createdAt)
      ? thread.createdAt
      : 0;
}

function compareThreads(a: ChatThreadSummary, b: ChatThreadSummary) {
  const aPinned = a.pinnedAt ?? 0;
  const bPinned = b.pinnedAt ?? 0;
  if (aPinned || bPinned) return bPinned - aPinned;
  return threadUpdatedAt(b) - threadUpdatedAt(a);
}

function persistedAnalyticsThreadId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ANALYTICS_ACTIVE_THREAD_KEY);
  } catch {
    return null;
  }
}

function AnalyticsChatsSection({ isAskRoute }: { isAskRoute: boolean }) {
  const navigate = useNavigate();
  const t = useT();
  const {
    threads,
    activeThreadId,
    isLoading: chatsLoading,
    createThread,
    switchThread,
    pinThread,
    archiveThread,
    renameThread,
    refreshThreads,
  } = useChatThreads(undefined, ANALYTICS_CHAT_STORAGE_KEY, undefined, {
    autoCreate: false,
    restoreActiveThread: false,
  });

  const visibleThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.messageCount > 0 && !thread.archivedAt)
        .sort(compareThreads)
        .slice(0, 15),
    [threads],
  );
  const chatItems = useMemo<ChatHistoryItem[]>(
    () =>
      visibleThreads.map((thread) => ({
        id: thread.id,
        title: threadTitle(thread, t("chat.untitledChat")),
        titleText: threadTitle(thread, t("chat.untitledChat")),
        timestamp:
          isAskRoute &&
          (thread.id === activeThreadId ||
            thread.id === persistedAnalyticsThreadId())
            ? undefined
            : formatThreadAge(threadUpdatedAt(thread)),
        pinned: Boolean(thread.pinnedAt),
      })),
    [activeThreadId, isAskRoute, t, visibleThreads],
  );
  const displayedActiveThreadId = isAskRoute
    ? (activeThreadId ?? persistedAnalyticsThreadId())
    : null;

  useEffect(() => {
    const refresh = () => refreshThreads();
    const handleRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { isRunning?: unknown }
        | undefined;
      if (typeof detail?.isRunning === "boolean") refreshThreads();
    };

    window.addEventListener("agent-chat:threads-updated", refresh);
    window.addEventListener("agentNative.chatRunning", handleRunning);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("agent-chat:threads-updated", refresh);
      window.removeEventListener("agentNative.chatRunning", handleRunning);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshThreads]);

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    navigateWithAgentChatViewTransition(navigate, "/ask");
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: options?.isNew === true },
        }),
      );
    });
  }

  async function handleNewChat() {
    const threadId = await createThread();
    if (threadId) openThread(threadId, { isNew: true });
  }

  async function handleArchiveThread(threadId: string) {
    const wasActive =
      threadId === activeThreadId || threadId === persistedAnalyticsThreadId();
    const archived = await archiveThread(threadId);
    if (!archived) {
      toast.error(t("chat.archiveFailed"));
      return;
    }
    if (wasActive) {
      await handleNewChat();
    }
  }

  function handleRenameThread(threadId: string, title: string) {
    void renameThread(threadId, title).then((renamed) => {
      if (!renamed) toast.error(t("chat.renameFailed"));
    });
  }

  return (
    <div className="ms-4 min-w-0 space-y-0.5">
      {chatsLoading &&
        visibleThreads.length === 0 &&
        Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`chat-skeleton-${i}`}
            className="flex items-center gap-2 px-3 py-1"
          >
            <Skeleton
              className={cn(
                "h-3.5 w-3.5 shrink-0 rounded-sm",
                SIDEBAR_SKELETON_CLASS,
              )}
            />
            <Skeleton
              className={cn("h-3 rounded", SIDEBAR_SKELETON_CLASS)}
              style={{ width: `${60 + ((i * 17) % 30)}%` }}
            />
          </div>
        ))}
      <ChatHistoryRail
        items={chatItems}
        activeId={displayedActiveThreadId}
        onSelect={(threadId) => openThread(threadId)}
        onNewChat={() => void handleNewChat()}
        railLabels={{
          newChat: t("chat.newChat"),
          showMore: t("sidebar.showMore", {
            count: Math.max(0, visibleThreads.length - SIDEBAR_PREVIEW_COUNT),
          }),
          showLess: t("sidebar.showLess"),
        }}
        renameMaxLength={160}
        onTogglePin={(threadId) => {
          const thread = visibleThreads.find((item) => item.id === threadId);
          if (thread) void pinThread(threadId, !thread.pinnedAt);
        }}
        onRename={handleRenameThread}
        onDelete={(threadId) => void handleArchiveThread(threadId)}
        labels={{
          options: (item) =>
            t("chat.optionsFor", { title: item.titleText ?? "" }),
          renameInput: (item) =>
            t("chat.renameThread", { title: item.titleText ?? "" }),
          rename: t("chat.renameChat"),
          pin: t("chat.pinChat"),
          unpin: t("chat.unpinChat"),
          delete: t("chat.archiveChat"),
        }}
        className="min-w-0"
      />
    </div>
  );
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

// --- Sidebar ---

export function Sidebar({ mobile }: { mobile?: boolean } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();

  const isAskRoute = location.pathname === "/ask";
  const activeDashboardId = useMemo(() => {
    const match = location.pathname.match(/^\/(?:adhoc|dashboards)\/([^/]+)/);
    if (!match?.[1]) return null;
    return new URLSearchParams(location.search).get("id") || match[1];
  }, [location.pathname, location.search]);
  const activeAnalysisId = useMemo(() => {
    const match = location.pathname.match(/^\/analyses\/([^/]+)/);
    return match?.[1] ?? null;
  }, [location.pathname]);
  const [askOpen, setAskOpen] = useState(
    () => getStoredBooleanPreference(ASK_OPEN_KEY) ?? isAskRoute,
  );
  const [dashOpen, setDashOpen] = useState(
    () =>
      getStoredBooleanPreference(DASHBOARDS_OPEN_KEY) ??
      activeDashboardId !== null,
  );
  const [dashShowAll, setDashShowAll] = useState(false);
  const [dashFilter, setDashFilter] = useState<SidebarVisibilityFilter>("all");
  const [dashboardSortMode, setDashboardSortModeState] =
    useState<SidebarSortMode>(() => getStoredSortMode(DASHBOARD_SORT_MODE_KEY));
  const { data: popularity, isReady: popularityReady } = usePopularity();

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
  const { mutateAsync: renameDashboard } =
    useActionMutation("rename-dashboard");
  const { mutateAsync: renameAnalysis } = useActionMutation("rename-analysis");
  const { mutateAsync: setResourceVisibility } = useActionMutation(
    "set-resource-visibility",
  );
  const { mutateAsync: deleteSqlDashboard } = useActionMutation(
    "delete-sql-dashboard",
    { method: "DELETE" },
  );
  const { mutateAsync: archiveDashboardMut } =
    useActionMutation("archive-dashboard");
  const { mutateAsync: deleteAnalysisMut } = useActionMutation(
    "delete-analysis",
    { method: "DELETE" },
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 256;
    const saved = localStorage.getItem("sidebar-width");
    return saved ? Math.max(180, Math.min(480, Number(saved))) : 256;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const effectiveCollapsed = Boolean(sidebarCollapsed && !mobile);
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
  // Server-backed favorites
  const {
    data: favoritesData,
    isLoading: favoritesLoading,
    save: saveFavorites,
  } = useUserPref<{
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

  useEffect(() => {
    if (getStoredBooleanPreference(ASK_OPEN_KEY) === null) {
      setAskOpen(isAskRoute);
    }
  }, [isAskRoute]);

  useEffect(() => {
    if (getStoredBooleanPreference(DASHBOARDS_OPEN_KEY) === null) {
      setDashOpen(activeDashboardId !== null);
    }
  }, [activeDashboardId]);

  const toggleAskOpen = useCallback(() => {
    setAskOpen((current) => {
      const next = !current;
      setStoredBoolean(ASK_OPEN_KEY, next);
      return next;
    });
  }, []);

  const toggleDashOpen = useCallback(() => {
    setDashOpen((current) => {
      const next = !current;
      setStoredBoolean(DASHBOARDS_OPEN_KEY, next);
      return next;
    });
  }, []);

  // Fold per-source counters into sidebar list query keys so agent-driven
  // create/rename/archive/delete shows up without a manual refresh. We
  // Domain counters keep these lists targeted. Folding the generic `action`
  // counter into the keys makes unrelated background work cancel and restart
  // both sidebar reads.
  const dashboardsSync = useSettledSyncVersion(
    useChangeVersions(["dashboards"]),
  );
  const analysesSync = useSettledSyncVersion(useChangeVersions(["analyses"]));
  const dashboardsSyncRef = useRef(dashboardsSync);
  dashboardsSyncRef.current = dashboardsSync;

  const {
    data: sqlDashboards = [],
    isLoading: sqlDashboardsLoading,
    isPlaceholderData: sqlDashboardsPlaceholder,
    isError: sqlDashboardsError,
    refetch: refetchSqlDashboards,
  } = useQuery({
    queryKey: ["sql-dashboards-sidebar", dashboardsSync],
    queryFn: () => fetchSqlDashboards(t),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const {
    data: analysesList = [],
    isLoading: analysesLoading,
    isError: analysesError,
    refetch: refetchAnalyses,
  } = useQuery({
    queryKey: ["analyses-sidebar", analysesSync],
    queryFn: () => fetchSidebarAnalyses(t),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

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
          data: await fetchSqlDashboardForPrefetch(d.id, t),
          syncVersion: dashboardsSync,
        }),
        staleTime: cached?.syncVersion === dashboardsSync ? 30_000 : 0,
      });
    },
    [dashboardsSync, queryClient, t],
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
      parentId: d.parentId,
    }));
    const analysisItems: SidebarDashboard[] = analysesList.map((a) => ({
      id: `analysis:${a.id}`,
      resourceId: a.id,
      name: a.name,
      source: "analysis",
      visibility: a.visibility,
    }));
    const all = [...staticItems, ...sqlItems, ...analysisItems];
    if (dashboardSortMode === "alphabetical") {
      return sortByName(all);
    }
    if (dashboardSortMode === "manual" && dashboardOrderState.length > 0) {
      return applyOrder(all, dashboardOrderState);
    }
    return [...all].sort((a, b) => {
      const aResourceId = a.resourceId ?? a.id;
      const bResourceId = b.resourceId ?? b.id;
      const aFavoriteKey =
        a.source === "analysis" ? `analysis:${aResourceId}` : a.id;
      const bFavoriteKey =
        b.source === "analysis" ? `analysis:${bResourceId}` : b.id;
      const aFav = favoriteIds.has(aFavoriteKey) ? 0 : 1;
      const bFav = favoriteIds.has(bFavoriteKey) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      const aPop = popularityOf(
        popularity,
        a.source === "analysis" ? "analysis" : "dashboard",
        aResourceId,
      );
      const bPop = popularityOf(
        popularity,
        b.source === "analysis" ? "analysis" : "dashboard",
        bResourceId,
      );
      if (aPop !== bPop) return bPop - aPop;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
  }, [
    hiddenIds,
    staticDashboardRenames,
    favoriteIds,
    dashboardSortMode,
    dashboardOrderState,
    sqlDashboards,
    analysesList,
    popularity,
  ]);

  const filteredDashboards = useMemo(
    () =>
      visibleDashboards.filter((dashboard) =>
        matchesVisibilityFilter(dashboard, dashFilter),
      ),
    [visibleDashboards, dashFilter],
  );

  // Group dashboards that declare a parentId beneath their parent. Nesting is
  // intentionally one level deep: a dashboard only nests when its parent is
  // itself top-level. Orphans (parent missing/filtered out), self-references,
  // cycles, and deeper descendants all fall back to top level so nothing is
  // ever hidden.
  const dashboardChildren = useMemo<Map<string, SidebarDashboard[]>>(() => {
    const byId = new Map(filteredDashboards.map((d) => [d.id, d]));
    const hasValidParent = (d: SidebarDashboard) =>
      !!d.parentId && d.parentId !== d.id && byId.has(d.parentId);
    const byParent = new Map<string, SidebarDashboard[]>();
    for (const d of filteredDashboards) {
      if (!hasValidParent(d)) continue;
      const parent = byId.get(d.parentId as string);
      if (!parent || hasValidParent(parent)) continue;
      const arr = byParent.get(d.parentId as string) ?? [];
      arr.push(d);
      byParent.set(d.parentId as string, arr);
    }
    return byParent;
  }, [filteredDashboards]);

  const topLevelDashboards = useMemo(() => {
    const childIds = new Set<string>();
    for (const arr of dashboardChildren.values())
      for (const c of arr) childIds.add(c.id);
    return filteredDashboards.filter((d) => !childIds.has(d.id));
  }, [filteredDashboards, dashboardChildren]);

  const displayedDashboards = useMemo(
    () =>
      dashShowAll
        ? topLevelDashboards
        : topLevelDashboards.slice(0, SIDEBAR_PREVIEW_COUNT),
    [topLevelDashboards, dashShowAll],
  );

  const dashboardListHasRendered = useRef(false);
  const dashboardListReady = shouldRenderDashboardList({
    sqlDashboardsLoading,
    sqlDashboardsPlaceholder,
    isInitialLoad: !dashboardListHasRendered.current,
    favoritesLoading,
    popularityReady,
    sortMode: dashboardSortMode,
  });
  useEffect(() => {
    if (dashboardListReady) dashboardListHasRendered.current = true;
  }, [dashboardListReady]);

  // The flattened id order exactly as rendered (each parent immediately
  // followed by its nested children). Drag reordering must use this so the
  // arrayMove indices match what the user sees; the raw `visibleDashboards`
  // order interleaves children at their sorted positions and would move the
  // wrong rows once a dashboard is nested.
  const dashboardRenderOrderIds = useMemo(
    () =>
      topLevelDashboards.flatMap((d) => [
        d.id,
        ...(dashboardChildren.get(d.id) ?? []).map((c) => c.id),
      ]),
    [topLevelDashboards, dashboardChildren],
  );

  const handleDashboardDelete = useCallback(
    async (d: SidebarDashboard) => {
      if (d.source === "analysis") {
        await deleteAnalysisMut({ id: d.resourceId ?? d.id });
        queryClient.invalidateQueries({ queryKey: ["analyses-sidebar"] });
        queryClient.invalidateQueries({ queryKey: ["analyses-list"] });
        return;
      }
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
        await deleteSqlDashboard({ id: d.id });
        queryClient.removeQueries({ queryKey: sqlDashboardPrefetchKey(d.id) });
        queryClient.invalidateQueries({ queryKey: activeKey });
      } catch (err) {
        restoreQuerySnapshots(queryClient, prevActive);
        throw err;
      }
    },
    [deleteAnalysisMut, deleteSqlDashboard, queryClient],
  );

  const handleDashboardArchive = useCallback(
    async (d: SidebarDashboard) => {
      if (d.source === "analysis") return;
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
        await archiveDashboardMut({ id: d.id, archived: true });
        queryClient.removeQueries({ queryKey: sqlDashboardPrefetchKey(d.id) });
        queryClient.invalidateQueries({ queryKey: activeKey });
        toast.success(t("sidebar.archivedName", { name: d.name }));
      } catch (err) {
        restoreQuerySnapshots(queryClient, prevActive);
        throw err;
      }
    },
    [queryClient, archiveDashboardMut, t],
  );

  const handleDashboardRename = useCallback(
    async (d: SidebarDashboard, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === d.name) return;

      if (d.source === "analysis") {
        await renameAnalysis({ id: d.resourceId ?? d.id, name: trimmed });
        queryClient.invalidateQueries({ queryKey: ["analyses-sidebar"] });
        queryClient.invalidateQueries({ queryKey: ["analyses-list"] });
        queryClient.invalidateQueries({
          queryKey: ["analysis-detail", d.resourceId ?? d.id],
        });
        return;
      }

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
    [queryClient, renameAnalysis, renameDashboard],
  );

  const handleDashboardSetVisibility = useCallback(
    async (d: SidebarDashboard, visibility: Visibility) => {
      if (d.source === "static") return;
      if (d.source === "analysis") {
        await setResourceVisibility({
          resourceType: "analysis",
          resourceId: d.resourceId ?? d.id,
          visibility,
        } as any);
        queryClient.invalidateQueries({ queryKey: ["analyses-sidebar"] });
        queryClient.invalidateQueries({ queryKey: ["analyses-list"] });
        toast.success(
          visibility === "org"
            ? t("sidebar.nameSharedWithOrg", { name: d.name })
            : t("sidebar.nameMadePrivate", { name: d.name }),
        );
        return;
      }
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
            ? t("sidebar.nameSharedWithOrg", { name: d.name })
            : t("sidebar.nameMadePrivate", { name: d.name }),
        );
      } catch (err) {
        restoreQuerySnapshots(queryClient, prev);
        throw err;
      }
    },
    [queryClient, setResourceVisibility, t],
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
      const ids = dashboardRenderOrderIds;
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      setDashboardSortMode("manual");
      const newOrder = arrayMove(ids, oldIndex, newIndex);
      setDashboardOrder(newOrder);
      setDashboardOrderState(newOrder);
    },
    [setDashboardSortMode, dashboardRenderOrderIds],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (effectiveCollapsed) return;
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
    [effectiveCollapsed, sidebarWidth],
  );

  const isAdhocActive =
    location.pathname.startsWith("/adhoc") ||
    location.pathname.startsWith("/dashboards") ||
    location.pathname.startsWith("/analyses");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSE_KEY,
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the in-memory preference still works.
    }
  }, [sidebarCollapsed]);

  const collapsedNavItems = [
    {
      icon: IconMessageCircle,
      label: t("navigation.ask"),
      href: "/ask",
      active: location.pathname === "/ask",
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (
          location.pathname !== "/ask" &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigateWithAgentChatViewTransition(navigate, "/ask");
        }
      },
    },
    {
      icon: IconChartBar,
      label: t("navigation.dashboards"),
      href: "/dashboards",
      active: isAdhocActive,
    },
    {
      icon: IconPlayerPlay,
      label: t("navigation.sessions"),
      href: "/sessions",
      active: location.pathname.startsWith("/sessions"),
    },
    {
      icon: IconHeartbeat,
      label: t("navigation.monitoring"),
      href: "/monitoring",
      active: location.pathname.startsWith("/monitoring"),
    },
    {
      icon: IconActivity,
      label: t("navigation.agents"),
      href: "/agents",
      active: location.pathname.startsWith("/agents"),
    },
    {
      icon: IconDatabase,
      label: t("navigation.dataSources"),
      href: "/data-sources",
      active: location.pathname === "/data-sources",
    },
    {
      icon: IconBook2,
      label: t("navigation.dataDictionary"),
      href: "/data-dictionary",
      active: location.pathname.startsWith("/data-dictionary"),
    },
    {
      icon: IconHierarchy2,
      label: t("settings.agentTitle"),
      href: "/agent",
      active: location.pathname === "/agent",
    },
    {
      icon: IconSettings,
      label: t("navigation.settings"),
      href: "/settings",
      active: location.pathname === "/settings",
    },
  ];

  return (
    <div
      className="relative flex h-full min-w-0 flex-col overflow-hidden border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out"
      style={
        mobile ? undefined : { width: effectiveCollapsed ? 48 : sidebarWidth }
      }
    >
      {!mobile && !effectiveCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute end-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
        />
      )}
      {effectiveCollapsed ? (
        <>
          <div className="flex h-12 shrink-0 items-center justify-center border-b border-border px-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label={t("sidebar.expandSidebar")}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
                >
                  <IconLayoutSidebarLeftExpand className="h-4 w-4 rtl:-scale-x-100" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t("sidebar.expandSidebar")}
              </TooltipContent>
            </Tooltip>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-1 py-2">
            {collapsedNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.href}
                      onClick={item.onClick}
                      aria-label={item.label}
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                        item.active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </>
      ) : (
        <>
          <div className="flex h-12 shrink-0 items-center border-b border-border px-4 lg:px-6">
            <Link
              to="/"
              className="flex min-w-0 flex-1 items-center gap-2 font-semibold"
            >
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
              <span className="text-lg font-bold tracking-tight">
                {t("navigation.brand")}
              </span>
            </Link>
            {!mobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(true)}
                    aria-label={t("sidebar.collapseSidebar")}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
                  >
                    <IconLayoutSidebarLeftCollapse className="h-4 w-4 rtl:-scale-x-100" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t("sidebar.collapseSidebar")}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-2">
            <nav className="grid min-w-0 items-start px-2 text-sm font-medium lg:px-4 space-y-1">
              {/* Ask section */}
              <div className="order-1 group/section min-w-0 space-y-1">
                <div
                  className={cn(
                    "flex w-full min-w-0 items-center rounded-lg transition-colors hover:text-primary",
                    isAskRoute
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50",
                  )}
                >
                  <Link
                    to="/ask"
                    onClick={(event) => {
                      if (
                        !isAskRoute &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.shiftKey &&
                        !event.altKey
                      ) {
                        event.preventDefault();
                        navigateWithAgentChatViewTransition(navigate, "/ask");
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2"
                  >
                    <IconMessageCircle className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {t("navigation.ask")}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={toggleAskOpen}
                    className="me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
                    aria-label={
                      askOpen
                        ? t("sidebar.collapseAsk")
                        : t("sidebar.expandAsk")
                    }
                    aria-expanded={askOpen}
                  >
                    <IconChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform",
                        !askOpen && "-rotate-90",
                      )}
                    />
                  </button>
                </div>
                {askOpen && <AnalyticsChatsSection isAskRoute={isAskRoute} />}
              </div>

              {/* Sessions link */}
              <Link
                to="/sessions"
                className={cn(
                  "order-4 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:text-primary",
                  location.pathname.startsWith("/sessions")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <IconPlayerPlay className="h-4 w-4" />
                {t("navigation.sessions")}
              </Link>

              {/* Monitoring link */}
              <Link
                to="/monitoring"
                className={cn(
                  "order-5 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:text-primary",
                  location.pathname.startsWith("/monitoring")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <IconHeartbeat className="h-4 w-4" />
                {t("navigation.monitoring")}
              </Link>

              {/* Agents link */}
              <Link
                to="/agents"
                className={cn(
                  "order-6 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:text-primary",
                  location.pathname.startsWith("/agents")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <IconActivity className="h-4 w-4" />
                {t("navigation.agents")}
              </Link>

              {/* Data Sources link */}
              <Link
                to="/data-sources"
                className={cn(
                  "order-7 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:text-primary",
                  location.pathname === "/data-sources"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <IconDatabase className="h-4 w-4" />
                {t("navigation.dataSources")}
              </Link>

              {/* Data Dictionary link */}
              <Link
                to="/data-dictionary"
                className={cn(
                  "order-8 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:text-primary",
                  location.pathname.startsWith("/data-dictionary")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <IconBook2 className="h-4 w-4" />
                {t("navigation.dataDictionary")}
              </Link>

              {/* Dashboards section */}
              <div className="order-2 group/section min-w-0 space-y-1">
                <div
                  className={cn(
                    "flex w-full min-w-0 items-center rounded-lg transition-colors hover:text-primary",
                    isAdhocActive
                      ? "text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={toggleDashOpen}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-start"
                    aria-expanded={dashOpen}
                  >
                    <IconChartBar className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {t("navigation.dashboards")}
                    </span>
                  </button>
                  <SidebarSectionSettingsPopover
                    label={t("navigation.dashboards")}
                    sortMode={dashboardSortMode}
                    onSortModeChange={setDashboardSortMode}
                    visibilityFilter={dashFilter}
                    onVisibilityFilterChange={setDashFilter}
                  />
                  <button
                    type="button"
                    onClick={toggleDashOpen}
                    className="me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
                    aria-label={
                      dashOpen
                        ? t("sidebar.collapseDashboards")
                        : t("sidebar.expandDashboards")
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
                      items={displayedDashboards.flatMap((d) => [
                        d.id,
                        ...(dashboardChildren.get(d.id) ?? []).map((c) => c.id),
                      ])}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="ms-4 min-w-0 space-y-0.5">
                        {dashboardListReady &&
                          displayedDashboards.map((d) => {
                            const children = dashboardChildren.get(d.id) ?? [];
                            return (
                              <Fragment key={d.id}>
                                <SortableDashboardItem
                                  d={d}
                                  isActive={
                                    d.source === "analysis"
                                      ? activeAnalysisId === d.resourceId
                                      : activeDashboardId === d.id
                                  }
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
                                {children.length > 0 && (
                                  <div className="ms-3 space-y-0.5 border-s border-sidebar-border/60 ps-1">
                                    {children.map((child) => (
                                      <SortableDashboardItem
                                        key={child.id}
                                        d={child}
                                        isActive={
                                          child.source === "analysis"
                                            ? activeAnalysisId ===
                                              child.resourceId
                                            : activeDashboardId === child.id
                                        }
                                        location={location}
                                        favoriteIds={favoriteIds}
                                        onToggleFavorite={toggleFavorite}
                                        onDelete={handleDashboardDelete}
                                        onRename={handleDashboardRename}
                                        onArchive={handleDashboardArchive}
                                        onSetVisibility={
                                          handleDashboardSetVisibility
                                        }
                                        onPrefetch={prefetchDashboard}
                                        views={allViewsMap[child.id]}
                                      />
                                    ))}
                                  </div>
                                )}
                              </Fragment>
                            );
                          })}
                        {dashboardListReady &&
                          topLevelDashboards.length > SIDEBAR_PREVIEW_COUNT && (
                            <button
                              onClick={() => setDashShowAll(!dashShowAll)}
                              className="flex items-center gap-1 px-3 py-1 text-[11px] text-muted-foreground/70 hover:text-primary"
                            >
                              {dashShowAll
                                ? t("sidebar.showLess")
                                : t("sidebar.showMore", {
                                    count:
                                      topLevelDashboards.length -
                                      SIDEBAR_PREVIEW_COUNT,
                                  })}
                            </button>
                          )}
                        {!dashboardListReady &&
                          Array.from({ length: 3 }).map((_, i) => (
                            <div
                              key={`sql-skeleton-${i}`}
                              className="flex items-center gap-2 px-3 py-1"
                            >
                              <Skeleton
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0 rounded-sm",
                                  SIDEBAR_SKELETON_CLASS,
                                )}
                              />
                              <Skeleton
                                className={cn(
                                  "h-3 rounded",
                                  SIDEBAR_SKELETON_CLASS,
                                )}
                                style={{ width: `${60 + ((i * 17) % 30)}%` }}
                              />
                            </div>
                          ))}
                        {sqlDashboardsError && sqlDashboards.length === 0 && (
                          <SidebarLoadError
                            message={t("sidebar.dashboardsLoadFailed")}
                            retryLabel={t("sidebar.retry")}
                            onRetry={() => void refetchSqlDashboards()}
                          />
                        )}
                        {analysesLoading && analysesList.length === 0 && (
                          <div className="flex items-center gap-2 px-3 py-1">
                            <Skeleton
                              className={cn(
                                "h-3.5 w-3.5 shrink-0 rounded-sm",
                                SIDEBAR_SKELETON_CLASS,
                              )}
                            />
                            <Skeleton
                              className={cn(
                                "h-3 w-3/4 rounded",
                                SIDEBAR_SKELETON_CLASS,
                              )}
                            />
                          </div>
                        )}
                        {analysesError && analysesList.length === 0 && (
                          <SidebarLoadError
                            message={t("sidebar.analysesLoadFailed")}
                            retryLabel={t("sidebar.retry")}
                            onRetry={() => void refetchAnalyses()}
                          />
                        )}
                        <NewDashboardDialog />
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
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
                        "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:text-primary",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/50",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {t(item.labelKey)}
                    </Link>
                  );
                })}
              </nav>

              <div className="space-y-2 pt-2">
                <OrgSwitcher />
                <TooltipProvider delayDuration={200}>
                  <div className="flex items-center justify-end gap-1">
                    <DevDatabaseLink />
                    <FeedbackButton className="min-w-0 flex-1" />
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent(
                                  "analytics:open-command-palette",
                                ),
                              )
                            }
                            aria-label={t("sidebar.search")}
                            className="flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:text-primary cursor-pointer hover:bg-sidebar-accent/50"
                          >
                            <IconSearch className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>
                            {t("sidebar.searchShortcut", {
                              shortcut: `${shortcutModifierLabel()}+K`,
                            })}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                      <LanguagePicker
                        variant="icon"
                        label={t("settings.languageLabel")}
                        className="[&_[data-language-picker-trigger]]:rounded-lg [&_[data-language-picker-trigger]]:border-0 [&_[data-language-picker-trigger]]:bg-transparent [&_[data-language-picker-trigger]]:text-muted-foreground [&_[data-language-picker-trigger]]:hover:bg-sidebar-accent/50 [&_[data-language-picker-trigger]]:hover:text-primary"
                      />
                    </div>
                  </div>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
