#!/usr/bin/env tsx
/**
 * Get HubSpot deal pipelines and their stages.
 *
 * Usage:
 *   npx tsx scripts/run.ts hubspot-pipelines
 */
import { output } from "./helpers";
import { getDealPipelines, getVisiblePipelines } from "../server/lib/hubspot";

const pipelines = await getDealPipelines();
output({
  allPipelines: pipelines,
  visiblePipelines: getVisiblePipelines(pipelines).map((p) => p.label),
});
