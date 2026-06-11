import {
  Fragment,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useSearchParams, useParams, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IconArchive,
  IconClock,
  IconDots,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  type CollabUser,
} from "@agent-native/core/client";
import { SqlChartCard } from "./SqlChartCard";
import {
  DashboardFilterBar,
  FILTER_PARAM_PREFIX,
  resolveFilterVars,
} from "./DashboardFilterBar";
import { interpolate } from "./interpolate";
import { serializePanelSql } from "./panel-sql";
import { AddPanelPopover, PanelEditorDialog } from "./PanelEditorDialog";
import { ViewsMenu } from "./ViewsMenu";
import BlankDashboard from "../BlankDashboard";
import {
  clampDashboardColumns,
  clampPanelWidth,
  DEFAULT_DASHBOARD_COLUMNS,
  type SqlDashboardConfig,
  type SqlPanel,
} from "./types";
import { useUserPref } from "@/hooks/use-user-pref";
import { useDashboardViews } from "@/hooks/use-dashboard-views";
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
import {
  DashboardTitleSkeleton,
  useSetPageTitle,
  useSetHeaderActions,
} from "@/components/layout/HeaderActions";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";

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
      { id },
      { method: "GET" },
    );
    if (!data || data.error) return null;
    return {
      id,
      config: {
        name: data.name ?? "Untitled Dashboard",
        description: data.description,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: routeId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const dashboardId = searchParams.get("id") || routeId;

  const [dashboard, setDashboard] = useState<SqlDashboardConfig | null>(null);
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [hiddenAt, setHiddenAt] = useState<string | null>(null);
  const [hiddenBy, setHiddenBy] = useState<string | null>(null);
  const [dashboardVisibility, setDashboardVisibility] = useState<
    "private" | "org" | "public"
  >("private");
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
  const viewedDashboardIdRef = useRef<string | null>(null);
  const canEdit = resourceCanEdit(resourceAccess);
  const canManage = resourceCanManage(resourceAccess);
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
      if (snapshot?.data === null && snapshot.syncVersion !== sync) {
        return undefined;
      }
      return snapshot?.data;
    },
    initialDataUpdatedAt: () => {
      if (!dashboardId) return undefined;
      const queryKey = sqlDashboardPrefetchKey(dashboardId);
      const snapshot =
        queryClient.getQueryData<PrefetchSnapshot<FetchedDashboard | null>>(
          queryKey,
        );
      if (!snapshot) return undefined;
      if (snapshot.syncVersion !== sync) return 0;
      return queryClient.getQueryState(queryKey)?.dataUpdatedAt;
    },
  });

  // Panel edit dialog state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPanel, setEditingPanel] = useState<SqlPanel | null>(null);

  // ── Collaborative editing ──────────────────────────────────────────
  const { session } = useSession();
  const currentUser: CollabUser | undefined = session?.email
    ? {
        name: emailToName(session.email),
        email: session.email,
        color: emailToColor(session.email),
      }
    : undefined;

  const collabDocId = dashboardId ? `dash-${dashboardId}` : null;
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
        if (parsed && parsed.panels) {
          setDashboard(parsed);
        }
      } catch {
        // JSON parse failed — ignore partial updates
      }
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ydoc, collabSynced]);

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
    setHiddenBy(null);
    setDashboardVisibility("private");
    setDashboardOwner(null);
    setDashboardUpdatedAt(null);
    setResourceAccess(null);
    if (!dashboardId) setLoaded(true);
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboardId || !dashboardQuery.isSuccess) return;
    const fetched = dashboardQuery.data;
    if (fetched && fetched.id !== dashboardId) return;
    setDashboard(fetched?.config ?? null);
    setArchivedAt(fetched?.archivedAt ?? null);
    setHiddenAt(fetched?.hiddenAt ?? null);
    setHiddenBy(fetched?.hiddenBy ?? null);
    setDashboardVisibility(fetched?.visibility ?? "private");
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
    if (fetched && viewedDashboardIdRef.current !== dashboardId) {
      viewedDashboardIdRef.current = dashboardId;
      incrementItemView("dashboard", dashboardId);
    }
  }, [dashboardId, dashboardQuery.data, dashboardQuery.isSuccess]);

  // Apply saved filters on initial load if no filter URL params are present
  useEffect(() => {
    if (appliedSaved.current || filtersLoading || !loaded || !dashboard) return;
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
    searchParams,
    setSearchParams,
  ]);

  // Auto-save filter state when URL params change (debounced)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!loaded || !dashboard?.filters?.length || !dashboardId) return;
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
  }, [searchParams, loaded, dashboard?.filters, dashboardId, saveFilterPref]);

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
        toast.error("You have view-only access to this dashboard.");
        return;
      }
      setDashboard(updated);
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
              ? `Couldn't save dashboard: ${err.message}`
              : "Couldn't save dashboard",
          );
        });
    },
    [dashboardId, canEdit, queryClient, pushToCollab],
  );

  /**
   * Persist that throws — used by the panel editor dialog so it can keep the
   * dialog open and display the BigQuery validation error inline.
   */
  const persistThrow = useCallback(
    async (updated: SqlDashboardConfig) => {
      if (!dashboardId) return;
      if (!canEdit) {
        throw new Error("You have view-only access to this dashboard.");
      }
      await saveDashboard(dashboardId, updated);
      setDashboard(updated);
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
    [dashboardId, canEdit, queryClient, pushToCollab],
  );

  const removePanel = useCallback(
    (panelId: string) => {
      if (!dashboard) return;
      persist({
        ...dashboard,
        panels: dashboard.panels.filter((p) => p.id !== panelId),
      });
    },
    [dashboard, persist],
  );

  const toggleWidth = useCallback(
    (panelId: string, gridColumns: number) => {
      if (!dashboard) return;
      const max = clampDashboardColumns(gridColumns);
      persist({
        ...dashboard,
        panels: dashboard.panels.map((p) => {
          if (p.id !== panelId) return p;
          const current = clampPanelWidth(p.width, max);
          return { ...p, width: current >= max ? 1 : max };
        }),
      });
    },
    [dashboard, persist],
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
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!dashboard) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = dashboard.panels.findIndex((p) => p.id === active.id);
      const newIndex = dashboard.panels.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      persist({
        ...dashboard,
        panels: arrayMove(dashboard.panels, oldIndex, newIndex),
      });
    },
    [dashboard, persist],
  );

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
    if (!activeTab) return dashboard.panels;
    return dashboard.panels.filter((p) => !p.tab || p.tab === activeTab);
  }, [dashboard, activeTab]);

  // Group panels into "section blocks": each section starts a new block whose
  // grid uses the section's `columns` (falling back to the dashboard default).
  // Panels before any section go in an initial unsectioned block.
  const dashboardColumns = clampDashboardColumns(
    dashboard?.columns ?? DEFAULT_DASHBOARD_COLUMNS,
  );
  const panelGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      section: SqlPanel | null;
      panels: SqlPanel[];
      columns: number;
    }> = [];
    let current: {
      key: string;
      section: SqlPanel | null;
      panels: SqlPanel[];
      columns: number;
    } = {
      key: "intro",
      section: null,
      panels: [],
      columns: dashboardColumns,
    };
    for (const panel of visiblePanels) {
      if (panel.chartType === "section") {
        if (current.section || current.panels.length > 0) groups.push(current);
        current = {
          key: panel.id,
          section: panel,
          panels: [],
          columns: clampDashboardColumns(panel.columns ?? dashboardColumns),
        };
      } else {
        current.panels.push(panel);
      }
    }
    if (current.section || current.panels.length > 0) groups.push(current);
    return groups;
  }, [visiblePanels, dashboardColumns]);

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
      setHiddenBy(null);
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

  useSetPageTitle(
    dashboard ? (
      <div className="flex items-center gap-2 min-w-0">
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
            className="group text-lg font-semibold hover:text-primary flex items-center gap-1 truncate"
            onClick={() => {
              setNameInput(dashboard.name);
              setEditingName(true);
            }}
          >
            <span className="truncate">{dashboard.name}</span>
            <IconPencil className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
          </button>
        ) : (
          <span className="truncate text-lg font-semibold">
            {dashboard.name}
          </span>
        )}
      </div>
    ) : dashboardId && !loaded ? (
      <DashboardTitleSkeleton />
    ) : null,
  );

  useSetHeaderActions(
    dashboard ? (
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
              Add panel
            </Button>
          </AddPanelPopover>
        ) : null}
        {canEdit || canManage ? (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Dashboard actions"
                  >
                    <IconDots className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>More actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-44">
              {canEdit && !archivedAt ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    void handleArchive();
                  }}
                >
                  <IconArchive className="mr-2 h-3.5 w-3.5" />
                  Archive
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
                  Delete permanently
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canManage ? (
          <AlertDialog
            open={confirmDeleteOpen}
            onOpenChange={setConfirmDeleteOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes &ldquo;{dashboard?.name}&rdquo; and
                  cannot be undone. To keep it recoverable, choose Archive
                  instead.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete permanently
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
        No dashboard selected
      </div>
    );
  }

  if (!loaded) {
    // Match the eventual SqlChartCard layout exactly (Card chrome + title row +
    // chart-body skeleton) so the transition from "dashboard config loading" to
    // "queries loading" doesn't morph the skeleton's shape — only the title
    // text fills in. Otherwise the bare h-64 rectangles jump into Card-chromed
    // panels and the page visibly shifts.
    return (
      <div className="dashboard-grid-container space-y-4">
        <div
          className="dashboard-grid"
          style={{ "--dash-cols": 2 } as React.CSSProperties}
        >
          {[0, 1].map((i) => (
            <Card key={i} className="flex flex-col overflow-visible">
              <CardHeader className="pb-2 shrink-0">
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="flex flex-1 flex-col pt-0">
                <Skeleton className="w-full flex-1 min-h-[250px]" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!dashboard) return <BlankDashboard />;

  return (
    <div className="space-y-4">
      {hiddenAt ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
          <IconEyeOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1">
            This dashboard is hidden from regular lists. It remains searchable
            and openable by direct link.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={unhidePending}
            onClick={() => void handleUnhide()}
            className="shrink-0 border-amber-300 bg-amber-100 text-amber-950 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/70"
          >
            <IconEye className="mr-1.5 h-3.5 w-3.5" />
            Unhide
          </Button>
        </div>
      ) : null}
      {showDemoIntro ? (
        <Alert className="border-cyan-400/50 bg-cyan-400/10 pr-12 text-cyan-950 shadow-sm shadow-cyan-500/10 dark:bg-cyan-400/10 dark:text-cyan-50 [&>svg]:text-cyan-600 dark:[&>svg]:text-cyan-300">
          <IconInfoCircle className="h-4 w-4" />
          <AlertTitle>You&apos;re viewing a live demo</AlertTitle>
          <AlertDescription className="text-cyan-900/80 dark:text-cyan-100/80">
            This dashboard uses the built-in demo Prometheus endpoint, not your
            connected sources or provider slots. Start with app metrics here,
            switch to Node for system metrics, and archive or delete it from the
            dashboard menu whenever you&apos;re done.
          </AlertDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8 text-cyan-900 hover:bg-cyan-400/20 hover:text-cyan-950 dark:text-cyan-100 dark:hover:text-cyan-50"
            onClick={dismissDemoIntro}
            aria-label="Dismiss demo intro"
          >
            <IconX className="h-4 w-4" />
          </Button>
        </Alert>
      ) : null}
      {/* Author, last updated, and visibility metadata */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {hiddenAt && (
          <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
            <IconEyeOff className="h-3 w-3" />
            Hidden
          </span>
        )}
        {dashboardUpdatedAt && (
          <span className="flex items-center gap-1">
            <IconClock className="h-3 w-3" />
            Updated{" "}
            {new Date(dashboardUpdatedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
        {dashboardOwner && (
          <span className="flex items-center gap-1">
            <IconUser className="h-3 w-3" />
            {dashboardOwner.split("@")[0]}
          </span>
        )}
        <span
          className={`flex items-center gap-1.5 font-medium ${
            dashboardVisibility === "public"
              ? "text-green-600"
              : dashboardVisibility === "org"
                ? "text-blue-600"
                : "text-yellow-600"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              dashboardVisibility === "public"
                ? "bg-green-500"
                : dashboardVisibility === "org"
                  ? "bg-blue-500"
                  : "bg-yellow-500"
            }`}
          />
          {dashboardVisibility === "public"
            ? "Public"
            : dashboardVisibility === "org"
              ? "Shared with org"
              : "Private"}
        </span>
      </div>

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
          placeholder="Add a description"
          className="text-sm resize-y"
        />
      ) : dashboard.description ? (
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
          Add description
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
      {dashboard.filters && dashboard.filters.length > 0 && (
        <DashboardFilterBar
          filters={dashboard.filters}
          onSaveView={canEdit ? handleSaveView : undefined}
        />
      )}

      {/* Panels grid */}
      {dashboard.panels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-3">
            <p>This dashboard has no panels yet.</p>
            {canEdit ? (
              <AddPanelPopover
                onSave={handleSavePanel}
                dashboardId={dashboardId ?? ""}
                existingPanelTitles={dashboard.panels.map((p) => p.title)}
                align="center"
              >
                <Button size="sm" variant="outline">
                  <IconPlus className="h-4 w-4 mr-1" />
                  Add your first panel
                </Button>
              </AddPanelPopover>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={canEdit ? handleDragEnd : undefined}
        >
          <SortableContext
            items={visiblePanels.map((p) => p.id)}
            strategy={rectSortingStrategy}
          >
            <div className="dashboard-grid-container flex flex-col gap-4">
              {panelGroups.map((group) => {
                const renderPanelCell = (panel: SqlPanel) => {
                  const resolved = panel.config?.description
                    ? {
                        ...panel,
                        config: {
                          ...panel.config,
                          description: interpolate(
                            panel.config.description,
                            vars,
                          ),
                        },
                      }
                    : panel;
                  const remoteEditor = remoteEditingPanels.get(panel.id);
                  const span = clampPanelWidth(panel.width, group.columns);
                  return (
                    <div
                      key={panel.id}
                      className="dashboard-grid-cell relative h-full"
                      style={
                        {
                          "--panel-span": span,
                          ...(remoteEditor
                            ? {
                                outline: `2px solid ${remoteEditor.color}`,
                                outlineOffset: 2,
                                borderRadius: 8,
                              }
                            : null),
                        } as React.CSSProperties
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
                        resolvedSql={interpolate(
                          serializePanelSql(panel.sql),
                          vars,
                        )}
                        gridColumns={group.columns}
                        onRemove={() => removePanel(panel.id)}
                        onToggleWidth={() =>
                          toggleWidth(panel.id, group.columns)
                        }
                        onEdit={() => openEditPanel(panel)}
                        onSaveSql={(sql) => handleSavePanel({ ...panel, sql })}
                        editable={canEdit}
                      />
                    </div>
                  );
                };

                const renderSection = (section: SqlPanel) => {
                  const remoteEditor = remoteEditingPanels.get(section.id);
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
                      className="relative"
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
                      />
                    </div>
                  );
                };

                return (
                  <Fragment key={group.key}>
                    {group.section && renderSection(group.section)}
                    {group.panels.length > 0 && (
                      <div
                        className="dashboard-grid"
                        style={
                          {
                            "--dash-cols": group.columns,
                          } as React.CSSProperties
                        }
                      >
                        {group.panels.map(renderPanelCell)}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </SortableContext>
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
