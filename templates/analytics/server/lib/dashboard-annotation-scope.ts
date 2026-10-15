import { fail } from "@agent-native/core/action";

import type { AnnotationScope } from "./annotation-scope.js";
import { loadDashboardSeed } from "./dashboard-seeds.js";
import { getDashboard } from "./dashboards-store.js";

export type DashboardAnnotationScope = {
  scope: AnnotationScope;
  editable: boolean;
};

function sameScope(a: AnnotationScope, b: AnnotationScope): boolean {
  return a.orgId || b.orgId
    ? a.orgId === b.orgId
    : a.email.toLowerCase() === b.email.toLowerCase();
}

/**
 * Whose annotations a stored dashboard draws: its owner's organization's, so
 * one shared from another organization shows that organization's, as its
 * report emails do. `editable` is false when the caller's own writes would
 * land in another scope.
 */
export function storedDashboardAnnotationScope(
  dashboard: { ownerEmail: string; orgId: string | null },
  caller: AnnotationScope,
): DashboardAnnotationScope {
  const scope = { email: dashboard.ownerEmail, orgId: dashboard.orgId };
  return { scope, editable: sameScope(scope, caller) };
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
