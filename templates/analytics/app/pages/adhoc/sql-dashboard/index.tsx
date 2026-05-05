import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useParams, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import {
  ShareButton,
  PresenceBar,
  useCollaborativeDoc,
  generateTabId,
  emailToColor,
  emailToName,
  useSession,
  agentNativePath,
  appApiPath,
  type CollabUser,
} from "@agent-native/core/client";
import { getIdToken } from "@/lib/auth";
import { SqlChartCard } from "./SqlChartCard";
import {
  DashboardFilterBar,
  FILTER_PARAM_PREFIX,
  resolveFilterVars,
} from "./DashboardFilterBar";
import { interpolate } from "./interpolate";
import { AddPanelPopover, PanelEditorDialog } from "./PanelEditorDialog";
import { ViewsMenu } from "./ViewsMenu";
import type { SqlDashboardConfig, SqlPanel } from "./types";
import { useUserPref } from "@/hooks/use-user-pref";
import { useDashboardViews } from "@/hooks/use-dashboard-views";
import { incrementItemView } from "@/lib/item-popularity";
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

async function fetchWithAuth(url: string, options?: RequestInit) {
  const token = await getIdToken();
  return fetch(appApiPath(url), {
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

/**
 * Save dashboard config. Throws on non-2xx with the server's error message so
 * callers (e.g. the panel editor dialog) can surface BigQuery validation
 * errors inline instead of silently swallowing them.
 */
async function saveDashboard(id: string, data: SqlDashboardConfig) {
  const res = await fetchWithAuth(`/api/sql-dashboards/${id}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let message = `Save failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // non-JSON body — fall back to generic message
    }
    throw new Error(message);
  }
}

export default function SqlDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: routeId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const dashboardId = searchParams.get("id") || routeId;

  const [dashboard, setDashboard] = useState<SqlDashboardConfig | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState("");
  const [loaded, setLoaded] = useState(false);

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
    if (!dashboardId) return;
    fetchDashboard(dashboardId).then((d) => {
      if (d) {
        setDashboard(d);
        incrementItemView("dashboard", dashboardId);
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
      setDashboard(updated);
      pushToCollab(updated);
      saveDashboard(dashboardId, updated)
        .then(() => {
          queryClient.invalidateQueries({
            queryKey: ["sql-dashboards-sidebar"],
          });
          queryClient.invalidateQueries({
            queryKey: ["sql-dashboards-palette"],
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
    [dashboardId, queryClient, pushToCollab],
  );

  /**
   * Persist that throws — used by the panel editor dialog so it can keep the
   * dialog open and display the BigQuery validation error inline.
   */
  const persistThrow = useCallback(
    async (updated: SqlDashboardConfig) => {
      if (!dashboardId) return;
      await saveDashboard(dashboardId, updated);
      setDashboard(updated);
      pushToCollab(updated);
      queryClient.invalidateQueries({ queryKey: ["sql-dashboards-sidebar"] });
      queryClient.invalidateQueries({ queryKey: ["sql-dashboards-palette"] });
    },
    [dashboardId, queryClient, pushToCollab],
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

  const handleDelete = useCallback(async () => {
    if (!dashboardId) return;
    await fetchWithAuth(`/api/sql-dashboards/${dashboardId}`, {
      method: "DELETE",
    });
    queryClient.invalidateQueries({ queryKey: ["sql-dashboards-sidebar"] });
    queryClient.invalidateQueries({ queryKey: ["sql-dashboards-palette"] });
    navigate("/");
  }, [dashboardId, queryClient, navigate]);

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
            className="group text-lg font-semibold hover:text-primary flex items-center gap-1 truncate"
            onClick={() => {
              setNameInput(dashboard.name);
              setEditingName(true);
            }}
          >
            <span className="truncate">{dashboard.name}</span>
            <IconPencil className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
          </button>
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
        {dashboardId && <ViewsMenu dashboardId={dashboardId} />}
        {dashboardId ? (
          <ShareButton
            resourceType="dashboard"
            resourceId={dashboardId}
            resourceTitle={dashboard.name}
            variant="compact"
          />
        ) : null}
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
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              title="Delete dashboard"
            >
              <IconTrash className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete dashboard?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &ldquo;{dashboard?.name}&rdquo;.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
      {/* Description (click to edit) */}
      {editingDescription ? (
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
          className="text-sm text-muted-foreground hover:text-foreground text-left flex items-start gap-1.5 w-full group"
          onClick={() => {
            setDescriptionInput(dashboard.description ?? "");
            setEditingDescription(true);
          }}
        >
          <span className="flex-1">{dashboard.description}</span>
          <IconPencil className="h-3 w-3 mt-0.5 shrink-0 opacity-0 group-hover:opacity-60" />
        </button>
      ) : (
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
      )}

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
            <p>This dashboard has no panels yet.</p>
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
            <div className="grid auto-rows-auto grid-cols-1 items-stretch gap-4 md:grid-cols-2">
              {dashboard.panels.map((panel) => {
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
                return (
                  <div
                    key={panel.id}
                    className="relative h-full"
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
                      resolvedSql={interpolate(panel.sql, vars)}
                      onRemove={() => removePanel(panel.id)}
                      onToggleWidth={() => toggleWidth(panel.id)}
                      onEdit={() => openEditPanel(panel)}
                      onSaveSql={(sql) => handleSavePanel({ ...panel, sql })}
                    />
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <PanelEditorDialog
        open={editorOpen}
        onOpenChange={handleEditorOpenChange}
        panel={editingPanel}
        onSave={handleSavePanel}
        dashboardId={dashboardId ?? ""}
        existingPanelTitles={dashboard.panels.map((p) => p.title)}
      />
    </div>
  );
}
