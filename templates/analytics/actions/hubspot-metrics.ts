import { defineAction } from "@agent-native/core";
import {
  getAllDeals,
  getDealPipelines,
  computeSalesMetrics,
} from "../server/lib/hubspot";

export default defineAction({
  description:
    "Get computed HubSpot sales metrics: win rate, ACV, pipeline value, etc.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const [deals, pipelines] = await Promise.all([
      getAllDeals(),
      getDealPipelines(),
    ]);
    return computeSalesMetrics(deals, pipelines, true);
  },
});
