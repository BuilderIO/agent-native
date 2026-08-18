import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import { listWorkspaceFeatureFlags } from "../server/lib/workspace-feature-flags.js";

export default defineAction({
  description:
    "List feature-flag definitions across trusted organization apps. Non-ready apps are reported explicitly and never treated as off.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) =>
    listWorkspaceFeatureFlags(await requireAnalyticsAdminContext(ctx)),
});
