import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  getAllDeals,
  getDealPipelines,
  computeSalesMetrics,
  getVisiblePipelines,
  getMetricsPipelines,
} from "../lib/hubspot";

// GET /api/hubspot/deals — deals filtered to visible pipelines
export const handleHubspotDeals: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "HUBSPOT_ACCESS_TOKEN", "HubSpot")) return;
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

    res.json({ deals, stageLabels, total: deals.length });
  } catch (err: any) {
    console.error("HubSpot deals error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/hubspot/pipelines — visible pipeline stages only
export const handleHubspotPipelines: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "HUBSPOT_ACCESS_TOKEN", "HubSpot")) return;
  try {
    const allPipelines = await getDealPipelines();
    const pipelines = getVisiblePipelines(allPipelines);
    res.json({ pipelines });
  } catch (err: any) {
    console.error("HubSpot pipelines error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/hubspot/metrics — computed sales metrics (enterprise only)
export const handleHubspotMetrics: RequestHandler = async (_req, res) => {
  if (requireEnvKey(res, "HUBSPOT_ACCESS_TOKEN", "HubSpot")) return;
  try {
    const [deals, pipelines] = await Promise.all([
      getAllDeals(),
      getDealPipelines(),
    ]);
    const metrics = computeSalesMetrics(deals, pipelines, true);
    res.json(metrics);
  } catch (err: any) {
    console.error("HubSpot metrics error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
