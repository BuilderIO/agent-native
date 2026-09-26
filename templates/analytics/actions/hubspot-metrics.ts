import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  getAllDeals,
  getDealPipelines,
  computeSalesMetrics,
} from "../server/lib/hubspot";

export default defineAction({
  readOnly: true,
  description:
    "Get computed HubSpot sales metrics: win rate, ACV, pipeline value, etc.",
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
