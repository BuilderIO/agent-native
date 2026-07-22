import { defineAction } from "@agent-native/core/action";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  DASHBOARD_PANEL_SOURCES,
  normalizeDashboardPanelQuery,
} from "../server/lib/dashboard-panel-query";
import { resolveAnalyticsPanelSource } from "../server/lib/dashboard-panel-source-resolver";

export default defineAction({
  description:
    "Run one saved Analytics dashboard panel query through its configured source. This is a UI-only dashboard rendering action.",
  schema: z.object({
    source: z.enum(DASHBOARD_PANEL_SOURCES),
    query: z.unknown(),
  }),
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  run: async (args) => {
    const context = getCredentialContext();
    if (!context) {
      throw new Error("No authenticated context for query-dashboard-panel.");
    }

    const query = normalizeDashboardPanelQuery(args.source, args.query);
    return resolveAnalyticsPanelSource({ source: args.source, query }, context);
  },
});
