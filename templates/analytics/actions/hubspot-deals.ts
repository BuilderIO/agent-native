#!/usr/bin/env tsx
/**
 * Get all HubSpot deals with their properties.
 *
 * Usage:
 *   npx tsx scripts/run.ts hubspot-deals
 */
import { output } from "./helpers";
import { getAllDeals, getDealPipelines } from "../server/lib/hubspot";

const [deals, pipelines] = await Promise.all([
  getAllDeals(),
  getDealPipelines(),
]);

const stageMap = new Map<string, string>();
for (const p of pipelines) {
  for (const s of p.stages) {
    stageMap.set(s.id, `${p.label} → ${s.label}`);
  }
}

output({
  deals: deals.map((d) => ({
    ...d,
    stageLabel: stageMap.get(d.properties.dealstage) ?? d.properties.dealstage,
  })),
  totalDeals: deals.length,
});
