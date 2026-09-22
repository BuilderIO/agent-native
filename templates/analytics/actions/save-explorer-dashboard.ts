import { defineAction } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { upsertDashboard } from "../server/lib/dashboards-store";

export default defineAction({
  description:
    "Create or update an explorer (BigQuery explorer) dashboard. " +
    "The body is stored as the dashboard config verbatim.",
  schema: z.object({
    id: z.string().describe("The explorer dashboard ID"),
    data: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .describe("The dashboard config object to persist (or a JSON string)"),
  }),
  http: { method: "POST" },
  run: async (args, actionContext?: ActionRunContext) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const ctx = { email, orgId };
    await upsertDashboard(args.id, "explorer", args.data, ctx);
    track(
      "dashboard_saved",
      {
        app_name: "analytics",
        template_name: "analytics",
        output_id: args.id,
        output_type: "dashboard",
        dashboard_id: args.id,
        dashboard_kind: "explorer",
        panel_count: Array.isArray(args.data.charts)
          ? args.data.charts.length
          : 0,
      },
      actionContext,
    );
    return { id: args.id, success: true };
  },
});
