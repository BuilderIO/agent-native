import {
  deleteClientAppState,
  readClientAppState,
  removeAgentChatContextItem,
  setAgentChatContextItem,
  setClientAppState,
  useAgentChatContext,
} from "@agent-native/core/client";
import { useCallback, useEffect } from "react";

import { TAB_ID } from "@/lib/tab-id";

const DASHBOARD_CONTEXT_KEY = "analytics-selected-dashboard";
const DASHBOARD_PANEL_CONTEXT_KEY = "analytics-selected-dashboard-panel";
const SELECTED_OBJECT_STATE_KEY = "selected-object";
const SELECTED_OBJECT_SOURCE_FIELD = "__agentNativeSelectedObjectSource";

export interface DashboardChatContextArgs {
  id: string | null | undefined;
  kind: "explorer" | "sql";
  title?: string | null;
  panelCount?: number;
  canEdit?: boolean;
}

export interface DashboardPanelChatContextArgs {
  panelId: string;
  panelTitle: string;
  panelKind: "chart" | "table" | "extension";
  chartType?: string | null;
  source?: string | null;
  configId?: string | null;
  extensionId?: string | null;
}

export interface SelectDashboardPanelOptions {
  focus?: boolean;
  openSidebar?: boolean;
}

export interface DashboardChatContextResult {
  selectedPanelId: string | null;
  selectPanelForChat: (
    panel: DashboardPanelChatContextArgs,
    options?: SelectDashboardPanelOptions,
  ) => void;
}

function dashboardContext(
  args: Required<Pick<DashboardChatContextArgs, "id" | "kind">> & {
    title: string;
    panelCount?: number;
    canEdit?: boolean;
  },
): string {
  const lines = [
    `The user currently has this Analytics dashboard selected: ${args.title}.`,
    `Dashboard id: ${args.id}`,
    `Dashboard kind: ${args.kind}`,
  ];
  if (typeof args.panelCount === "number") {
    lines.push(`Panel count: ${args.panelCount}`);
  }
  if (typeof args.canEdit === "boolean") {
    lines.push(`User can edit: ${args.canEdit ? "yes" : "no"}`);
  }
  if (typeof window !== "undefined") {
    lines.push(
      `Current URL: ${window.location.pathname}${window.location.search}`,
    );
  }
  lines.push(
    "Use the Analytics dashboard actions to inspect, edit, or restore this dashboard.",
  );
  return lines.join("\n");
}

async function deleteSelectedObjectIfOwned(dashboardId: string) {
  try {
    const current = await readClientAppState<Record<string, unknown>>(
      SELECTED_OBJECT_STATE_KEY,
    );
    if (current?.[SELECTED_OBJECT_SOURCE_FIELD] !== TAB_ID) return;
    const selectedDashboardId =
      current.type === "dashboard"
        ? current.id
        : current.type === "dashboard-panel"
          ? current.dashboardId
          : null;
    if (selectedDashboardId !== dashboardId) return;
    await deleteClientAppState(SELECTED_OBJECT_STATE_KEY, {
      keepalive: true,
      requestSource: TAB_ID,
    });
  } catch {
    // Best effort only; avoid clearing another tab's selected object on errors.
  }
}

function panelSelectionMarker(dashboardId: string, panelId: string): string {
  return `Analytics panel selection: dashboard=${encodeURIComponent(
    dashboardId,
  )}; panel=${encodeURIComponent(panelId)}`;
}

