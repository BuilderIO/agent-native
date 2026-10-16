import { createHash } from "node:crypto";

import setResourceVisibilityAction from "@agent-native/core/sharing/actions/set-resource-visibility";

import {
  applyCatalogMetadata,
  getDashboardCatalogEntry,
} from "../dashboard-catalog";
import { getDashboard, upsertDashboard } from "../dashboards-store";

export const CONTENT_VIEW_TEMPLATE_ID = "content-view";

export function contentDashboardId(orgId: string): string {
  const suffix = createHash("sha256").update(orgId).digest("hex").slice(0, 10);
  return `${CONTENT_VIEW_TEMPLATE_ID}-${suffix}`;
}

/**
 * The organization's saved copy of the Content dashboard, so it shows in the
 * Dashboards list. An existing copy is kept as is: people may have edited it.
 */
export async function ensureContentDashboard(admin: {
  userEmail: string;
  orgId: string;
}): Promise<{ dashboardId: string; created: boolean }> {
  const entry = getDashboardCatalogEntry(CONTENT_VIEW_TEMPLATE_ID);
  if (!entry) {
    throw new Error(
      `${CONTENT_VIEW_TEMPLATE_ID} is not in the dashboard catalog`,
    );
  }
  const dashboardId = contentDashboardId(admin.orgId);
  const ctx = { email: admin.userEmail, orgId: admin.orgId };
  const existing = await getDashboard(dashboardId, ctx);
  if (existing) return { dashboardId, created: false };

  await upsertDashboard(
    dashboardId,
    "sql",
    applyCatalogMetadata(entry, entry.buildConfig()) as unknown as Record<
      string,
      unknown
    >,
    ctx,
  );
  await setResourceVisibilityAction.run({
    resourceType: "dashboard",
    resourceId: dashboardId,
    visibility: "org",
  });
  return { dashboardId, created: true };
}
