import { fail } from "@agent-native/core/action";

import type { AnnotationScope } from "./annotation-scope.js";
import { repairKnownFirstPartyDashboardQueries } from "./canonical-first-party-dashboard-repair.js";
import {
  storedDashboardAnnotationScope,
  type DashboardAnnotationScope,
} from "./dashboard-annotation-scope.js";
import {
  summarizeDashboardAnnotations,
  type DashboardAnnotationSummary,
  type DashboardAnnotationsUnreadable,
} from "./dashboard-annotation-summary.js";
import { loadDashboardSeed } from "./dashboard-seeds.js";
import { getDashboard } from "./dashboards-store.js";
import { listDataNotes } from "./data-notes-store.js";
import { listKeyDateSets } from "./key-dates-store.js";

/**
 * The key-date sets and data notes one dashboard draws, read from the scope it
 * draws them from. `searchParams` are the page's URL filters when it is on
 * screen.
 */
export async function loadDashboardAnnotationSummary(
  drawn: DashboardAnnotationScope,
  dashboardId: string,
  config: Record<string, unknown>,
  searchParams?: Record<string, string>,
): Promise<DashboardAnnotationSummary | DashboardAnnotationsUnreadable> {
  try {
    const [sets, notes] = await Promise.all([
      listKeyDateSets(drawn.scope),
      listDataNotes(drawn.scope),
    ]);
    const summary = summarizeDashboardAnnotations(
      dashboardId,
      config,
      sets,
      notes,
      { searchParams },
    );
    if (drawn.editable) return summary;
    // As list-key-dates and list-data-notes: no sets where no chart can draw
    // a key date, though the hint still says so, and what the dashboard hides
    // only for a reader who can show it again.
    const canShow = drawn.dashboard.canEdit;
    return {
      ...summary,
      keyDateSets: summary.keyDatesHint
        ? []
        : summary.keyDateSets.filter((set) => canShow || set.shown),
      dataNotes: canShow
        ? summary.dataNotes
        : summary.dataNotes.flatMap(({ hiddenOnPanelIds: _, ...note }) =>
            note.panelIds.length > 0 ? [note] : [],
          ),
      editable: false,
    };
  } catch (error) {
    return {
      annotationsError: `Key dates and data notes could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The config to check a marker the caller saves against, or why the dashboard can't draw it. */
export type DashboardPlacementCheck =
  | { config: Record<string, unknown> }
  | { unavailable: string };

/**
 * Where a marker the caller saves could draw on one dashboard. Fails, before
 * anything is saved, only for a dashboard the caller can't open: one that
 * can't draw the marker still lets it save.
 */
export async function readDashboardForPlacement(
  dashboardId: string,
  caller: AnnotationScope,
): Promise<DashboardPlacementCheck> {
  const dashboard = await getDashboard(dashboardId, caller);
  if (dashboard && dashboard.kind !== "sql") {
    return {
      unavailable:
        "Only SQL dashboards draw key dates and data notes, and this is an Explorer dashboard.",
    };
  }
  if (
    dashboard &&
    !storedDashboardAnnotationScope(dashboard, caller).editable
  ) {
    return {
      unavailable:
        "This dashboard is another organization's and draws that organization's key dates and data notes, not yours, so it doesn't show this one.",
    };
  }
  const config = dashboard
    ? (dashboard.config as Record<string, unknown>)
    : loadDashboardSeed(dashboardId);
  if (!config) {
    fail(`Dashboard "${dashboardId}" was not found.`, {
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
  }
  return {
    config: repairKnownFirstPartyDashboardQueries(dashboardId, config).config,
  };
}
