import {
  SIDEBAR_STATE_CHANGE_EVENT,
  agentSelectionContextKey,
  listAgentChatContext,
  parseAgentSelectionContextKey,
  removeAgentChatContextItem,
  setAgentChatContextItem,
  type AgentSidebarStateChangeDetail,
  useAgentChatContext,
} from "@agent-native/core/client/agent-chat";
import { setClientAppState } from "@agent-native/core/client/hooks";
import {
  selectAgentSelectable,
  useAgentSelectable,
  type AgentSelectionTarget,
} from "@agent-native/toolkit/app/agent-select";
import { REAL_DATA_REQUIRED_MARKER } from "@shared/real-data-marker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearSelectedDashboardObjectIfOwned,
  type SelectedDashboardObject,
} from "@/lib/selected-object";
import { TAB_ID } from "@/lib/tab-id";

const DASHBOARD_CONTEXT_KEY = "analytics-selected-dashboard";
/** Picked panels go through the composer's shared Select mode. */
const PANEL_SELECTION_KIND = "panel";
const SELECTED_OBJECT_STATE_KEY = "selected-object";
const SELECTED_OBJECT_SOURCE_FIELD = "__agentNativeSelectedObjectSource";
const CONTEXT_PUBLISH_DELAY_MS = 250;

export interface DashboardChatContextArgs {
  id: string | null | undefined;
  kind: "explorer" | "sql";
  title?: string | null | undefined;
  panelCount?: number | undefined;
  canEdit?: boolean | undefined;
  editing?: boolean | undefined;
}

export interface DashboardPanelChatContextArgs {
  panelId: string;
  panelTitle: string;
  panelKind: "chart" | "table" | "extension";
  chartType?: string | null | undefined;
  source?: string | null | undefined;
  configId?: string | null | undefined;
  extensionId?: string | null | undefined;
}

export interface SelectDashboardPanelOptions {
  focus?: boolean;
  openSidebar?: boolean;
}

export interface DashboardChatContextResult {
  /** The most recently picked panel on this dashboard. */
  selectedPanelId: string | null;
  selectedPanelIds: readonly string[];
  selectPanelForChat: (
    panel: DashboardPanelChatContextArgs,
    options?: SelectDashboardPanelOptions,
  ) => void;
  /** The panel as a Select target, or null with no dashboard open. */
  panelSelectionTarget: (
    panel: DashboardPanelChatContextArgs,
  ) => AgentSelectionTarget | null;
}

const EMPTY_IDS: readonly string[] = [];

const REQUEST_MARKER = new RegExp(REAL_DATA_REQUIRED_MARKER, "gi");

/**
 * Titles, ids, and the URL's query are all free text an author or a link
 * controls, and the chat guard reads any chat context carrying the request
 * marker as the request itself. Rewrite whole published text, not chosen fields.
 */
function withoutRequestMarker(text: string): string {
  return text.replace(REQUEST_MARKER, (marker) => marker.replace(/_/g, " "));
}

/** As encodeURIComponent, with "_" escaped too, so an id can't spell the request marker. */
function encodeSelectionPart(part: string): string {
  return encodeURIComponent(part).replace(/_/g, "%5F");
}

