import {
  PresenceBar,
  useCollaborativeDoc,
  generateTabId,
  emailToColor,
  emailToName,
  useSession,
  useChangeVersions,
  useActionMutation,
  agentNativePath,
  callAction,
  useT,
  type CollabUser,
} from "@agent-native/core/client";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import {
  IconPlus,
  IconTrash,
  IconPencil,
  IconArchive,
  IconDots,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconHistory,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { toast } from "sonner";

import { DashboardHistoryPanel } from "@/components/dashboard/DashboardHistoryPanel";
import {
  DashboardTitleSkeleton,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDashboardChatContext } from "@/hooks/use-dashboard-chat-context";
import {
  resourceCanEdit,
  resourceCanManage,
  type ResourceAccess,
} from "@/lib/resource-access";

import { DashboardSkeleton } from "../DashboardSkeleton";
import { DashboardChartCard } from "./ChartCard";

export interface DashboardChart {
  id: string;
  configId: string;
  width: 1 | 2;
}

export interface ExplorerDashboardData {
  name: string;
  charts: DashboardChart[];
}

interface SavedConfig {
  id: string;
  name: string;
}

const TAB_ID = generateTabId();

type FetchedExplorerDashboard = {
  data: ExplorerDashboardData;
  archivedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
} & ResourceAccess;

function ExplorerDashboardDragPreview({ title }: { title: string | null }) {
  if (!title) return null;

  return (
    <div className="explorer-dashboard-drag-preview flex max-w-64 items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-sm font-medium text-foreground shadow-lg ring-1 ring-primary/20">
      <IconGripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{title}</span>
    </div>
  );
}

async function fetchDashboard(
  id: string,
): Promise<FetchedExplorerDashboard | null> {
  try {
    const raw: any = await callAction(
      "get-explorer-dashboard",
      { id },
      { method: "GET" },
    );
    if (!raw) return null;
    return {
      data: {
        name: raw.name ?? "Untitled Dashboard",
        charts: raw.charts ?? [],
      },
      archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : null,
      hiddenAt: typeof raw.hiddenAt === "string" ? raw.hiddenAt : null,
      hiddenBy: typeof raw.hiddenBy === "string" ? raw.hiddenBy : null,
      role: typeof raw.role === "string" ? raw.role : undefined,
      canEdit: typeof raw.canEdit === "boolean" ? raw.canEdit : undefined,
      canManage: typeof raw.canManage === "boolean" ? raw.canManage : undefined,
    };
  } catch {
    return null;
  }
}

async function saveDashboard(id: string, data: ExplorerDashboardData) {
  await callAction("save-explorer-dashboard", {
    id,
    data: data as unknown as Record<string, unknown>,
  });
}

async function fetchSavedConfigs(): Promise<SavedConfig[]> {
  try {
    const rows = await callAction(
      "list-explorer-configs",
      {},
      { method: "GET" },
    );
    return (Array.isArray(rows) ? rows : [])
      .filter((c: any) => c.id !== "_autosave")
      .map((c: any) => ({ id: c.id, name: c.name }));
  } catch {
    return [];
  }
}

export default function ExplorerDashboardPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dashboardId = searchParams.get("id");

  const [dashboard, setDashboard] = useState<ExplorerDashboardData | null>(
    null,
  );
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [hiddenAt, setHiddenAt] = useState<string | null>(null);
  const [hiddenBy, setHiddenBy] = useState<string | null>(null);
  const [resourceAccess, setResourceAccess] = useState<ResourceAccess | null>(
    null,
  );
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [addChartOpen, setAddChartOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dashboardActionsOpen, setDashboardActionsOpen] = useState(false);
  const [activeDragChartId, setActiveDragChartId] = useState<string | null>(
    null,
  );
  const canEdit = resourceCanEdit(resourceAccess);
  const canManage = resourceCanManage(resourceAccess);
  useDashboardChatContext({
    id: dashboardId,
    kind: "explorer",
    title: dashboard?.name,
    panelCount: dashboard?.charts.length,
    canEdit,
  });
  const { mutateAsync: hideDashboardAction, isPending: unhidePending } =
    useActionMutation("hide-dashboard");

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
    isSynced: collabSynced,
    activeUsers,
    agentActive,
    agentPresent,
  } = useCollaborativeDoc({
    docId: collabDocId,
    requestSource: TAB_ID,
    user: currentUser,
  });

  // Listen for remote collab changes
  useEffect(() => {
    if (!ydoc || !collabSynced) return;
    const ytext = ydoc.getText("content");
    const handler = () => {
      const raw = ytext.toString();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as ExplorerDashboardData;
        if (parsed && parsed.charts) {
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

  /**
   * Push a config update through the collab layer so other tabs/users
   * receive the change in real time.
   */
  const pushToCollab = useCallback(
    (updated: ExplorerDashboardData) => {
      if (!collabDocId) return;
      const body = JSON.stringify(updated);
      fetch(agentNativePath(`/_agent-native/collab/${collabDocId}/text`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body, requestSource: TAB_ID }),
      }).catch(() => {});
    },
    [collabDocId],
  );

  const { data: savedConfigs = [] } = useQuery({
    queryKey: ["explorer-configs"],
    queryFn: fetchSavedConfigs,
    staleTime: 30_000,
  });

  // Refetch the dashboard whenever the `dashboards` source bumps OR any agent
  // action runs — the same "agent writes show up without a manual refresh"
  // pattern the SQL dashboard page uses. We depend on both because:
  // - `dashboards` covers same-process writes from upsertDashboard
  // - `action` covers every successful agent action and is emitted by the
  //   agent runner unconditionally, which makes the refresh resilient even if
  //   the dashboards-store emit is missed (different process, etc.).
  // Without this, an agent edit to an explorer dashboard only reached the open
  // page through the collab Y.Text channel, which is silent on the first edit
  // (seedFromText doesn't emit) — so the title/charts could go stale.
  const sync = useChangeVersions(["dashboards", "action"]);
  const dashboardQuery = useQuery({
    // dashboardId is part of the key, so React Query keeps a separate cache
    // entry per dashboard — no `placeholderData` (it would carry the previous
    // dashboard's data across an id switch and flash the wrong dashboard).
    // The skeleton shows until fresh data for the current id arrives, exactly
    // like the original one-shot load. Same-key refetches (agent writes) keep
    // the rendered `dashboard` state until the new data lands, so there's no
    // flicker on those.
    queryKey: ["data", "explorer-dashboard", dashboardId, sync],
    enabled: !!dashboardId,
    queryFn: async () => {
      if (!dashboardId) return null;
      return fetchDashboard(dashboardId);
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!dashboardId) return;
    setLoaded(false);
    setDashboard(null);
    setHiddenAt(null);
    setHiddenBy(null);
    setResourceAccess(null);
    setEditingName(false);
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboardId || !dashboardQuery.isSuccess) return;
    const d = dashboardQuery.data;
    if (d) {
      setDashboard(d.data);
      setArchivedAt(d.archivedAt);
      setHiddenAt(d.hiddenAt);
      setHiddenBy(d.hiddenBy);
      setResourceAccess({
        role: d.role,
        canEdit: d.canEdit,
        canManage: d.canManage,
      });
    } else {
      setDashboard({
        name: t("explorerDashboard.untitledDashboard"),
        charts: [],
      });
      setArchivedAt(null);
      setHiddenAt(null);
      setHiddenBy(null);
      setResourceAccess(null);
    }
    setLoaded(true);
  }, [dashboardId, dashboardQuery.data, dashboardQuery.isSuccess]);

  const handleArchive = useCallback(async () => {
    if (!dashboardId || !canEdit) return;
    if (archivedAt) return;
    try {
      await callAction("archive-dashboard", {
        id: dashboardId,
        archived: true,
      });
      queryClient.invalidateQueries({
        queryKey: ["explorer-dashboards-sidebar"],
      });
      queryClient.invalidateQueries({
        queryKey: ["explorer-dashboards-palette"],
      });
      toast.success(
        t("explorerDashboard.archived", {
          name: dashboard?.name ?? t("explorerDashboard.dashboardFallback"),
        }),
      );
      navigate("/dashboards/explorer");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("explorerDashboard.archiveFailed"),
      );
    }
  }, [
    dashboardId,
    canEdit,
    archivedAt,
    queryClient,
    navigate,
    dashboard?.name,
  ]);

  const handleUnhide = useCallback(async () => {
    if (!dashboardId) return;
    try {
      await hideDashboardAction({ id: dashboardId, hidden: false });
      setHiddenAt(null);
      setHiddenBy(null);
      queryClient.invalidateQueries({
        queryKey: ["explorer-dashboards-sidebar"],
      });
      queryClient.invalidateQueries({
        queryKey: ["explorer-dashboards-palette"],
      });
      queryClient.invalidateQueries({
        queryKey: ["data", "explorer-dashboard", dashboardId],
      });
      toast.success(
        t("explorerDashboard.unhid", {
          name: dashboard?.name ?? t("explorerDashboard.dashboardFallback"),
        }),
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("explorerDashboard.unhideFailed"),
      );
    }
  }, [dashboardId, dashboard?.name, hideDashboardAction, queryClient]);

  const persist = useCallback(
    (updated: ExplorerDashboardData) => {
      if (!dashboardId) return;
      if (!canEdit) {
        toast.error(t("explorerDashboard.viewOnly"));
        return;
      }
      setDashboard(updated);
      pushToCollab(updated);
      // Keep the cached dashboard query in sync with the optimistic write so a
      // `sync` bump from our own save doesn't briefly flash stale data before
      // the refetch lands.
      queryClient.setQueriesData<FetchedExplorerDashboard | null>(
        { queryKey: ["data", "explorer-dashboard", dashboardId] },
        (prev) => (prev ? { ...prev, data: updated } : prev),
      );
      saveDashboard(dashboardId, updated).then(() => {
        queryClient.invalidateQueries({
          queryKey: ["explorer-dashboards-palette"],
        });
        queryClient.invalidateQueries({
          queryKey: ["explorer-dashboards-sidebar"],
        });
      });
    },
    [dashboardId, canEdit, queryClient, pushToCollab],
  );

  const addChart = useCallback(
    (configId: string) => {
      if (!dashboard) return;
      const newChart: DashboardChart = {
        id: `${configId}-${Date.now()}`,
        configId,
        width: 1,
      };
      persist({ ...dashboard, charts: [...dashboard.charts, newChart] });
      setAddChartOpen(false);
    },
    [dashboard, persist],
  );

  const removeChart = useCallback(
    (chartId: string) => {
      if (!dashboard) return;
      persist({
        ...dashboard,
        charts: dashboard.charts.filter((c) => c.id !== chartId),
      });
    },
    [dashboard, persist],
  );

  const toggleWidth = useCallback(
    (chartId: string) => {
      if (!dashboard) return;
      persist({
        ...dashboard,
        charts: dashboard.charts.map((c) =>
          c.id === chartId ? { ...c, width: c.width === 1 ? 2 : 1 } : c,
        ),
      });
    },
    [dashboard, persist],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragChartId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragChartId(null);
      if (!dashboard || !canEdit) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = dashboard.charts.findIndex((c) => c.id === active.id);
      const newIndex = dashboard.charts.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      persist({
        ...dashboard,
        charts: arrayMove(dashboard.charts, oldIndex, newIndex),
      });
    },
    [dashboard, canEdit, persist],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragChartId(null);
  }, []);

  const handleSaveName = useCallback(() => {
    if (!dashboard || !canEdit) return;
    const name = nameInput.trim() || t("explorerDashboard.untitledDashboard");
    persist({ ...dashboard, name });
    setEditingName(false);
  }, [dashboard, canEdit, nameInput, persist]);

  useSetPageTitle(
    !dashboardId ? (
      <h1 className="text-lg font-semibold tracking-tight truncate">
        {t("explorerDashboard.dashboard")}
      </h1>
    ) : dashboard ? (
      <h1 className="text-lg font-semibold tracking-tight truncate">
        {dashboard.name}
      </h1>
    ) : !loaded ? (
      <DashboardTitleSkeleton />
    ) : null,
  );

  if (!dashboardId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {t("explorerDashboard.noDashboardSelected")}
      </div>
    );
  }

  if (!loaded) {
    return <DashboardSkeleton />;
  }

  if (!dashboard) return null;

  // Config name lookup
  const configNameMap = new Map(savedConfigs.map((c) => [c.id, c.name]));
  const activeDragChart = activeDragChartId
    ? (dashboard.charts.find((chart) => chart.id === activeDragChartId) ?? null)
    : null;
  const activeDragChartTitle = activeDragChart
    ? (configNameMap.get(activeDragChart.configId) ?? activeDragChart.configId)
    : null;

  return (
    <div className="space-y-4">
      {hiddenAt ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
          <IconEyeOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1">
            {t("explorerDashboard.hiddenDescription")}
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
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {hiddenAt ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 px-2 py-1 text-xs font-medium text-amber-700 dark:border-amber-900/70 dark:text-amber-300">
              <IconEyeOff className="h-3 w-3" />
              Hidden
            </span>
          ) : null}
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
              className="text-lg font-semibold hover:text-primary transition-colors flex items-center gap-1"
              onClick={() => {
                setNameInput(dashboard.name);
                setEditingName(true);
              }}
            >
              {dashboard.name}
              <IconPencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ) : (
            <h1 className="text-lg font-semibold">{dashboard.name}</h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          <PresenceBar
            activeUsers={activeUsers}
            agentPresent={agentPresent}
            agentActive={agentActive}
            currentUserEmail={session?.email}
          />
          {canEdit ? (
            <Button size="sm" onClick={() => setAddChartOpen(true)}>
              <IconPlus className="h-4 w-4 mr-1" />
              {t("explorerDashboard.addChart")}
            </Button>
          ) : null}
          {dashboardId || canEdit || canManage ? (
            <DropdownMenu
              open={dashboardActionsOpen}
              onOpenChange={setDashboardActionsOpen}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={t("explorerDashboard.dashboardActions")}
                    >
                      <IconDots className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  {t("explorerDashboard.moreActions")}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-44">
                {dashboardId ? (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setDashboardActionsOpen(false);
                      setHistoryOpen(true);
                    }}
                  >
                    <IconHistory className="mr-2 h-3.5 w-3.5" />
                    {t("dashboard.historyTitle")}
                  </DropdownMenuItem>
                ) : null}
                {dashboardId && canEdit && !archivedAt ? (
                  <DropdownMenuSeparator />
                ) : null}
                {canEdit && !archivedAt ? (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setDashboardActionsOpen(false);
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
                      setDashboardActionsOpen(false);
                      setConfirmDeleteOpen(true);
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <IconTrash className="mr-2 h-3.5 w-3.5" />
                    {t("explorerDashboard.deletePermanently")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {dashboardId ? (
            <DashboardHistoryPanel
              dashboardId={dashboardId}
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              canRestore={canEdit && !archivedAt}
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
                    {t("explorerDashboard.deletePermanentlyTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("explorerDashboard.deletePermanentlyDescription", {
                      name: dashboard.name,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("sidebar.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      if (!dashboardId || !canManage) return;
                      try {
                        await callAction("delete-explorer-dashboard", {
                          id: dashboardId,
                        });
                        queryClient.invalidateQueries({
                          queryKey: ["explorer-dashboards-sidebar"],
                        });
                        queryClient.invalidateQueries({
                          queryKey: ["explorer-dashboards-palette"],
                        });
                        setConfirmDeleteOpen(false);
                        navigate("/dashboards/explorer");
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : t("sidebar.deleteFailed", {
                                name: dashboard.name,
                              }),
                        );
                      }
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t("explorerDashboard.deletePermanently")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>

      {/* Charts grid */}
      {dashboard.charts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-3">
            <p>{t("explorerDashboard.noChartsYet")}</p>
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddChartOpen(true)}
              >
                <IconPlus className="h-4 w-4 mr-1" />
                {t("explorerDashboard.addChart")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={canEdit ? handleDragStart : undefined}
          onDragEnd={canEdit ? handleDragEnd : undefined}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={dashboard.charts.map((c) => c.id)}
            strategy={rectSortingStrategy}
          >
            <div
              className="explorer-dashboard-grid grid grid-cols-1 gap-4"
              data-dashboard-dragging={activeDragChartId ? "true" : undefined}
            >
              {dashboard.charts.map((chart) => (
                <DashboardChartCard
                  key={chart.id}
                  chart={chart}
                  configName={
                    configNameMap.get(chart.configId) ?? chart.configId
                  }
                  onRemove={() => removeChart(chart.id)}
                  onToggleWidth={() => toggleWidth(chart.id)}
                  onEdit={() =>
                    navigate(`/dashboards/explorer?config=${chart.configId}`)
                  }
                  editable={canEdit}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay adjustScale={false} dropAnimation={null} zIndex={1000}>
            <ExplorerDashboardDragPreview title={activeDragChartTitle} />
          </DragOverlay>
        </DndContext>
      )}

      {/* Add Chart Dialog */}
      {canEdit ? (
        <Dialog open={addChartOpen} onOpenChange={setAddChartOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("explorerDashboard.addChart")}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[400px] overflow-auto space-y-1">
              {savedConfigs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("explorerDashboard.noSavedExplorerCharts")}
                </p>
              ) : (
                savedConfigs.map((config) => (
                  <button
                    key={config.id}
                    onClick={() => addChart(config.id)}
                    className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors flex items-center justify-between"
                  >
                    <span>{config.name}</span>
                    <IconPlus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddChartOpen(false)}>
                {t("sidebar.cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
