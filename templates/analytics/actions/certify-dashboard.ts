import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  certifyDashboardConfig,
  type DashboardCertification,
} from "../server/lib/dashboard-certification";
import { upsertDashboardWithRetry } from "../server/lib/dashboards-store";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections";

export default defineAction({
  description:
    "Certify a saved SQL Analytics dashboard for its current version. Requires organization owner/admin access; later dashboard edits make the certification stale.",
  schema: z.object({ id: z.string().min(1).describe("The dashboard ID") }),
  run: async ({ id }) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail(),
      orgId: getRequestOrgId() || null,
    });
    const certifiedAt = new Date().toISOString();
    const updated = await upsertDashboardWithRetry(
      id,
      { email: admin.userEmail, orgId: admin.orgId },
      (existing) => {
        if (existing.kind !== "sql") {
          throw new Error(
            "Only SQL dashboards can be certified for AI queries.",
          );
        }
        const certification: DashboardCertification = {
          status: "certified",
          certifiedAt,
          certifiedBy: admin.userEmail,
          certifiedForUpdatedAt: existing.updatedAt,
        };
        return {
          kind: existing.kind,
          body: certifyDashboardConfig(existing.config, certification),
          preserveUpdatedAt: true,
        };
      },
    );
    return {
      id: updated.id,
      updatedAt: updated.updatedAt,
      certification: updated.config.certification,
      certified: true,
      message: `Dashboard "${updated.title}" certified for its current version.`,
    };
  },
});
