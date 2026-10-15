import { fail } from "@agent-native/core/action";

import type { AnnotationScope } from "./annotation-scope.js";
import { repairKnownFirstPartyDashboardQueries } from "./canonical-first-party-dashboard-repair.js";
import {
  summarizeDashboardAnnotations,
  type DashboardAnnotationSummary,
  type DashboardAnnotationsUnreadable,
} from "./dashboard-annotation-summary.js";
import { loadDashboardSeed } from "./dashboard-seeds.js";
import { getDashboard } from "./dashboards-store.js";
import { listDataNotes } from "./data-notes-store.js";
import { listKeyDateSets } from "./key-dates-store.js";

/** The caller's key-date sets and data notes as they apply to one dashboard. */
export async function loadDashboardAnnotationSummary(
  scope: AnnotationScope,
  dashboardId: string,
  config: Record<string, unknown>,
): Promise<DashboardAnnotationSummary | DashboardAnnotationsUnreadable> {
  try {
    const [sets, notes] = await Promise.all([
      listKeyDateSets(scope),
      listDataNotes(scope),
    ]);
    return summarizeDashboardAnnotations(dashboardId, config, sets, notes);
  } catch (error) {
    return {
      annotationsError: `Key dates and data notes could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The config a dashboard's charts render, for checking where a marker lands. */
export async function readDashboardConfigForAnnotations(
  dashboardId: string,
  scope: AnnotationScope,
): Promise<Record<string, unknown>> {
  const dashboard = await getDashboard(dashboardId, scope);
  const config =
    dashboard?.kind === "sql"
      ? (dashboard.config as Record<string, unknown>)
      : loadDashboardSeed(dashboardId);
  if (!config) {
    fail(`Dashboard "${dashboardId}" was not found.`, {
      errorCode: "dashboard_not_found",
      statusCode: 404,
    });
  }
  return repairKnownFirstPartyDashboardQueries(dashboardId, config).config;
}
