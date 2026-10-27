import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { z } from "zod";

import { readDashboardSyncBase } from "../server/lib/dashboard-github-sync/state";
import { removeDashboard } from "../server/lib/dashboards-store";
import { markDemoDashboardDeleted } from "../server/lib/demo-dashboards";
import {
  BUILTIN_DEMO_DASHBOARD_ID,
  isBuiltinDashboardId,
} from "../shared/builtin-dashboard-ids";

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
    if (args.id === BUILTIN_DEMO_DASHBOARD_ID) {
      // The demo ships with the app; deleting it only takes it off this
      // person's list, and ensure-demo-dashboards with reset brings it back.
      await markDemoDashboardDeleted(args.id, { email, orgId });
      return { id: args.id, success: true };
    }
    if (isBuiltinDashboardId(args.id) && args.id.startsWith("builtin-")) {
      fail(`Dashboard "${args.id}" is a built-in and can't be deleted.`, {
        errorCode: "builtin_dashboard_read_only",
        statusCode: 409,
      });
    }
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
