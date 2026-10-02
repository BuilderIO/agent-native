import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  getAllDeals,
  getDealPipelines,
  computeSalesMetrics,
} from "../server/lib/hubspot";

export default defineAction({
  readOnly: true,
  mcpTool: true,
  description:
    "Get computed HubSpot sales metrics such as win rate, ACV, and pipeline value, aggregated from deals in the configured metrics pipelines.",
  schema: z.object({}),
  http: { method: "GET" },
  grounding: true,
  run: async () => {
    const [deals, pipelines] = await Promise.all([
      getAllDeals(),
      getDealPipelines(),
    ]);
    return computeSalesMetrics(deals, pipelines, true);
  },
});
