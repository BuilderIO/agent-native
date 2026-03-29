#!/usr/bin/env tsx
/**
 * Query Google Analytics 4 report data.
 *
 * Usage:
 *   pnpm script ga4-report --metrics=activeUsers,sessions
 *   pnpm script ga4-report --metrics=activeUsers --dimensions=date --days=7
 *   pnpm script ga4-report --metrics=sessions,conversions --dimensions=date,source --days=90
 */
import { parseArgs, output, fatal } from "./helpers";
import { runReport } from "../server/lib/google-analytics";

const args = parseArgs();
const metricsArg = args.metrics;
if (!metricsArg)
  fatal("--metrics is required. Example: --metrics=activeUsers,sessions");

const metrics = metricsArg.split(",").map((m) => m.trim());
const dimensions = args.dimensions
  ? args.dimensions.split(",").map((d) => d.trim())
  : [];
const days = parseInt(args.days || "30", 10);

const result = await runReport(dimensions, metrics, {
  startDate: `${days}daysAgo`,
  endDate: "today",
});

output(result);
