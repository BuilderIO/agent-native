import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getAllDeals,
  getDealPipelines,
  getVisiblePipelines,
} from "../server/lib/hubspot";

export default defineAction({
  description:
    "Get all HubSpot deals with their properties, filtered to visible pipelines.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const [allDeals, allPipelines] = await Promise.all([
      getAllDeals(),
      getDealPipelines(),
    ]);

    const visiblePipelines = getVisiblePipelines(allPipelines);
    const visibleIds = new Set(visiblePipelines.map((p) => p.id));
    const deals = allDeals.filter((d) => visibleIds.has(d.properties.pipeline));

    const stageLabels: Record<string, string> = {};
    for (const p of visiblePipelines) {
      for (const s of p.stages) {
        stageLabels[s.id] = s.label;
      }
    }

    return { deals, stageLabels, total: deals.length };
  },
});
