import { fail } from "@agent-native/core/action";

import type { AnnotationScope } from "./annotation-scope.js";
import { getReviewedDashboard } from "./dashboard-review-access.js";
import type { DashboardRecord } from "./dashboards-store.js";
import { openDashboard } from "./open-dashboard.js";

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

/**
 * As `storedDashboardAnnotationScope`; a built-in has no owner and draws the
 * caller's. A copy the deploy pass hid serves its built-in, as in
 * `get-sql-dashboard`. A Human Review preview reads the dashboard as
 * `get-sql-dashboard`'s `reviewPreview` does, for a reviewer who may have no
 * ordinary access to it.
 */
export async function dashboardAnnotationScope(
  dashboardId: string,
  caller: AnnotationScope,
  review?: { reviewOrgId?: string },
): Promise<DashboardAnnotationScope> {
  if (review) {
    const dashboard = await getReviewedDashboard(
      dashboardId,
      caller.orgId,
      review.reviewOrgId,
    );
    if (!dashboard || dashboard.kind !== "sql") {
      fail(`Dashboard "${dashboardId}" was not found.`, { statusCode: 404 });
    }
    return storedDashboardAnnotationScope(dashboard, caller);
  }
  const opened = await openDashboard(dashboardId, caller);
  if (opened?.saved)
    return storedDashboardAnnotationScope(opened.saved, caller);
  if (opened?.builtin) return { scope: caller, editable: true };
  fail(`Dashboard "${dashboardId}" was not found.`, { statusCode: 404 });
}
