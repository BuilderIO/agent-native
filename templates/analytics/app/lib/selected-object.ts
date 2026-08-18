import {
  deleteClientAppState,
  readClientAppState,
} from "@agent-native/core/client/hooks";

import { TAB_ID } from "@/lib/tab-id";

const SELECTED_OBJECT_STATE_KEY = "selected-object";
const SELECTED_OBJECT_SOURCE_FIELD = "__agentNativeSelectedObjectSource";

function selectedDashboardId(value: Record<string, unknown>): string | null {
  const id =
    value.type === "dashboard"
      ? value.id
      : value.type === "dashboard-panel"
        ? value.dashboardId
        : null;
  return typeof id === "string" ? id : null;
}

/**
 * Clear this tab's dashboard selection without touching another tab's state.
 * Passing a dashboard id additionally protects a dashboard page from clearing
 * a newer selection that was written during a route transition.
 */
export async function clearSelectedDashboardObjectIfOwned(
  dashboardId?: string,
): Promise<void> {
  try {
    const current = await readClientAppState<Record<string, unknown>>(
      SELECTED_OBJECT_STATE_KEY,
    );
    if (current?.[SELECTED_OBJECT_SOURCE_FIELD] !== TAB_ID) return;

    const currentDashboardId = selectedDashboardId(current);
    if (!currentDashboardId) return;
    if (dashboardId && currentDashboardId !== dashboardId) return;

    await deleteClientAppState(SELECTED_OBJECT_STATE_KEY, {
      keepalive: true,
      requestSource: TAB_ID,
    });
  } catch {
    // coercion-ok: best-effort cleanup must not break Ask navigation when state APIs fail.
    // Best effort only; stale context is safer than clearing another tab's state.
  }
}