function dashboardContext(
  args: Required<Pick<DashboardChatContextArgs, "id" | "kind">> & {
    title: string;
    panelCount?: number;
    canEdit?: boolean;
    editing?: boolean;
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
  if (args.canEdit && typeof args.editing === "boolean") {
    lines.push(
      args.editing
        ? "Dashboard mode: edit (the user's own drags and renames save for everyone)"
        : "Dashboard mode: view (moving or editing panels, renaming, adding, editing, showing or hiding key dates and data notes, and undo on the page wait for edit mode, and the user's column drags stay in their browser; saving a view, restoring history, archiving, deleting, and adding a first panel still work and apply to everyone)",
    );
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

/**
 * The panel's selection id. Panel ids repeat across dashboards, so the
 * dashboard id is part of it; both parts are escaped so neither can spell the
 * request marker in the prompt's selected-objects list.
 */
export function panelSelectionId(dashboardId: string, panelId: string): string {
  return `${encodeSelectionPart(dashboardId)}/${encodeSelectionPart(panelId)}`;
}

function parsePanelSelectionId(
  selectionId: string,
): { dashboardId: string; panelId: string } | null {
  const separator = selectionId.indexOf("/");
  if (separator <= 0) return null;
  try {
    return {
      dashboardId: decodeURIComponent(selectionId.slice(0, separator)),
      panelId: decodeURIComponent(selectionId.slice(separator + 1)),
    };
  } catch {
    // coercion-ok: an id that does not decode was not written by panelSelectionId
    return null;
  }
}

function isAgentSidebarOpenInDocument(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '.agent-sidebar-panel[data-agent-sidebar-state="open"]',
    ),
  );
}

export function useDashboardChatContext(
  args: DashboardChatContextArgs,
): DashboardChatContextResult {
  const { id, kind, title, panelCount, canEdit, editing } = args;
  const [isAgentSidebarOpen, setIsAgentSidebarOpen] = useState(
    isAgentSidebarOpenInDocument,
  );
  const { items } = useAgentChatContext();
  const pickedPanelIds = useMemo(
    () => (id ? pickedPanelIdsIn(items, id) : EMPTY_IDS),
    [id, items],
  );
  const selectedPanelIds = isAgentSidebarOpen ? pickedPanelIds : EMPTY_IDS;
  const selectedPanelId = selectedPanelIds[selectedPanelIds.length - 1] ?? null;
  const hasSelectedPanel = selectedPanelId !== null;
  const publishedSelectionRef = useRef<SelectedDashboardObject | null>(null);
  const suppressDashboardContextRef = useRef(false);
  const dashboardIdRef = useRef(id);
  dashboardIdRef.current = id;

  // Panels describe themselves as they render, so a pick made in Select mode
  // can publish the same `selected-object` a plain click does.
  const panelsRef = useRef(new Map<string, DashboardPanelChatContextArgs>());
  const panelSelectionTarget = useCallback(
    (panel: DashboardPanelChatContextArgs): AgentSelectionTarget | null => {
      if (!id) return null;
      panelsRef.current.set(panel.panelId, panel);
      const displayDashboardTitle = withoutRequestMarker(title?.trim() || id);
      const displayPanelTitle = withoutRequestMarker(
        panel.panelTitle.trim() || panel.panelId,
      );
      return {
        kind: PANEL_SELECTION_KIND,
        id: panelSelectionId(id, panel.panelId),
        title: displayPanelTitle,
        getContext: () =>
          withoutRequestMarker(
            [
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
                ? `Inspect this panel with get-sql-dashboard (panelIds: [${JSON.stringify(panel.panelId)}]) before changing it, then use mutate-dashboard for edits.`
                : "Inspect the linked Explorer config before changing this chart.",
            ]
              .filter(Boolean)
              .join("\n"),
          ),
      };
    },
    [id, kind, title],
  );

  const selectPanelForChat = useCallback(
    (
      panel: DashboardPanelChatContextArgs,
      options: SelectDashboardPanelOptions = {},
    ) => {
      const target = panelSelectionTarget(panel);
      if (!id || !target) return;
      if (options.openSidebar !== true && !isAgentSidebarOpen) return;
      suppressDashboardContextRef.current = false;
      selectAgentSelectable(target, {
        exclusive: true,
        openSidebar: options.openSidebar === true,
        focus: options.focus ?? false,
      });
    },
    [id, isAgentSidebarOpen, panelSelectionTarget],
  );

  // `selected-object` follows the most recent pick, however it was made.
  useEffect(() => {
    if (!id || !selectedPanelId) return;
    const published = publishedSelectionRef.current;
    if (
      published?.dashboardId === id &&
      published.panelId === selectedPanelId
    ) {
      return;
    }
    const panel = panelsRef.current.get(selectedPanelId);
    if (!panel) return;
    const selection: SelectedDashboardObject = {
      type: "dashboard-panel",
      dashboardId: id,
      dashboardKind: kind,
      dashboardTitle: withoutRequestMarker(title?.trim() || id),
      panelId: panel.panelId,
      panelTitle: withoutRequestMarker(
        panel.panelTitle.trim() || panel.panelId,
      ),
      panelKind: panel.panelKind,
      chartType: panel.chartType || undefined,
      source: panel.source || undefined,
      configId: panel.configId || undefined,
      extensionId: panel.extensionId || undefined,
      [SELECTED_OBJECT_SOURCE_FIELD]: TAB_ID,
    };
    setClientAppState(SELECTED_OBJECT_STATE_KEY, selection, {
      keepalive: true,
      requestSource: TAB_ID,
    }).catch(() => {});
    publishedSelectionRef.current = selection;
  }, [id, kind, selectedPanelId, title]);

  useEffect(() => {
    const handleSidebarStateChange = (event: Event) => {
      const detail = (event as CustomEvent<AgentSidebarStateChangeDetail>)
        .detail;
      if (typeof detail?.open === "boolean") {
        setIsAgentSidebarOpen(detail.open);
      }
    };

    window.addEventListener(
      SIDEBAR_STATE_CHANGE_EVENT,
      handleSidebarStateChange,
    );
    return () =>
      window.removeEventListener(
        SIDEBAR_STATE_CHANGE_EVENT,
        handleSidebarStateChange,
      );
  }, []);

  useEffect(() => {
    const handleNewChat = () => {
      removeAgentChatContextItem({
        key: DASHBOARD_CONTEXT_KEY,
        openSidebar: false,
      });
      if (dashboardIdRef.current) removePickedPanels(dashboardIdRef.current);
      const publishedSelection = publishedSelectionRef.current;
      publishedSelectionRef.current = null;
      suppressDashboardContextRef.current = true;
      if (publishedSelection) {
        void clearSelectedDashboardObjectIfOwned(publishedSelection);
      }
    };

    window.addEventListener("agent-chat:new-chat", handleNewChat);
    return () =>
      window.removeEventListener("agent-chat:new-chat", handleNewChat);
  }, []);

  useEffect(() => {
    if (!id) return;
    suppressDashboardContextRef.current = false;
    const dashboardTitle = withoutRequestMarker(title?.trim() || id);
    const timer = setTimeout(() => {
      if (suppressDashboardContextRef.current) return;
      setAgentChatContextItem({
        key: DASHBOARD_CONTEXT_KEY,
        title: `Dashboard: ${dashboardTitle}`,
        context: withoutRequestMarker(
          dashboardContext({
            id,
            kind,
            title: dashboardTitle,
            panelCount,
            canEdit,
            editing,
          }),
        ),
        openSidebar: false,
        focus: false,
      });
    }, CONTEXT_PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [canEdit, editing, id, kind, panelCount, title]);

  useEffect(() => {
    if (!id || hasSelectedPanel) return;
    if (suppressDashboardContextRef.current) return;
    const dashboardTitle = withoutRequestMarker(title?.trim() || id);
    const selection: SelectedDashboardObject = {
      type: "dashboard",
      id,
      kind,
      title: dashboardTitle,
      panelCount,
      canEdit,
      ...(canEdit && typeof editing === "boolean"
        ? { mode: editing ? "edit" : "view" }
        : {}),
      [SELECTED_OBJECT_SOURCE_FIELD]: TAB_ID,
    };
    const timer = setTimeout(() => {
      if (suppressDashboardContextRef.current) return;
      setClientAppState(SELECTED_OBJECT_STATE_KEY, selection, {
        keepalive: true,
        requestSource: TAB_ID,
      }).catch(() => {});
      publishedSelectionRef.current = selection;
    }, CONTEXT_PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [canEdit, editing, hasSelectedPanel, id, kind, panelCount, title]);

  useEffect(() => {
    if (!id) return;
    return () => {
      removeAgentChatContextItem({
        key: DASHBOARD_CONTEXT_KEY,
        openSidebar: false,
      });
      void clearSelectedDashboardObjectIfOwned(publishedSelectionRef.current);
    };
  }, [id]);

  return {
    selectedPanelId,
    selectedPanelIds,
    selectPanelForChat,
    panelSelectionTarget,
  };
}

function pickedPanelIdsIn(
  items: readonly { key: string }[],
  dashboardId: string,
): string[] {
  const panelIds: string[] = [];
  for (const item of items) {
    const reference = parseAgentSelectionContextKey(item.key);
    if (reference?.kind !== PANEL_SELECTION_KIND) continue;
    const selection = parsePanelSelectionId(reference.id);
    if (selection?.dashboardId === dashboardId) {
      panelIds.push(selection.panelId);
    }
  }
  return panelIds;
}

/**
 * Release this dashboard's picked panels on a fresh chat. Leaving the
 * dashboard needs no call: its panels unregister and Select releases them.
 */
function removePickedPanels(dashboardId: string): void {
  for (const panelId of pickedPanelIdsIn(listAgentChatContext(), dashboardId)) {
    removeAgentChatContextItem({
      key: agentSelectionContextKey(
        PANEL_SELECTION_KIND,
        panelSelectionId(dashboardId, panelId),
      ),
      openSidebar: false,
    });
  }
}

/**
 * Offer a dashboard panel to the composer's Select mode while it is mounted.
 * Returns whether the panel is picked.
 */
export function useDashboardPanelSelectable(
  panelSelectionTarget: DashboardChatContextResult["panelSelectionTarget"],
  panel: DashboardPanelChatContextArgs,
  getElement: () => Element | null,
): boolean {
  const target = panelSelectionTarget(panel);
  return useAgentSelectable(target ? { ...target, getElement } : null);
}
