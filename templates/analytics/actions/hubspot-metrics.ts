import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  getAllDeals,
  getDealPipelines,
  computeSalesMetrics,
} from "../server/lib/hubspot";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Get computed HubSpot sales metrics: win rate, ACV, pipeline value, etc.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const [deals, pipelines] = await Promise.all([
      getAllDeals(),
      getDealPipelines(),
    ]);
    return computeSalesMetrics(deals, pipelines, true);
  },
});
