import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { getIdToken } from "@/lib/auth";
import { SqlChartCard } from "./SqlChartCard";
import {
  DashboardFilterBar,
  FILTER_PARAM_PREFIX,
  resolveFilterVars,
} from "./DashboardFilterBar";
import { interpolate } from "./interpolate";
import type { SqlDashboardConfig } from "./types";
import { useUserPref } from "@/hooks/use-user-pref";
import { useDashboardViews } from "@/hooks/use-dashboard-views";
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

async function fetchDashboard(id: string): Promise<SqlDashboardConfig | null> {
  const res = await fetchWithAuth(`/api/sql-dashboards/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    name: data.name ?? "Untitled Dashboard",
    description: data.description,
    filters: data.filters,
    variables: data.variables,
    panels: data.panels ?? [],
  };
}

async function saveDashboard(id: string, data: SqlDashboardConfig) {
  await fetchWithAuth(`/api/sql-dashboards/${id}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export default function SqlDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: routeId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const dashboardId = searchParams.get("id") || routeId;

  const [dashboard, setDashboard] = useState<SqlDashboardConfig | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [loaded, setLoaded] = useState(false);

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
    if (!dashboardId) return;
    fetchDashboard(dashboardId).then((d) => {
      if (d) {
        setDashboard(d);
      } else {
        setDashboard({ name: "Untitled Dashboard", panels: [] });
      }
      setLoaded(true);
    });
  }, [dashboardId]);

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
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
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

  const persist = useCallback(
    (updated: SqlDashboardConfig) => {
      if (!dashboardId) return;
      setDashboard(updated);
      saveDashboard(dashboardId, updated).then(() => {
        queryClient.invalidateQueries({
          queryKey: ["sql-dashboards-sidebar"],
        });
        queryClient.invalidateQueries({
          queryKey: ["sql-dashboards-palette"],
        });
      });
    },
    [dashboardId, queryClient],
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
    (panelId: string) => {
      if (!dashboard) return;
      persist({
        ...dashboard,
        panels: dashboard.panels.map((p) =>
          p.id === panelId ? { ...p, width: p.width === 1 ? 2 : 1 } : p,
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

  const vars = useMemo<Record<string, string>>(() => {
    const filterValues = dashboard?.filters
      ? resolveFilterVars(
          dashboard.filters,
          (key) => searchParams.get(FILTER_PARAM_PREFIX + key) ?? "",
        )
      : {};
    return { ...(dashboard?.variables ?? {}), ...filterValues };
  }, [dashboard?.variables, dashboard?.filters, searchParams]);

  const handleDelete = useCallback(async () => {
    if (!dashboardId) return;
    await fetchWithAuth(`/api/sql-dashboards/${dashboardId}`, {
      method: "DELETE",
    });
    queryClient.invalidateQueries({ queryKey: ["sql-dashboards-sidebar"] });
    queryClient.invalidateQueries({ queryKey: ["sql-dashboards-palette"] });
    window.location.href = "/";
  }, [dashboardId, queryClient]);

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
              className="text-lg font-semibold hover:text-primary flex items-center gap-1"
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
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          onClick={handleDelete}
        >
          <IconTrash className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      {dashboard.filters && dashboard.filters.length > 0 && (
        <DashboardFilterBar
          filters={dashboard.filters}
          onSaveView={handleSaveView}
        />
      )}

      {/* Panels grid */}
      {dashboard.panels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-3">
            <p>
              This dashboard has no panels yet. Ask the agent to add SQL panels.
            </p>
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={dashboard.panels.map((p) => p.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {dashboard.panels.map((panel) => (
                <SqlChartCard
                  key={panel.id}
                  panel={panel}
                  resolvedSql={interpolate(panel.sql, vars)}
                  onRemove={() => removePanel(panel.id)}
                  onToggleWidth={() => toggleWidth(panel.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
