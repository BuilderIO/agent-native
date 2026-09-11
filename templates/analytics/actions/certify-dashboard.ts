import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { isDashboardCertified } from "../server/lib/dashboard-certification";
import { certifyDashboardWithRetry } from "../server/lib/dashboards-store";
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
    const updated = await certifyDashboardWithRetry(id, {
      email: admin.userEmail,
      orgId: admin.orgId,
    });
    const certified = isDashboardCertified(
      updated.certification,
      updated.updatedAt,
    );
    return {
      id: updated.id,
      updatedAt: updated.updatedAt,
      certification: updated.certification ?? null,
      certified,
      message: certified
        ? `Dashboard "${updated.title}" certified for its current version.`
        : `Dashboard "${updated.title}" changed while it was being certified; its certification is stale.`,
    };
  },
});
