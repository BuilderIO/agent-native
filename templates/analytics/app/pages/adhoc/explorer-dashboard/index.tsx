import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  IconPlus,
  IconTrash,
  IconPencil,
  IconArchive,
  IconDots,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
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
  type CollabUser,
} from "@agent-native/core/client";
import {
  resourceCanEdit,
  resourceCanManage,
  type ResourceAccess,
} from "@/lib/resource-access";
import {
  DashboardTitleSkeleton,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
import { DashboardChartCard } from "./ChartCard";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const canEdit = resourceCanEdit(resourceAccess);
  const canManage = resourceCanManage(resourceAccess);
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
      setDashboard({ name: "Untitled Dashboard", charts: [] });
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
      toast.success(`Archived "${dashboard?.name ?? "dashboard"}"`);
      navigate("/dashboards/explorer");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't archive dashboard",
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
      toast.success(`Unhid "${dashboard?.name ?? "dashboard"}"`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't unhide dashboard",
      );
    }
  }, [dashboardId, dashboard?.name, hideDashboardAction, queryClient]);

  const persist = useCallback(
    (updated: ExplorerDashboardData) => {
      if (!dashboardId) return;
      if (!canEdit) {
        toast.error(
          "You can view this dashboard, but only editors can change it.",
        );
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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
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

  const handleSaveName = useCallback(() => {
    if (!dashboard || !canEdit) return;
    const name = nameInput.trim() || "Untitled Dashboard";
    persist({ ...dashboard, name });
    setEditingName(false);
  }, [dashboard, canEdit, nameInput, persist]);

  useSetPageTitle(
    !dashboardId ? (
      <h1 className="text-lg font-semibold tracking-tight truncate">
        Dashboard
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
        No dashboard selected
      </div>
    );
  }

  if (!loaded) {
    // Match the eventual DashboardChartCard layout (Card chrome + title row +
    // chart-body skeleton) so the transition from "dashboard config loading"
    // to "queries loading" doesn't morph skeleton shape — the title text just
    // fills in. Otherwise the bare h-64 rectangles jump into Card-chromed
    // panels and the page visibly shifts.
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

  if (!dashboard) return null;

  // Config name lookup
  const configNameMap = new Map(savedConfigs.map((c) => [c.id, c.name]));

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
              Add Chart
            </Button>
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
                    This permanently deletes &ldquo;{dashboard.name}&rdquo; and
                    cannot be undone. To keep it recoverable, choose Archive
                    instead.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
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
                            : "Couldn't delete dashboard",
                        );
                      }
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete permanently
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
            <p>
              No charts yet. Add saved explorer charts to build your dashboard.
            </p>
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddChartOpen(true)}
              >
                <IconPlus className="h-4 w-4 mr-1" />
                Add Chart
              </Button>
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
            items={dashboard.charts.map((c) => c.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </DndContext>
      )}

      {/* Add Chart Dialog */}
      {canEdit ? (
        <Dialog open={addChartOpen} onOpenChange={setAddChartOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Chart</DialogTitle>
            </DialogHeader>
            <div className="max-h-[400px] overflow-auto space-y-1">
              {savedConfigs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No saved explorer charts yet. Create one in the Explorer tool
                  first.
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
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
