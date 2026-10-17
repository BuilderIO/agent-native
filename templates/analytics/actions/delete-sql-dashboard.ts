import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { readDashboardSyncBase } from "../server/lib/dashboard-github-sync/state";
import { removeDashboard } from "../server/lib/dashboards-store";
import { markDemoDashboardDeleted } from "../server/lib/demo-dashboards";

export default defineAction({
  description:
    "Permanently delete a SQL analytics dashboard by ID. This cannot be undone — " +
    "use archive-dashboard instead when the dashboard might be needed later.",
  schema: z.object({
    id: z.string().describe("The dashboard ID to delete"),
  }),
  http: { method: "DELETE" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    // A synced dashboard's file stays in GitHub, so the next pull would recreate it.
    if (await readDashboardSyncBase(args.id, { email, orgId })) {
      fail(
        `Dashboard "${args.id}" is synced to GitHub. Archive it, or unlink its folder from GitHub, before deleting it.`,
        { errorCode: "dashboard_github_synced", statusCode: 409 },
      );
    }
    await markDemoDashboardDeleted(args.id, { email, orgId });
    await removeDashboard(args.id, { email, orgId });
    return { id: args.id, success: true };
  },
});
