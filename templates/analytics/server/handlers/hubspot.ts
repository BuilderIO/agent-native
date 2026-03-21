import { defineEventHandler, setResponseStatus } from "h3";
import { requireEnvKey } from "@agent-native/core/server";
import {
  getAllDeals,
  getDealPipelines,
  computeSalesMetrics,
  getVisiblePipelines,
  getMetricsPipelines,
} from "../lib/hubspot";

// GET /api/hubspot/deals — deals filtered to visible pipelines
export const handleHubspotDeals = defineEventHandler(async (event) => {
  const missing = requireEnvKey(event, "HUBSPOT_ACCESS_TOKEN", "HubSpot");
  if (missing) return missing;
  try {
    const [allDeals, allPipelines] = await Promise.all([
      getAllDeals(),
      getDealPipelines(),
    ]);

    const visiblePipelines = getVisiblePipelines(allPipelines);
    const visibleIds = new Set(visiblePipelines.map((p) => p.id));
    const deals = allDeals.filter((d) => visibleIds.has(d.properties.pipeline));

    // Build stage label map for visible pipelines
    const stageLabels: Record<string, string> = {};
    for (const p of visiblePipelines) {
      for (const s of p.stages) {
        stageLabels[s.id] = s.label;
      }
    }

    return { deals, stageLabels, total: deals.length };
  } catch (err: any) {
    console.error("HubSpot deals error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

// GET /api/hubspot/pipelines — visible pipeline stages only
export const handleHubspotPipelines = defineEventHandler(async (event) => {
  const missing = requireEnvKey(event, "HUBSPOT_ACCESS_TOKEN", "HubSpot");
  if (missing) return missing;
  try {
    const allPipelines = await getDealPipelines();
    const pipelines = getVisiblePipelines(allPipelines);
    return { pipelines };
  } catch (err: any) {
    console.error("HubSpot pipelines error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

// GET /api/hubspot/metrics — computed sales metrics (enterprise only)
export const handleHubspotMetrics = defineEventHandler(async (event) => {
  const missing = requireEnvKey(event, "HUBSPOT_ACCESS_TOKEN", "HubSpot");
  if (missing) return missing;
  try {
    const [deals, pipelines] = await Promise.all([
      getAllDeals(),
      getDealPipelines(),
    ]);
    const metrics = computeSalesMetrics(deals, pipelines, true);
    return metrics;
  } catch (err: any) {
    console.error("HubSpot metrics error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
