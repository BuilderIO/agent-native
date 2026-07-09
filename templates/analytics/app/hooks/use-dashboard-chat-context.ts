import {
  deleteClientAppState,
  readClientAppState,
  removeAgentChatContextItem,
  setAgentChatContextItem,
  setClientAppState,
} from "@agent-native/core/client";
import { useEffect } from "react";

import { TAB_ID } from "@/lib/tab-id";

const DASHBOARD_CONTEXT_KEY = "analytics-selected-dashboard";
const SELECTED_OBJECT_STATE_KEY = "selected-object";
const SELECTED_OBJECT_SOURCE_FIELD = "__agentNativeSelectedObjectSource";

export interface DashboardChatContextArgs {
  id: string | null | undefined;
  kind: "explorer" | "sql";
  title?: string | null;
  panelCount?: number;
  canEdit?: boolean;
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

async function deleteSelectedObjectIfOwned() {
  try {
    const current = await readClientAppState<Record<string, unknown>>(
      SELECTED_OBJECT_STATE_KEY,
    );
    if (current?.[SELECTED_OBJECT_SOURCE_FIELD] !== TAB_ID) return;
    await deleteClientAppState(SELECTED_OBJECT_STATE_KEY, {
      keepalive: true,
      requestSource: TAB_ID,
    });
  } catch {
    // Best effort only; avoid clearing another tab's selected object on errors.
  }
}

export function useDashboardChatContext(args: DashboardChatContextArgs): void {
  const { id, kind, title, panelCount, canEdit } = args;

  useEffect(() => {
    if (!id) return;
    const displayTitle = title?.trim() || id;
    const selection = {
      type: "dashboard",
      id,
      kind,
      title: displayTitle,
      panelCount,
      canEdit,
      [SELECTED_OBJECT_SOURCE_FIELD]: TAB_ID,
    };

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
    setClientAppState(SELECTED_OBJECT_STATE_KEY, selection, {
      keepalive: true,
      requestSource: TAB_ID,
    }).catch(() => {});

    return () => {
      removeAgentChatContextItem({
        key: DASHBOARD_CONTEXT_KEY,
        openSidebar: false,
      });
      deleteSelectedObjectIfOwned();
    };
  }, [canEdit, id, kind, panelCount, title]);
}
