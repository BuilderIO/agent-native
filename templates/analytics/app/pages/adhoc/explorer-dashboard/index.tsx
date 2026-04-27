import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconPlus,
  IconTrash,
  IconGripVertical,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconPencil,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  PresenceBar,
  useCollaborativeDoc,
  generateTabId,
  emailToColor,
  emailToName,
  useSession,
  type CollabUser,
} from "@agent-native/core/client";
import { getIdToken } from "@/lib/auth";
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

async function fetchWithAuth(url: string, options?: RequestInit) {
  const token = await getIdToken();
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  });
}

async function fetchDashboard(
  id: string,
): Promise<ExplorerDashboardData | null> {
  const res = await fetchWithAuth(`/api/explorer-dashboards/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  return { name: data.name ?? "Untitled Dashboard", charts: data.charts ?? [] };
}

async function saveDashboard(id: string, data: ExplorerDashboardData) {
  await fetchWithAuth(`/api/explorer-dashboards/${id}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function fetchSavedConfigs(): Promise<SavedConfig[]> {
  const res = await fetchWithAuth("/api/explorer-configs");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.configs ?? [])
    .filter((c: any) => c.id !== "_autosave")
    .map((c: any) => ({ id: c.id, name: c.name }));
}

export default function ExplorerDashboardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dashboardId = searchParams.get("id");

  const [dashboard, setDashboard] = useState<ExplorerDashboardData | null>(
    null,
  );
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [addChartOpen, setAddChartOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
      fetch(`/_agent-native/collab/${collabDocId}/text`, {
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

  useEffect(() => {
    if (!dashboardId) return;
    fetchDashboard(dashboardId).then((d) => {
      if (d) {
        setDashboard(d);
      } else {
        setDashboard({ name: "Untitled Dashboard", charts: [] });
      }
      setLoaded(true);
    });
  }, [dashboardId]);

  const persist = useCallback(
    (updated: ExplorerDashboardData) => {
      if (!dashboardId) return;
      setDashboard(updated);
      pushToCollab(updated);
      saveDashboard(dashboardId, updated).then(() => {
        queryClient.invalidateQueries({
          queryKey: ["explorer-dashboards-palette"],
        });
        queryClient.invalidateQueries({
          queryKey: ["explorer-dashboards-sidebar"],
        });
      });
    },
    [dashboardId, queryClient, pushToCollab],
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
      if (!dashboard) return;
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
    [dashboard, persist],
  );

  const handleSaveName = useCallback(() => {
    if (!dashboard) return;
    const name = nameInput.trim() || "Untitled Dashboard";
    persist({ ...dashboard, name });
    setEditingName(false);
  }, [dashboard, nameInput, persist]);

  if (!dashboardId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No dashboard selected
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!dashboard) return null;

  // Config name lookup
  const configNameMap = new Map(savedConfigs.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {editingName ? (
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
              className="h-8 w-full sm:w-64 text-lg font-semibold"
              autoFocus
            />
          ) : (
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
          )}
        </div>
        <div className="flex items-center gap-2">
          <PresenceBar
            activeUsers={activeUsers}
            agentPresent={agentPresent}
            agentActive={agentActive}
            currentUserEmail={session?.email}
          />
          <Button size="sm" onClick={() => setAddChartOpen(true)}>
            <IconPlus className="h-4 w-4 mr-1" />
            Add Chart
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={async () => {
              if (!dashboardId) return;
              const token = await getIdToken();
              await fetch(`/api/explorer-dashboards/${dashboardId}`, {
                method: "DELETE",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              queryClient.invalidateQueries({
                queryKey: ["explorer-dashboards-sidebar"],
              });
              queryClient.invalidateQueries({
                queryKey: ["explorer-dashboards-palette"],
              });
              navigate("/adhoc/explorer");
            }}
          >
            <IconTrash className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Charts grid */}
      {dashboard.charts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-3">
            <p>
              No charts yet. Add saved explorer charts to build your dashboard.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddChartOpen(true)}
            >
              <IconPlus className="h-4 w-4 mr-1" />
              Add Chart
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
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
                    navigate(`/adhoc/explorer?config=${chart.configId}`)
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add Chart Dialog */}
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
    </div>
  );
}
