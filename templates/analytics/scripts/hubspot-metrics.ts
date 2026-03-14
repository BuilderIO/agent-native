#!/usr/bin/env tsx
/**
 * Get computed sales metrics: win rate, ACV, pipeline value, etc.
 *
 * Usage:
 *   npx tsx scripts/run.ts hubspot-metrics
 */
import { output } from "./helpers";
import {
  getAllDeals,
  getDealPipelines,
  computeSalesMetrics,
} from "../server/lib/hubspot";

const [deals, pipelines] = await Promise.all([
  getAllDeals(),
  getDealPipelines(),
]);
output(computeSalesMetrics(deals, pipelines));
