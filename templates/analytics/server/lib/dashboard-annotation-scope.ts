import { fail } from "@agent-native/core/action";

import { loadDashboardSeed } from "./dashboard-seeds.js";
import { getDashboard } from "./dashboards-store.js";

export type AnnotationScope = { email: string; orgId: string | null };

function sameScope(a: AnnotationScope, b: AnnotationScope): boolean {
  return a.orgId || b.orgId
    ? a.orgId === b.orgId
    : a.email.toLowerCase() === b.email.toLowerCase();
}

/**
 * Whose annotations a dashboard draws: its owner's organization's, so one
 * shared from another organization shows that organization's, as its report
 * emails do. A seed dashboard has no owner and draws the caller's. `editable`
 * is false when the caller's own writes would land in another scope.
 */
export async function dashboardAnnotationScope(
  dashboardId: string,
  caller: AnnotationScope,
): Promise<{ scope: AnnotationScope; editable: boolean }> {
  const dashboard = await getDashboard(dashboardId, caller);
  if (dashboard) {
    const scope = { email: dashboard.ownerEmail, orgId: dashboard.orgId };
    return { scope, editable: sameScope(scope, caller) };
  }
  if (loadDashboardSeed(dashboardId)) return { scope: caller, editable: true };
  fail(`Dashboard "${dashboardId}" was not found.`, { statusCode: 404 });
}
