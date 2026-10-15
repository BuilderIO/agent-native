import { fail } from "@agent-native/core/action";

import { loadDashboardSeed } from "./dashboard-seeds.js";
import { getDashboard, type DashboardRecord } from "./dashboards-store.js";

export type AnnotationScope = { email: string; orgId: string | null };

/**
 * Whose annotations a dashboard draws. A reader whose own writes would land
 * in another scope gets the dashboard too, to see no more than it draws.
 */
export type DashboardAnnotationScope =
  | { scope: AnnotationScope; editable: true }
  | { scope: AnnotationScope; editable: false; dashboard: DashboardRecord };

function sameScope(a: AnnotationScope, b: AnnotationScope): boolean {
  return a.orgId || b.orgId
    ? a.orgId === b.orgId
    : a.email.toLowerCase() === b.email.toLowerCase();
}

/**
 * A stored dashboard draws its owner's organization's annotations, so one
 * shared from another organization shows that organization's, in its report
 * emails too.
 */
export function storedDashboardAnnotationScope(
  dashboard: DashboardRecord,
  caller: AnnotationScope,
): DashboardAnnotationScope {
  const scope = { email: dashboard.ownerEmail, orgId: dashboard.orgId };
  return sameScope(scope, caller)
    ? { scope, editable: true }
    : { scope, editable: false, dashboard };
}

/** As `storedDashboardAnnotationScope`; a seed dashboard has no owner and draws the caller's. */
export async function dashboardAnnotationScope(
  dashboardId: string,
  caller: AnnotationScope,
): Promise<DashboardAnnotationScope> {
  const dashboard = await getDashboard(dashboardId, caller);
  if (dashboard) return storedDashboardAnnotationScope(dashboard, caller);
  if (loadDashboardSeed(dashboardId)) return { scope: caller, editable: true };
  fail(`Dashboard "${dashboardId}" was not found.`, { statusCode: 404 });
}
