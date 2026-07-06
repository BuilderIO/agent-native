import {
  ShareButton,
  PresenceBar,
  useCollaborativeDoc,
  generateTabId,
  emailToColor,
  emailToName,
  useSession,
  agentNativePath,
  callAction,
  useChangeVersions,
  useActionMutation,
  useT,
  type CollabUser,
} from "@agent-native/core/client";
import {
  useDroppable,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  IconArchive,
  IconBuilding,
  IconClock,
  IconDotsVertical,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconInfoCircle,
  IconLock,
  IconMail,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUser,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  memo,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useSearchParams, useParams, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  DashboardTitleSkeleton,
  useSetPageTitle,
  useSetHeaderActions,
} from "@/components/layout/HeaderActions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDashboardViews } from "@/hooks/use-dashboard-views";
import { useUserPref } from "@/hooks/use-user-pref";
import { incrementItemView } from "@/lib/item-popularity";
import {
  sqlDashboardPrefetchKey,
  type PrefetchSnapshot,
} from "@/lib/prefetch-keys";
import {
  resourceCanEdit,
  resourceCanManage,
  type ResourceAccess,
} from "@/lib/resource-access";
import { ownerDisplayName, visibilityLabelKey } from "@/lib/resource-metadata";

import BlankDashboard from "../BlankDashboard";
import { DashboardSkeleton } from "../DashboardSkeleton";
import {
  availableDropSlotIdsForPanel,
  buildDashboardPanelGroups,
  columnExpansionForDropSlot,
  distanceFromPointerToRect,
  dropSlotId,
  movePanelToDropSlot,
  preferredDropSlotId,
  readDropSlot,
  removePanelFromLayout,
  sameDropSlot,
  type DashboardDropSlot,
} from "./dashboard-layout";
import {
  createDashboardAdoptionHold,
  dashboardPrefetchInitialData,
  shouldAdoptDashboardQueryResult,
  type DashboardAdoptionHold,
} from "./dashboard-sync";
import {
  DashboardFilterBar,
  FILTER_PARAM_PREFIX,
  extractFilterParams,
  resolveFilterVars,
} from "./DashboardFilterBar";
import { EmailReportDialog } from "./EmailReportDialog";
import { interpolate } from "./interpolate";
import { serializePanelSql } from "./panel-sql";
import { AddPanelPopover, PanelEditorDialog } from "./PanelEditorDialog";
import { SqlChartCard } from "./SqlChartCard";
import {
  clampDashboardColumns,
  DEFAULT_DASHBOARD_COLUMNS,
  type SqlDashboardConfig,
  type SqlPanel,
} from "./types";
import { ViewsMenu } from "./ViewsMenu";

const TAB_ID = generateTabId();

type DashboardTabGroup = {
  name: string;
  tabs: Array<{ value: string; label: string }>;
};

function groupDashboardTabs(tabs: string[]): {
  groups: DashboardTabGroup[];
  hasNestedTabs: boolean;
} {
  const hasNestedTabs = tabs.some((tab) => tab.includes(" / "));
  const groups: DashboardTabGroup[] = [];
  const byName = new Map<string, DashboardTabGroup>();

  for (const tab of tabs) {
    const [rawGroup, ...rest] = tab.split(/\s*\/\s*/);
    const name = hasNestedTabs && rest.length > 0 ? rawGroup : "Server";
    const label = hasNestedTabs && rest.length > 0 ? rest.join(" / ") : tab;
    let group = byName.get(name);
    if (!group) {
      group = { name, tabs: [] };
      byName.set(name, group);
      groups.push(group);
    }
    group.tabs.push({ value: tab, label });
  }

  return { groups, hasNestedTabs };
}

function parseReportPanelLimit(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(50, parsed);
}

function limitReportPanels(panels: SqlPanel[], limit: number | null) {
  if (!limit) return panels;
  const limited: SqlPanel[] = [];
  let chartCount = 0;

  for (const panel of panels) {
    if (panel.chartType === "section") {
      if (chartCount < limit) limited.push(panel);
      continue;
    }
    if (chartCount >= limit) continue;
    chartCount++;
    limited.push(panel);
  }

  return limited;
}