function parsePanelSelection(
  context: string,
): { dashboardId: string; panelId: string } | null {
  const match = context.match(
    /^Analytics panel selection: dashboard=([^;]+); panel=(.+)$/m,
  );
  if (!match) return null;
  try {
    return {
      dashboardId: decodeURIComponent(match[1]),
      panelId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

export function useDashboardChatContext(
  args: DashboardChatContextArgs,
): DashboardChatContextResult {
  const { id, kind, title, panelCount, canEdit } = args;
  const { items } = useAgentChatContext();
  const panelContext = items.find(
    (item) => item.key === DASHBOARD_PANEL_CONTEXT_KEY,
  );
  const panelSelection = panelContext
    ? parsePanelSelection(panelContext.context)
    : null;
  const selectedPanelId =
    id && panelSelection?.dashboardId === id ? panelSelection.panelId : null;
  const hasSelectedPanel = selectedPanelId !== null;

  const selectPanelForChat = useCallback(
    (
      panel: DashboardPanelChatContextArgs,
      options: SelectDashboardPanelOptions = {},
    ) => {
      if (!id) return;
      const displayDashboardTitle = title?.trim() || id;
      const displayPanelTitle = panel.panelTitle.trim() || panel.panelId;
      const contextLines = [
        panelSelectionMarker(id, panel.panelId),
        `The user selected this ${panel.panelKind} on the Analytics dashboard "${displayDashboardTitle}".`,
        `Dashboard id: ${id}`,
        `Dashboard kind: ${kind}`,
        `Panel id: ${panel.panelId}`,
        `Panel title: ${displayPanelTitle}`,
        `Panel kind: ${panel.panelKind}`,
        panel.chartType ? `Chart type: ${panel.chartType}` : "",
        panel.source ? `Data source: ${panel.source}` : "",
        panel.configId ? `Explorer config id: ${panel.configId}` : "",
        panel.extensionId ? `Extension id: ${panel.extensionId}` : "",
        kind === "sql"
          ? "Inspect this panel with get-sql-dashboard (includeConfig: true) before changing it, then use mutate-dashboard for edits."
          : "Inspect the linked Explorer config before changing this chart.",
      ].filter(Boolean);

      // The panel context occupies one stable composer slot, so selecting a
      // different panel replaces the prior chip instead of accumulating chips.
      setAgentChatContextItem({
        key: DASHBOARD_PANEL_CONTEXT_KEY,
        title: displayPanelTitle,
        context: contextLines.join("\n"),
        openSidebar: options.openSidebar ?? true,
        focus: options.focus ?? false,
      });
      setClientAppState(
        SELECTED_OBJECT_STATE_KEY,
        {
          type: "dashboard-panel",
          dashboardId: id,
          dashboardKind: kind,
          dashboardTitle: displayDashboardTitle,
          panelId: panel.panelId,
          panelTitle: displayPanelTitle,
          panelKind: panel.panelKind,
          chartType: panel.chartType || undefined,
          source: panel.source || undefined,
          configId: panel.configId || undefined,
          extensionId: panel.extensionId || undefined,
          [SELECTED_OBJECT_SOURCE_FIELD]: TAB_ID,
        },
        {
          keepalive: true,
          requestSource: TAB_ID,
        },
      ).catch(() => {});
    },
    [id, kind, title],
  );

  useEffect(() => {
    if (!id) return;
    const displayTitle = title?.trim() || id;

    setAgentChatContextItem({
      key: DASHBOARD_CONTEXT_KEY,
      title: `Dashboard: ${displayTitle}`,
      context: dashboardContext({
        id,
        kind,
        title: displayTitle,
        panelCount,
        canEdit,
      }),
      openSidebar: false,
      focus: false,
    });

    return () => {
      removeAgentChatContextItem({
        key: DASHBOARD_CONTEXT_KEY,
        openSidebar: false,
      });
    };
  }, [canEdit, id, kind, panelCount, title]);

  useEffect(() => {
    if (!id || hasSelectedPanel) return;
    const displayTitle = title?.trim() || id;
    setClientAppState(
      SELECTED_OBJECT_STATE_KEY,
      {
        type: "dashboard",
        id,
        kind,
        title: displayTitle,
        panelCount,
        canEdit,
        [SELECTED_OBJECT_SOURCE_FIELD]: TAB_ID,
      },
      {
        keepalive: true,
        requestSource: TAB_ID,
      },
    ).catch(() => {});
  }, [canEdit, hasSelectedPanel, id, kind, panelCount, title]);

  useEffect(() => {
    if (!id) return;
    return () => {
      removeAgentChatContextItem({
        key: DASHBOARD_PANEL_CONTEXT_KEY,
        openSidebar: false,
      });
      deleteSelectedObjectIfOwned(id);
    };
  }, [id]);

  return { selectedPanelId, selectPanelForChat };
}
