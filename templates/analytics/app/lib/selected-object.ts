import { readClientAppState } from "@agent-native/core/client/application-state";
import { callAction } from "@agent-native/core/client/hooks";

import { TAB_ID } from "@/lib/tab-id";

export type SelectedDashboardObject = Record<string, unknown>;

export async function readSelectedDashboardObject(): Promise<SelectedDashboardObject | null> {
  try {
    const value =
      await readClientAppState<SelectedDashboardObject>("selected-object");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Clear this tab's dashboard selection without touching another tab's state.
 * The action validates the tab marker and deletes with a compare-and-set so a
 * route transition cannot erase a newer selection after the read.
 */
export async function clearSelectedDashboardObjectIfOwned(
  dashboardIdOrSelection?: string | SelectedDashboardObject | null,
): Promise<void> {
  const dashboardId =
    typeof dashboardIdOrSelection === "string"
      ? dashboardIdOrSelection
      : undefined;
  const expectedSelection =
    dashboardIdOrSelection && typeof dashboardIdOrSelection === "object"
      ? dashboardIdOrSelection
      : undefined;

  if (!dashboardId && !expectedSelection) return;

  try {
    await callAction("clear-selected-dashboard-object", {
      ...(dashboardId ? { dashboardId } : {}),
      ...(expectedSelection ? { expectedSelection } : {}),
      browserTabId: TAB_ID,
      source: TAB_ID,
    });
  } catch {
    // coercion-ok: best-effort cleanup must not break Ask navigation when state APIs fail.
    // Best effort only; stale context is safer than clearing another tab's state.
  }
}