function DashboardDropLine({
  slot,
  activeSlot,
  disabled,
}: {
  slot: DashboardDropSlot;
  activeSlot: DashboardDropSlot | null;
  disabled: boolean;
}) {
  const { setNodeRef } = useDroppable({
    id: dropSlotId(slot),
    data: { slot },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      data-active={sameDropSlot(activeSlot, slot) ? "true" : undefined}
      className={
        slot.type === "row"
          ? "dashboard-row-drop-slot"
          : "dashboard-column-drop-slot"
      }
    />
  );
}

function DashboardDragPreview({ panel }: { panel: SqlPanel | null }) {
  if (!panel) return null;

  return (
    <div className="dashboard-drag-preview flex max-w-64 items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-sm font-medium text-foreground shadow-lg ring-1 ring-primary/20">
      <IconGripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{panel.title}</span>
    </div>
  );
}

/**
 * A single chart cell, memoized so that drag interactions — which re-render the
 * dashboard page on every drop-slot change — do NOT re-render every chart's
 * Recharts subtree. During a drag the panel, vars, remoteEditor, and the
 * stable callbacks below don't change, so React skips these cells entirely and
 * only the lightweight drop-line indicators update. This keeps dragging smooth
 * on dense dashboards. Outside a drag, prop changes (filter/vars edits, remote
 * collaborator highlights, panel edits) still re-render normally.
 */
const PanelCell = memo(function PanelCell({
  panel,
  vars,
  remoteEditor,
  editable,
  eagerLoad,
  isDragSource,
  onRemovePanel,
  onEditPanel,
  onSavePanel,
}: {
  panel: SqlPanel;
  vars: Record<string, string>;
  remoteEditor: { color: string; name: string } | undefined;
  editable: boolean;
  eagerLoad: boolean;
  isDragSource: boolean;
  onRemovePanel: (panelId: string) => void;
  onEditPanel: (panel: SqlPanel) => void;
  onSavePanel: (panel: SqlPanel) => Promise<void>;
}) {
  const resolved = useMemo(
    () =>
      panel.config?.description
        ? {
            ...panel,
            config: {
              ...panel.config,
              description: interpolate(panel.config.description, vars),
            },
          }
        : panel,
    [panel, vars],
  );
  const resolvedSql = useMemo(
    () => interpolate(serializePanelSql(panel.sql), vars),
    [panel.sql, vars],
  );

  return (
    <div
      className="dashboard-grid-cell relative h-full"
      style={
        remoteEditor
          ? {
              outline: `2px solid ${remoteEditor.color}`,
              outlineOffset: 2,
              borderRadius: 8,
            }
          : undefined
      }
    >
      {remoteEditor && (
        <span
          className="absolute -top-2.5 left-3 px-1.5 text-[10px] font-medium rounded z-10"
          style={{
            backgroundColor: remoteEditor.color,
            color: "#fff",
          }}
        >
          {remoteEditor.name}
        </span>
      )}
      <SqlChartCard
        panel={resolved}
        resolvedSql={resolvedSql}
        onRemove={() => onRemovePanel(panel.id)}
        onEdit={() => onEditPanel(panel)}
        onSaveSql={(sql) => onSavePanel({ ...panel, sql })}
        editable={editable}
        eagerLoad={eagerLoad}
        isDragSource={isDragSource}
      />
    </div>
  );
});

type FetchedDashboard = {
  id: string;
  config: SqlDashboardConfig;
  archivedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
  visibility: "private" | "org" | "public";
  ownerEmail: string | null;
  updatedAt: string | null;
} & ResourceAccess;

function parseDashboardDemoMetadata(
  value: unknown,
): SqlDashboardConfig["demo"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return typeof raw.id === "string" && raw.id
    ? {
        id: raw.id,
        version: typeof raw.version === "string" ? raw.version : undefined,
        installedAt:
          typeof raw.installedAt === "string" ? raw.installedAt : undefined,
      }
    : undefined;
}

function parseDashboardCatalogMetadata(
  value: unknown,
): SqlDashboardConfig["catalog"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return {
    templateId: typeof raw.templateId === "string" ? raw.templateId : undefined,
    templateVersion:
      typeof raw.templateVersion === "string" ? raw.templateVersion : undefined,
    installedAt:
      typeof raw.installedAt === "string" ? raw.installedAt : undefined,
  };
}

async function fetchDashboard(id: string): Promise<FetchedDashboard | null> {
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
        name: data.name ?? "Untitled Dashboard",
        description: data.description,
        parentId:
          typeof data.parentId === "string" && data.parentId.trim().length > 0
            ? data.parentId
            : undefined,
        catalog: parseDashboardCatalogMetadata(data.catalog),
        demo: parseDashboardDemoMetadata(data.demo),
        filters: data.filters,
        variables: data.variables,
        columns: typeof data.columns === "number" ? data.columns : undefined,
        panels: data.panels ?? [],
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

/**
 * Save dashboard config via the update-dashboard action. Throws on error so
 * callers (e.g. the panel editor dialog) can surface BigQuery validation
 * errors inline instead of silently swallowing them.
 */
async function saveDashboard(
  dashboardId: string,
  data: SqlDashboardConfig,
): Promise<void> {
  await callAction("update-dashboard", {
    dashboardId,
    config: data as unknown as Record<string, unknown>,
  });
}

export default function SqlDashboardPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: routeId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const dashboardId = searchParams.get("id") || routeId;
  const reportScreenshot = searchParams.get("reportScreenshot") === "1";
  const reportSettingsRequested = searchParams.get("reportSettings") === "1";
  const reportPanelLimit = reportScreenshot
    ? parseReportPanelLimit(searchParams.get("reportPanelLimit"))
    : null;

  const [dashboard, setDashboard] = useState<SqlDashboardConfig | null>(null);
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [hiddenAt, setHiddenAt] = useState<string | null>(null);
  const [dashboardVisibility, setDashboardVisibility] = useState<
    "private" | "org" | "public" | null
  >(null);
  const [dashboardOwner, setDashboardOwner] = useState<string | null>(null);
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState<string | null>(
    null,
  );
  const [resourceAccess, setResourceAccess] = useState<ResourceAccess | null>(
    null,
  );
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [emailReportOpen, setEmailReportOpen] = useState(false);
  const [activeDropSlot, setActiveDropSlot] =
    useState<DashboardDropSlot | null>(null);
  const [activeDragPanelId, setActiveDragPanelId] = useState<string | null>(
    null,
  );
  const viewedDashboardIdRef = useRef<string | null>(null);
  const pendingConfigRef = useRef<DashboardAdoptionHold | null>(null);
  const canEdit = !reportScreenshot && resourceCanEdit(resourceAccess);
  const canManage = !reportScreenshot && resourceCanManage(resourceAccess);
  const dashboardColumns = clampDashboardColumns(
    dashboard?.columns ?? DEFAULT_DASHBOARD_COLUMNS,
  );
  const isDemoDashboard = dashboard?.demo?.id === "demo-node-exporter";
  const showDemoIntro =
    isDemoDashboard && searchParams.get("demoIntro") === "1";
  const { mutateAsync: hideDashboardAction, isPending: unhidePending } =
    useActionMutation("hide-dashboard");
  const { mutateAsync: deleteDashboardAction } = useActionMutation(
    "delete-sql-dashboard",
    { method: "DELETE" },
  );
  const { mutateAsync: archiveDashboardAction } =
    useActionMutation("archive-dashboard");

  // Refetch the dashboard whenever the `dashboards` source bumps OR any
  // agent action runs. We depend on both because:
  // - `dashboards` covers same-process writes from upsertDashboard
  // - `action` covers every successful agent action and is emitted by the
  //   agent runner unconditionally, which makes the refresh resilient even
  //   if the dashboards-store emit is missed (different process, etc.).
  // Folding counters into the queryKey is the framework pattern for "agent
  // writes show up without a manual refresh"; see `use-change-version.ts`.
  const sync = useChangeVersions(["dashboards", "action"]);
  const dashboardQuery = useQuery({
    queryKey: ["data", "sql-dashboard", dashboardId, sync],
    enabled: !!dashboardId,
    queryFn: async () => {
      if (!dashboardId) return null;
      return fetchDashboard(dashboardId);
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    initialData: () => {
      if (!dashboardId) return undefined;
      const snapshot = queryClient.getQueryData<
        PrefetchSnapshot<FetchedDashboard | null>
      >(sqlDashboardPrefetchKey(dashboardId));
      return dashboardPrefetchInitialData(snapshot, sync);
    },
    initialDataUpdatedAt: () => {
      if (!dashboardId) return undefined;
      const queryKey = sqlDashboardPrefetchKey(dashboardId);
      const snapshot =
        queryClient.getQueryData<PrefetchSnapshot<FetchedDashboard | null>>(
          queryKey,
        );
      if (!snapshot) return undefined;
      if (snapshot.syncVersion !== sync) return undefined;
      return queryClient.getQueryState(queryKey)?.dataUpdatedAt;
    },
  });

  // Panel edit dialog state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPanel, setEditingPanel] = useState<SqlPanel | null>(null);

  // ── Collaborative editing ──────────────────────────────────────────
  const { session } = useSession();
  const currentUser: CollabUser | undefined =
    !reportScreenshot && session?.email
      ? {
          name: emailToName(session.email),
          email: session.email,
          color: emailToColor(session.email),
        }
      : undefined;

  const collabDocId =
    !reportScreenshot && dashboardId ? `dash-${dashboardId}` : null;
  const {
    ydoc,
    awareness,
    isSynced: collabSynced,
    activeUsers,
    agentActive,
    agentPresent,
  } = useCollaborativeDoc({
    docId: collabDocId,
    requestSource: TAB_ID,
    user: currentUser,
  });

  const updateCachedDashboardConfig = useCallback(
    (updated: SqlDashboardConfig) => {
      if (!dashboardId) return;
      queryClient.setQueriesData<FetchedDashboard | null>(
        { queryKey: ["data", "sql-dashboard", dashboardId] },
        (prev) => (prev ? { ...prev, config: updated } : prev),
      );
      queryClient.setQueryData<PrefetchSnapshot<FetchedDashboard | null>>(
        sqlDashboardPrefetchKey(dashboardId),
        (prev) =>
          prev?.data
            ? { ...prev, data: { ...prev.data, config: updated } }
            : prev,
      );
    },
    [dashboardId, queryClient],
  );

  const holdDashboardConfig = useCallback(() => {
    if (!dashboardId) return;
    pendingConfigRef.current = createDashboardAdoptionHold({
      dashboardId,
      currentUpdatedAt: dashboardUpdatedAt,
    });
    void queryClient.cancelQueries(
      { queryKey: ["data", "sql-dashboard", dashboardId] },
      { revert: false },
    );
  }, [dashboardId, dashboardUpdatedAt, queryClient]);

  // Track which panels remote users are editing (from awareness)
  const [remoteEditingPanels, setRemoteEditingPanels] = useState<
    Map<string, { color: string; name: string }>
  >(new Map());

  useEffect(() => {
    if (!awareness || !ydoc) return;
    const update = () => {
      const editing = new Map<string, { color: string; name: string }>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === ydoc.clientID) return;
        const panelId = state.editingPanelId;
        const user = state.user as CollabUser | undefined;
        if (panelId && typeof panelId === "string" && user) {
          editing.set(panelId, {
            color: user.color || emailToColor(user.email),
            name: user.name || emailToName(user.email),
          });
        }
      });
      setRemoteEditingPanels(editing);
    };
    awareness.on("change", update);
    return () => {
      awareness.off("change", update);
    };
  }, [awareness, ydoc]);

  // Listen for remote collab changes — when the Y.Text("content") changes
  // from a remote update, parse it and update dashboard state.
  useEffect(() => {
    if (!ydoc || !collabSynced) return;
    const ytext = ydoc.getText("content");
    const handler = () => {
      const raw = ytext.toString();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as SqlDashboardConfig;
        if (parsed && Array.isArray(parsed.panels)) {
          holdDashboardConfig();
          setDashboard(parsed);
          updateCachedDashboardConfig(parsed);
        }
      } catch {
        // JSON parse failed — ignore partial updates
      }
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ydoc, collabSynced, holdDashboardConfig, updateCachedDashboardConfig]);

  // Per-user saved filter state
  const filterPrefKey = dashboardId ? `dashboard-filters:${dashboardId}` : "";
  const {
    data: savedFilters,
    isLoading: filtersLoading,
    save: saveFilterPref,
  } = useUserPref<{ filters: Record<string, string> }>(filterPrefKey);

  // Dashboard views
  const { saveView } = useDashboardViews(dashboardId ?? undefined);

  // Track whether we've applied saved filters on initial load
  const appliedSaved = useRef(false);

  useEffect(() => {
    appliedSaved.current = false;
    setLoaded(false);
    setDashboard(null);
    setArchivedAt(null);
    setHiddenAt(null);
    setDashboardVisibility(null);
    setDashboardOwner(null);
    setDashboardUpdatedAt(null);
    setResourceAccess(null);
    if (!dashboardId) setLoaded(true);
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboardId || !dashboardQuery.isSuccess) return;
    const fetched = dashboardQuery.data;
    const adoption = shouldAdoptDashboardQueryResult({
      dashboardId,
      loaded,
      isPlaceholderData: dashboardQuery.isPlaceholderData,
      fetchedId: fetched?.id,
      fetchedUpdatedAt: fetched?.updatedAt,
      currentUpdatedAt: dashboardUpdatedAt,
      hold: pendingConfigRef.current,
    });
    if (adoption.clearHold) {
      pendingConfigRef.current = null;
    }
    if (!adoption.adopt) return;
    const fetchedConfig = fetched?.config ?? null;
    const fetchedVisibility =
      fetched?.visibility === "private" ||
      fetched?.visibility === "org" ||
      fetched?.visibility === "public"
        ? fetched.visibility
        : null;
    setDashboard(fetchedConfig);
    setArchivedAt(fetched?.archivedAt ?? null);
    setHiddenAt(fetched?.hiddenAt ?? null);
    setDashboardVisibility(fetchedVisibility);
    setDashboardOwner(fetched?.ownerEmail ?? null);
    setDashboardUpdatedAt(fetched?.updatedAt ?? null);
    setResourceAccess(
      fetched
        ? {
            role: fetched.role,
            canEdit: fetched.canEdit,
            canManage: fetched.canManage,
          }
        : null,
    );
    setLoaded(true);
    if (
      fetched &&
      !reportScreenshot &&
      viewedDashboardIdRef.current !== dashboardId
    ) {
      viewedDashboardIdRef.current = dashboardId;
      incrementItemView("dashboard", dashboardId);
    }
  }, [
    dashboardId,
    dashboardQuery.data,
    dashboardQuery.isSuccess,
    dashboardQuery.isPlaceholderData,
    dashboardUpdatedAt,
    loaded,
    reportScreenshot,
  ]);

  // Apply saved filters on initial load if no filter URL params are present
  useEffect(() => {
    if (
      reportScreenshot ||
      appliedSaved.current ||
      filtersLoading ||
      !loaded ||
      !dashboard
    )
      return;
    appliedSaved.current = true;

    // Check if there's a view param — if so, load view filters
    const viewId = searchParams.get("view");
    if (viewId) return; // View filters are applied by the view param handler

    // Check if any f_ params are already in the URL
    const hasUrlFilters = Array.from(searchParams.keys()).some((k) =>
      k.startsWith(FILTER_PARAM_PREFIX),
    );
    if (hasUrlFilters) return;

    // If the agent just wrote the URL via set-search-params (URLSync in
    // AgentPanel.tsx sets this), don't clobber it with saved defaults.
    // The agent's write is authoritative for the current intent.
    try {
      const appliedAt = Number(
        sessionStorage.getItem("__agentUrlAppliedAt__") || 0,
      );
      if (appliedAt && Date.now() - appliedAt < 5000) return;
    } catch {
      // sessionStorage unavailable — fall through.
    }

    // Apply saved filter defaults — use replace so the restore doesn't
    // leave an extra history entry behind the user's actual nav.
    if (savedFilters?.filters && Object.keys(savedFilters.filters).length > 0) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(savedFilters.filters)) {
            if (value) next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    }
  }, [
    filtersLoading,
    loaded,
    dashboard,
    savedFilters,
    reportScreenshot,
    searchParams,
    setSearchParams,
  ]);

  // Auto-save filter state when URL params change (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (
      reportScreenshot ||
      !loaded ||
      !dashboard?.filters?.length ||
      !dashboardId
    )
      return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const currentFilters: Record<string, string> = {};
      searchParams.forEach((v, k) => {
        if (k.startsWith(FILTER_PARAM_PREFIX)) {
          currentFilters[k] = v;
        }
      });
      saveFilterPref({ filters: currentFilters });
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [
    searchParams,
    loaded,
    dashboard?.filters,
    dashboardId,
    saveFilterPref,
    reportScreenshot,
  ]);

  /**
   * Push a config update through the collab layer so other tabs/users
   * receive the change in real time.
   */
  const pushToCollab = useCallback(
    (updated: SqlDashboardConfig) => {
      if (!collabDocId) return;
      const body = JSON.stringify(updated);
      fetch(agentNativePath(`/_agent-native/collab/${collabDocId}/text`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body, requestSource: TAB_ID }),
      }).catch(() => {
        // Best-effort — the HTTP save is the source of truth
      });
    },
    [collabDocId],
  );

  /**
   * Persist without throwing — background save used for drag reorder, width
   * toggle, title/description edits, and panel delete. If the save fails
   * (e.g. a panel's SQL becomes invalid after an earlier edit), surface a
   * toast so the user knows and the error isn't silently swallowed.
   */
  const persist = useCallback(
    (updated: SqlDashboardConfig) => {
      if (!dashboardId) return;
      if (!canEdit) {
        toast.error(t("sqlDashboard.viewOnly"));
        return;
      }
      holdDashboardConfig();
      setDashboard(updated);
      updateCachedDashboardConfig(updated);
      pushToCollab(updated);
      saveDashboard(dashboardId, updated)
        .then(() => {
          queryClient.removeQueries({
            queryKey: sqlDashboardPrefetchKey(dashboardId),
          });
          queryClient.invalidateQueries({
            queryKey: ["sql-dashboards-sidebar"],
          });
          queryClient.invalidateQueries({
            queryKey: ["sql-dashboards-palette"],
          });
          queryClient.invalidateQueries({
            queryKey: ["data", "sql-dashboard", dashboardId],
          });
        })
        .catch((err) => {
          toast.error(
            err instanceof Error
              ? t("sqlDashboard.saveFailedWithMessage", {
                  message: err.message,
                })
              : t("sqlDashboard.saveFailed"),
          );
        });
    },
    [
      dashboardId,
      canEdit,
      holdDashboardConfig,
      queryClient,
      pushToCollab,
      t,
      updateCachedDashboardConfig,
    ],
  );

  /**
   * Persist that throws — used by the panel editor dialog so it can keep the
   * dialog open and display the BigQuery validation error inline.
   */
  const persistThrow = useCallback(
    async (updated: SqlDashboardConfig) => {
      if (!dashboardId) return;
      if (!canEdit) {
        throw new Error(t("sqlDashboard.viewOnly"));
      }
      holdDashboardConfig();
      await saveDashboard(dashboardId, updated);
      setDashboard(updated);
      updateCachedDashboardConfig(updated);
      pushToCollab(updated);
      queryClient.removeQueries({
        queryKey: sqlDashboardPrefetchKey(dashboardId),
      });
      queryClient.invalidateQueries({ queryKey: ["sql-dashboards-sidebar"] });
      queryClient.invalidateQueries({ queryKey: ["sql-dashboards-palette"] });
      queryClient.invalidateQueries({
        queryKey: ["data", "sql-dashboard", dashboardId],
      });
    },
    [
      dashboardId,
      canEdit,
      holdDashboardConfig,
      queryClient,
      pushToCollab,
      t,
      updateCachedDashboardConfig,
    ],
  );

  const removePanel = useCallback(
    (panelId: string) => {
      if (!dashboard) return;
      persist({
        ...dashboard,
        panels: removePanelFromLayout(
          dashboard.panels,
          panelId,
          dashboardColumns,
        ),
      });
    },
    [dashboard, dashboardColumns, persist],
  );

  const handleSavePanel = useCallback(
    async (panel: SqlPanel) => {
      if (!dashboard) return;
      const idx = dashboard.panels.findIndex((p) => p.id === panel.id);
      const nextPanels =
        idx >= 0
          ? dashboard.panels.map((p, i) => (i === idx ? panel : p))
          : [...dashboard.panels, panel];
      await persistThrow({ ...dashboard, panels: nextPanels });
    },
    [dashboard, persistThrow],
  );

  const openEditPanel = useCallback(
    (panel: SqlPanel) => {
      setEditingPanel(panel);
      setEditorOpen(true);
      awareness?.setLocalStateField("editingPanelId", panel.id);
    },
    [awareness],
  );

  // Clear awareness when panel editor closes
  const handleEditorOpenChange = useCallback(
    (open: boolean) => {
      setEditorOpen(open);
      if (!open) {
        awareness?.setLocalStateField("editingPanelId", null);
      }
    },
    [awareness],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragPanelId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const nextSlot = readDropSlot(event.over?.data.current);
    setActiveDropSlot((currentSlot) => {
      if (!nextSlot) return currentSlot === null ? currentSlot : null;
      return sameDropSlot(currentSlot, nextSlot) ? currentSlot : nextSlot;
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDropSlot(null);
      setActiveDragPanelId(null);
      if (!dashboard) return;
      const slot = readDropSlot(event.over?.data.current);
      if (!slot) return;
      const panelId = String(event.active.id);
      const columnExpansion = columnExpansionForDropSlot(
        buildDashboardPanelGroups(dashboard.panels, dashboardColumns),
        panelId,
        slot,
      );
      const nextPanels = movePanelToDropSlot(
        dashboard.panels,
        panelId,
        slot,
        dashboardColumns,
      );
      if (nextPanels === dashboard.panels) return;
      const persistedPanels = columnExpansion?.sectionPanelId
        ? nextPanels.map((panel) =>
            panel.id === columnExpansion.sectionPanelId
              ? { ...panel, columns: columnExpansion.columns }
              : panel,
          )
        : nextPanels;
      persist({
        ...dashboard,
        ...(columnExpansion && !columnExpansion.sectionPanelId
          ? { columns: columnExpansion.columns }
          : {}),
        panels: persistedPanels,
      });
    },
    [dashboard, dashboardColumns, persist],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDropSlot(null);
    setActiveDragPanelId(null);
  }, []);

  const handleSaveName = useCallback(() => {
    if (!dashboard) return;
    const name = nameInput.trim() || "Untitled Dashboard";
    persist({ ...dashboard, name });
    setEditingName(false);
  }, [dashboard, nameInput, persist]);

  const handleSaveDescription = useCallback(() => {
    if (!dashboard) return;
    const description = descriptionInput.trim();
    persist({
      ...dashboard,
      description: description || undefined,
    });
    setEditingDescription(false);
  }, [dashboard, descriptionInput, persist]);

  const vars = useMemo<Record<string, string>>(() => {
    const filterValues = dashboard?.filters
      ? resolveFilterVars(
          dashboard.filters,
          (key) => searchParams.get(FILTER_PARAM_PREFIX + key) ?? "",
        )
      : {};
    return { ...(dashboard?.variables ?? {}), ...filterValues };
  }, [dashboard?.variables, dashboard?.filters, searchParams]);

  const currentReportFilters = useMemo<Record<string, string>>(() => {
    const out = dashboard?.filters
      ? extractFilterParams(dashboard.filters, searchParams)
      : {};
    const tab = searchParams.get("tab");
    if (tab) out.tab = tab;
    return out;
  }, [dashboard?.filters, searchParams]);

  useEffect(() => {
    if (!reportScreenshot && reportSettingsRequested) {
      setEmailReportOpen(true);
    }
  }, [reportScreenshot, reportSettingsRequested]);

  const handleEmailReportOpenChange = useCallback(
    (open: boolean) => {
      setEmailReportOpen(open);
      if (open || !reportSettingsRequested) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("reportSettings");
          return next;
        },
        { replace: true },
      );
    },
    [reportSettingsRequested, setSearchParams],
  );

  // Distinct tab values across panels in declaration order. When this is
  // non-empty the dashboard renders a tab strip and filters panels by tab.
  const tabs = useMemo<string[]>(() => {
    if (!dashboard) return [];
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const panel of dashboard.panels) {
      const t = panel.tab;
      if (t && !seen.has(t)) {
        seen.add(t);
        ordered.push(t);
      }
    }
    return ordered;
  }, [dashboard]);

  const requestedTab = searchParams.get("tab");
  const activeTab =
    tabs.length > 0
      ? requestedTab && tabs.includes(requestedTab)
        ? requestedTab
        : tabs[0]
      : null;
  const groupedTabs = useMemo(() => groupDashboardTabs(tabs), [tabs]);
  const activeTabGroup = activeTab
    ? groupedTabs.groups.find((group) =>
        group.tabs.some((tab) => tab.value === activeTab),
      )
    : null;

  const handleTabChange = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const handleTabGroupChange = useCallback(
    (groupName: string) => {
      const group = groupedTabs.groups.find((item) => item.name === groupName);
      const firstTab = group?.tabs[0]?.value;
      if (firstTab) handleTabChange(firstTab);
    },
    [groupedTabs.groups, handleTabChange],
  );

  // Panels visible under the current tab. Untagged panels appear on every
  // tab; tagged panels only on their own tab. When no tabs are defined the
  // dashboard shows every panel as before.
  const visiblePanels = useMemo(() => {
    if (!dashboard) return [];
    const tabPanels = activeTab
      ? dashboard.panels.filter((p) => !p.tab || p.tab === activeTab)
      : dashboard.panels;
    return limitReportPanels(tabPanels, reportPanelLimit);
  }, [dashboard, activeTab, reportPanelLimit]);

  // Group panels into "section blocks": each section starts a new block whose
  // grid uses the section's `columns` (falling back to the dashboard default).
  // Panels before any section go in an initial unsectioned block.
  const panelGroups = useMemo(() => {
    return buildDashboardPanelGroups(visiblePanels, dashboardColumns);
  }, [visiblePanels, dashboardColumns]);
  const activeDragPanel = useMemo(
    () =>
      activeDragPanelId
        ? (visiblePanels.find((panel) => panel.id === activeDragPanelId) ??
          null)
        : null,
    [activeDragPanelId, visiblePanels],
  );
  const activeDropSlotIds = useMemo(
    () =>
      activeDragPanelId
        ? availableDropSlotIdsForPanel(panelGroups, activeDragPanelId)
        : null,
    [activeDragPanelId, panelGroups],
  );

  const dashboardCollisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const activePanelId = String(args.active.id);
      const availableSlotIds =
        activeDragPanelId === activePanelId && activeDropSlotIds
          ? activeDropSlotIds
          : availableDropSlotIdsForPanel(panelGroups, activePanelId);
      const droppableContainers = args.droppableContainers.filter((container) =>
        availableSlotIds.has(String(container.id)),
      );

      if (droppableContainers.length === 0) return [];

      if (!args.pointerCoordinates) return [];

      const candidates = droppableContainers.flatMap((droppableContainer) => {
        const rect = args.droppableRects.get(droppableContainer.id);
        const slot = readDropSlot(droppableContainer.data.current);
        if (!rect || !slot) return [];
        return [
          {
            id: String(droppableContainer.id),
            slot,
            rect,
          },
        ];
      });
      const preferredId = preferredDropSlotId(
        args.pointerCoordinates,
        candidates,
      );
      const preferredContainer =
        preferredId === null
          ? null
          : (droppableContainers.find(
              (container) => String(container.id) === preferredId,
            ) ?? null);
      const preferredRect =
        preferredContainer && args.droppableRects.get(preferredContainer.id);

      return preferredId && preferredContainer && preferredRect
        ? [
            {
              id: preferredId,
              data: {
                droppableContainer: preferredContainer,
                value: distanceFromPointerToRect(
                  args.pointerCoordinates,
                  preferredRect,
                ),
              },
            },
          ]
        : [];
    },
    [activeDragPanelId, activeDropSlotIds, panelGroups],
  );

  const handleDelete = useCallback(async () => {
    if (!dashboardId) return;
    if (!canManage) return;
    await deleteDashboardAction({ id: dashboardId });
    queryClient.invalidateQueries({ queryKey: ["sql-dashboards-sidebar"] });
    queryClient.invalidateQueries({ queryKey: ["sql-dashboards-palette"] });
    queryClient.removeQueries({
      queryKey: sqlDashboardPrefetchKey(dashboardId),
    });
    queryClient.invalidateQueries({
      queryKey: ["data", "sql-dashboard", dashboardId],
    });
    navigate("/");
  }, [dashboardId, canManage, deleteDashboardAction, queryClient, navigate]);

  const dismissDemoIntro = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("demoIntro");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const handleArchive = useCallback(async () => {
    if (!dashboardId) return;
    if (!canEdit) return;
    if (archivedAt) return;
    try {
      await archiveDashboardAction({ id: dashboardId, archived: true });
      queryClient.invalidateQueries({ queryKey: ["sql-dashboards-sidebar"] });
      queryClient.removeQueries({
        queryKey: sqlDashboardPrefetchKey(dashboardId),
      });
      queryClient.invalidateQueries({
        queryKey: ["data", "sql-dashboard", dashboardId],
      });
      toast.success(`Archived "${dashboard?.name ?? "dashboard"}"`);
      navigate("/");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't archive dashboard",
      );
    }
  }, [
    dashboardId,
    canEdit,
    archivedAt,
    archiveDashboardAction,
    queryClient,
    navigate,
    dashboard?.name,
  ]);

  const handleUnhide = useCallback(async () => {
    if (!dashboardId) return;
    try {
      const result = (await hideDashboardAction({
        id: dashboardId,
        hidden: false,
      })) as { ownerEmail?: string | null } | undefined;
      setHiddenAt(null);
      if (typeof result?.ownerEmail === "string") {
        setDashboardOwner(result.ownerEmail);
      }
      queryClient.invalidateQueries({ queryKey: ["sql-dashboards-sidebar"] });
      queryClient.invalidateQueries({ queryKey: ["sql-dashboards-palette"] });
      queryClient.removeQueries({
        queryKey: sqlDashboardPrefetchKey(dashboardId),
      });
      queryClient.invalidateQueries({
        queryKey: ["data", "sql-dashboard", dashboardId],
      });
      toast.success(`Unhid "${dashboard?.name ?? "dashboard"}"`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't unhide dashboard",
      );
    }
  }, [dashboardId, dashboard?.name, hideDashboardAction, queryClient]);

  const handleSaveView = useCallback(
    async (name: string, filters: Record<string, string>) => {
      const id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
      await saveView({ id, name, filters });
    },
    [saveView],
  );

  const dashboardOwnerName = ownerDisplayName(dashboardOwner);
  const dashboardVisibilityLabel = dashboardVisibility
    ? t(visibilityLabelKey(dashboardVisibility))
    : null;
  const DashboardVisibilityIcon =
    dashboardVisibility === "public"
      ? IconWorld
      : dashboardVisibility === "org"
        ? IconBuilding
        : IconLock;

  useSetPageTitle(
    reportScreenshot ? null : dashboard ? (
      <div className="dashboard-title-resource-meta flex w-full min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {editingName && canEdit ? (
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
              className="h-8 w-full sm:w-64 text-lg font-semibold"
              autoFocus
            />
          ) : canEdit ? (
            <button
              className="group flex min-w-0 items-center gap-1 truncate text-lg font-semibold hover:text-primary"
              onClick={() => {
                setNameInput(dashboard.name);
                setEditingName(true);
              }}
            >
              <span className="truncate">{dashboard.name}</span>
              <IconPencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          ) : (
            <span className="truncate text-lg font-semibold">
              {dashboard.name}
            </span>
          )}
        </div>
        {(dashboardVisibilityLabel || dashboardOwnerName) && (
          <div className="dashboard-title-resource-badges flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden text-[11px] leading-none text-muted-foreground">
            {dashboardVisibility && dashboardVisibilityLabel ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="dashboard-title-resource-chip inline-flex h-5 max-w-[8rem] shrink-0 items-center gap-1 rounded-full border border-border/80 px-1.5 py-0.5"
                    aria-label={dashboardVisibilityLabel}
                    tabIndex={0}
                  >
                    <DashboardVisibilityIcon className="h-3 w-3 shrink-0" />
                    <span className="dashboard-title-resource-chip-label truncate">
                      {dashboardVisibilityLabel}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{dashboardVisibilityLabel}</TooltipContent>
              </Tooltip>
            ) : null}
            {dashboardOwnerName && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="dashboard-title-resource-chip inline-flex h-5 max-w-[8rem] shrink-0 items-center gap-1 rounded-full border border-border/80 px-1.5 py-0.5"
                    aria-label={dashboardOwnerName}
                    tabIndex={0}
                  >
                    <IconUser className="h-3 w-3 shrink-0" />
                    <span className="dashboard-title-resource-chip-label truncate">
                      {dashboardOwnerName}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{dashboardOwnerName}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    ) : dashboardId && !loaded ? (
      <DashboardTitleSkeleton />
    ) : null,
  );

  useSetHeaderActions(
    reportScreenshot ? null : dashboard ? (
      <>
        <PresenceBar
          activeUsers={activeUsers}
          agentPresent={agentPresent}
          agentActive={agentActive}
          currentUserEmail={session?.email}
        />
        {dashboardId && (
          <ViewsMenu dashboardId={dashboardId} canEdit={canEdit} />
        )}
        {dashboardId ? (
          <ShareButton
            resourceType="dashboard"
            resourceId={dashboardId}
            resourceTitle={dashboard.name}
            variant="compact"
          />
        ) : null}
        {canEdit ? (
          <AddPanelPopover
            onSave={handleSavePanel}
            dashboardId={dashboardId ?? ""}
            existingPanelTitles={dashboard.panels.map((p) => p.title)}
            align="end"
          >
            <Button size="sm" variant="outline">
              <IconPlus className="h-4 w-4 mr-1" />
              {t("sqlDashboard.addPanel")}
            </Button>
          </AddPanelPopover>
        ) : null}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t("sqlDashboard.dashboardActions")}
                >
                  <IconDotsVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("sqlDashboard.details")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                {dashboardUpdatedAt && (
                  <span className="flex items-center gap-1.5">
                    <IconClock className="h-3 w-3" />
                    {t("sqlDashboard.updated", {
                      date: new Date(dashboardUpdatedAt).toLocaleDateString(
                        "en-US",
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        },
                      ),
                    })}
                  </span>
                )}
                {dashboardOwner && (
                  <span className="flex items-center gap-1.5">
                    <IconUser className="h-3 w-3" />
                    {dashboardOwner.split("@")[0]}
                  </span>
                )}
                {dashboardVisibility ? (
                  <span className="flex items-center gap-1.5">
                    {dashboardVisibility === "public" ? (
                      <IconWorld className="h-3 w-3" />
                    ) : dashboardVisibility === "org" ? (
                      <IconBuilding className="h-3 w-3" />
                    ) : (
                      <IconLock className="h-3 w-3" />
                    )}
                    {dashboardVisibility === "public"
                      ? t("sqlDashboard.public")
                      : dashboardVisibility === "org"
                        ? t("sqlDashboard.sharedWithOrg")
                        : t("sqlDashboard.private")}
                  </span>
                ) : null}
                {hiddenAt && (
                  <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                    <IconEyeOff className="h-3 w-3" />
                    {t("sqlDashboard.hidden")}
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            {(canEdit && !archivedAt) || canManage ? (
              <DropdownMenuSeparator />
            ) : null}
            {dashboardId ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setEmailReportOpen(true);
                  }}
                >
                  <IconMail className="mr-2 h-3.5 w-3.5" />
                  {t("sqlDashboard.emailReports")}
                </DropdownMenuItem>
              </>
            ) : null}
            {canEdit && !archivedAt ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void handleArchive();
                }}
              >
                <IconArchive className="mr-2 h-3.5 w-3.5" />
                {t("sidebar.archive")}
              </DropdownMenuItem>
            ) : null}
            {canEdit && !archivedAt && canManage ? (
              <DropdownMenuSeparator />
            ) : null}
            {canManage ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmDeleteOpen(true);
                }}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash className="mr-2 h-3.5 w-3.5" />
                {t("sqlDashboard.deletePermanently")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {dashboardId ? (
          <EmailReportDialog
            open={emailReportOpen}
            onOpenChange={handleEmailReportOpenChange}
            dashboardId={dashboardId}
            dashboardName={dashboard.name}
            filters={currentReportFilters}
          />
        ) : null}
        {canManage ? (
          <AlertDialog
            open={confirmDeleteOpen}
            onOpenChange={setConfirmDeleteOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("sqlDashboard.deletePermanentlyTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("sqlDashboard.deletePermanentlyDescription", {
                    name: dashboard?.name ?? "",
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t("sqlDashboard.deletePermanently")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </>
    ) : null,
  );

  if (!dashboardId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {t("sqlDashboard.noDashboardSelected")}
      </div>
    );
  }

  if (!loaded) {
    return <DashboardSkeleton />;
  }

  if (!dashboard) return <BlankDashboard />;

  return (
    <div
      className="space-y-4"
      data-dashboard-report-capture
      data-dashboard-report-ready={loaded && dashboard ? "true" : "false"}
    >
      {hiddenAt ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
          <IconEyeOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1">
            {t("sqlDashboard.hiddenDescription")}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={unhidePending}
            onClick={() => void handleUnhide()}
            className="shrink-0 border-amber-300 bg-amber-100 text-amber-950 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/70"
          >
            <IconEye className="mr-1.5 h-3.5 w-3.5" />
            {t("sidebar.unhide")}
          </Button>
        </div>
      ) : null}
      {showDemoIntro ? (
        <Alert className="border-cyan-400/50 bg-cyan-400/10 pr-12 text-cyan-950 shadow-sm shadow-cyan-500/10 dark:bg-cyan-400/10 dark:text-cyan-50 [&>svg]:text-cyan-600 dark:[&>svg]:text-cyan-300">
          <IconInfoCircle className="h-4 w-4" />
          <AlertTitle>{t("sqlDashboard.demoIntroTitle")}</AlertTitle>
          <AlertDescription className="text-cyan-900/80 dark:text-cyan-100/80">
            {t("sqlDashboard.demoIntroDescription")}
          </AlertDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8 text-cyan-900 hover:bg-cyan-400/20 hover:text-cyan-950 dark:text-cyan-100 dark:hover:text-cyan-50"
            onClick={dismissDemoIntro}
            aria-label={t("sqlDashboard.dismissDemoIntro")}
          >
            <IconX className="h-4 w-4" />
          </Button>
        </Alert>
      ) : null}
      {/* Description (click to edit) */}
      {editingDescription && canEdit ? (
        <Textarea
          value={descriptionInput}
          onChange={(e) => setDescriptionInput(e.target.value)}
          onBlur={handleSaveDescription}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSaveDescription();
            }
            if (e.key === "Escape") setEditingDescription(false);
          }}
          rows={2}
          autoFocus
          placeholder={t("sqlDashboard.addDescriptionPlaceholder")}
          className="text-sm resize-y"
        />
      ) : !reportScreenshot && dashboard.description ? (
        <button
          className={
            canEdit
              ? "text-sm text-muted-foreground hover:text-foreground text-left flex items-start gap-1.5 w-full group"
              : "text-sm text-muted-foreground text-left flex items-start gap-1.5 w-full"
          }
          onClick={() => {
            if (!canEdit) return;
            setDescriptionInput(dashboard.description ?? "");
            setEditingDescription(true);
          }}
        >
          <span className="flex-1">{dashboard.description}</span>
          {canEdit ? (
            <IconPencil className="h-3 w-3 mt-0.5 shrink-0 opacity-0 group-hover:opacity-60" />
          ) : null}
        </button>
      ) : canEdit ? (
        <button
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1"
          onClick={() => {
            setDescriptionInput("");
            setEditingDescription(true);
          }}
        >
          <IconPencil className="h-3 w-3" />
          {t("sqlDashboard.addDescription")}
        </button>
      ) : null}

      {/* Tabs */}
      {tabs.length > 0 && activeTab && (
        <div className="space-y-2">
          {groupedTabs.hasNestedTabs && groupedTabs.groups.length > 1 ? (
            <Tabs
              value={activeTabGroup?.name ?? groupedTabs.groups[0]?.name}
              onValueChange={handleTabGroupChange}
            >
              <TabsList className="inline-flex max-w-full justify-start overflow-x-auto">
                {groupedTabs.groups.map((group) => (
                  <TabsTrigger
                    key={group.name}
                    value={group.name}
                    className="shrink-0 whitespace-nowrap"
                  >
                    {group.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
              {(groupedTabs.hasNestedTabs
                ? (activeTabGroup?.tabs ?? [])
                : tabs.map((tab) => ({ value: tab, label: tab }))
              ).map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="shrink-0 whitespace-nowrap"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Filters */}
      {!reportScreenshot &&
        dashboard.filters &&
        dashboard.filters.length > 0 && (
          <DashboardFilterBar
            filters={dashboard.filters}
            onSaveView={canEdit ? handleSaveView : undefined}
          />
        )}

      {/* Panels grid */}
      {dashboard.panels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-3">
            <p>{t("sqlDashboard.noPanels")}</p>
            {canEdit ? (
              <AddPanelPopover
                onSave={handleSavePanel}
                dashboardId={dashboardId ?? ""}
                existingPanelTitles={dashboard.panels.map((p) => p.title)}
                align="center"
              >
                <Button size="sm" variant="outline">
                  <IconPlus className="h-4 w-4 mr-1" />
                  {t("sqlDashboard.addFirstPanel")}
                </Button>
              </AddPanelPopover>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={dashboardCollisionDetection}
          onDragStart={canEdit ? handleDragStart : undefined}
          onDragOver={canEdit ? handleDragOver : undefined}
          onDragEnd={canEdit ? handleDragEnd : undefined}
          onDragCancel={handleDragCancel}
        >
          <div
            className="dashboard-grid-container flex flex-col gap-1"
            data-dashboard-dragging={activeDragPanel ? "true" : undefined}
          >
            {panelGroups.map((group) => {
              const renderSection = (section: SqlPanel) => {
                const remoteEditor = reportScreenshot
                  ? undefined
                  : remoteEditingPanels.get(section.id);
                const resolved = section.config?.description
                  ? {
                      ...section,
                      config: {
                        ...section.config,
                        description: interpolate(
                          section.config.description,
                          vars,
                        ),
                      },
                    }
                  : section;
                return (
                  <div
                    className="dashboard-section-cell relative"
                    style={
                      remoteEditor
                        ? {
                            outline: `2px solid ${remoteEditor.color}`,
                            outlineOffset: 2,
                            borderRadius: 8,
                          }
                        : undefined
                    }
                  >
                    {remoteEditor && (
                      <span
                        className="absolute -top-2.5 left-3 px-1.5 text-[10px] font-medium rounded z-10"
                        style={{
                          backgroundColor: remoteEditor.color,
                          color: "#fff",
                        }}
                      >
                        {remoteEditor.name}
                      </span>
                    )}
                    <SqlChartCard
                      panel={resolved}
                      resolvedSql=""
                      onRemove={() => removePanel(section.id)}
                      onEdit={() => openEditPanel(section)}
                      editable={canEdit}
                      eagerLoad={reportScreenshot}
                      isDragSource={activeDragPanelId === section.id}
                    />
                  </div>
                );
              };

              const renderRowDropLine = (rowIndex: number) => (
                <DashboardDropLine
                  key={`row-slot-${group.key}-${rowIndex}`}
                  slot={{ type: "row", groupKey: group.key, rowIndex }}
                  activeSlot={activeDropSlot}
                  disabled={!canEdit}
                />
              );

              return (
                <Fragment key={group.key}>
                  {group.section && renderSection(group.section)}
                  {renderRowDropLine(0)}
                  {group.rows.map((row, rowIndex) => {
                    return (
                      <Fragment key={row.key}>
                        <div
                          className="dashboard-grid"
                          style={
                            {
                              "--dash-cols": row.panels.length,
                            } as React.CSSProperties
                          }
                        >
                          <DashboardDropLine
                            slot={{
                              type: "column",
                              groupKey: group.key,
                              rowIndex,
                              columnIndex: 0,
                            }}
                            activeSlot={activeDropSlot}
                            disabled={!canEdit}
                          />
                          {row.panels.map((panel, columnIndex) => (
                            <Fragment key={panel.id}>
                              <PanelCell
                                panel={panel}
                                vars={vars}
                                remoteEditor={
                                  reportScreenshot
                                    ? undefined
                                    : remoteEditingPanels.get(panel.id)
                                }
                                editable={canEdit}
                                eagerLoad={reportScreenshot}
                                isDragSource={activeDragPanelId === panel.id}
                                onRemovePanel={removePanel}
                                onEditPanel={openEditPanel}
                                onSavePanel={handleSavePanel}
                              />
                              <DashboardDropLine
                                slot={{
                                  type: "column",
                                  groupKey: group.key,
                                  rowIndex,
                                  columnIndex: columnIndex + 1,
                                }}
                                activeSlot={activeDropSlot}
                                disabled={!canEdit}
                              />
                            </Fragment>
                          ))}
                        </div>
                        {renderRowDropLine(rowIndex + 1)}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
          <DragOverlay adjustScale={false} dropAnimation={null} zIndex={1000}>
            <DashboardDragPreview panel={activeDragPanel} />
          </DragOverlay>
        </DndContext>
      )}

      {canEdit ? (
        <PanelEditorDialog
          open={editorOpen}
          onOpenChange={handleEditorOpenChange}
          panel={editingPanel}
          onSave={handleSavePanel}
          dashboardId={dashboardId ?? ""}
          existingPanelTitles={dashboard.panels.map((p) => p.title)}
        />
      ) : null}
    </div>
  );
}
