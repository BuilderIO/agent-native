import { callAction } from "@agent-native/core/client/hooks";

import { TAB_ID } from "@/lib/tab-id";

/**
 * Clear this tab's dashboard selection without touching another tab's state.
 * The action validates the tab marker and deletes with a compare-and-set so a
 * route transition cannot erase a newer selection after the read.
 */
export async function clearSelectedDashboardObjectIfOwned(
  dashboardId?: string,
): Promise<void> {
  try {
    await callAction("clear-selected-dashboard-object", {
      dashboardId,
      source: TAB_ID,
    });
  } catch {
    // coercion-ok: best-effort cleanup must not break Ask navigation when state APIs fail.
    // Best effort only; stale context is safer than clearing another tab's state.
  }
}
