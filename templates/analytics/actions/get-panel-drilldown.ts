import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getFirstPartyDrilldown } from "../server/lib/first-party-metric-catalog";

export default defineAction({
  agentTool: false,
  http: { method: "GET" },
  description:
    "Return the record-level drill-down SQL template for a first-party dashboard panel, or null when the panel only has aggregate rows. The template uses {{drillX}} and {{drillSeries}} for the clicked chart point plus the dashboard filter variables.",
  schema: z.object({
    panelId: z.string().min(1).max(200),
  }),
  run: async ({ panelId }) => ({
    drilldown: getFirstPartyDrilldown(panelId),
  }),
});
