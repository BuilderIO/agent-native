import { fail } from "@agent-native/core/action";
import {
  currentRequestUserIsOrgAdmin,
  getAppConfig,
} from "@agent-native/core/server";

import {
  getDashboardForReview,
  type DashboardRecord,
} from "./dashboards-store.js";

/**
 * A saved dashboard as a Human Review preview reads it: only for an
 * organization owner or admin, and across organizations only for the one
 * configured as this app's observability super organization.
 */
export async function getReviewedDashboard(
  id: string,
  callerOrgId: string | null,
  reviewOrgId: string | undefined,
): Promise<DashboardRecord | null> {
  if (!callerOrgId || !(await currentRequestUserIsOrgAdmin(callerOrgId))) {
    fail(
      "Only organization owners and admins can preview reviewed dashboards.",
      { statusCode: 403 },
    );
  }
  const isSuperOrg = getAppConfig().observability.superOrgId === callerOrgId;
  const targetOrgId = isSuperOrg ? reviewOrgId : callerOrgId;
  if (!targetOrgId) {
    fail("A customer organization is required for this dashboard preview.", {
      statusCode: 400,
    });
  }
  return getDashboardForReview(
    id,
    isSuperOrg
      ? { kind: "super-organization", orgId: targetOrgId }
      : { kind: "organization", orgId: targetOrgId },
  );
}
