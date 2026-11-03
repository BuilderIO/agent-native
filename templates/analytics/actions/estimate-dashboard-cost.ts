import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import estimateQueryCost from "./estimate-query-cost";

const panelIdentity = {
  panelId: z.string(),
  title: z.string(),
  source: z.string(),
};
const costOutput = {
  estimatedBytes: z.number().nonnegative(),
  usdPerRun: z.number().nonnegative(),
  usdPerMonth: z.number().nonnegative().nullable(),
  overPerRunThreshold: z.boolean(),
  overPerMonthThreshold: z.boolean(),
};
const dashboardCostOutput = z.strictObject({
  target: z.literal("dashboard"),
  dashboardId: z.string(),
  filterState: z.enum(["defaults", "overridden"]),
  runsPerMonth: z.number().nonnegative().nullable(),
  runsPerMonthBasis: z.string(),
  total: z.strictObject({
    ...costOutput,
    partial: z.boolean(),
    scope: z.enum(["panel", "dashboard"]),
  }),
  panels: z.array(
    z.discriminatedUnion("status", [
      z.strictObject({
        ...panelIdentity,
        ...costOutput,
        status: z.literal("estimated"),
        estimatedGiB: z.number().nonnegative(),
        runsPerMonth: z.number().nonnegative().nullable(),
      }),
      z.strictObject({
        ...panelIdentity,
        status: z.literal("not_bigquery"),
        reason: z.string(),
      }),
      z.strictObject({
        ...panelIdentity,
        status: z.literal("not_estimated"),
        reason: z.string(),
      }),
      z.strictObject({
        ...panelIdentity,
        status: z.literal("failed"),
        failure: z.enum([
          "not_connected",
          "invalid_sql",
          "timeout",
          "no_estimate",
        ]),
        error: z.string(),
      }),
    ]),
  ),
  omittedPanelIds: z.array(z.string()).optional(),
  pricing: z.strictObject({
    model: z.literal("on-demand"),
    usdPerTiB: z.number().positive(),
    thresholds: z.strictObject({
      perRunUsd: z.number().nonnegative(),
      perMonthUsd: z.number().nonnegative(),
    }),
  }),
  caveats: z.array(z.string()),
  summary: z.string(),
});

export default defineAction({
  description:
    "Free cost estimate for an accessible saved SQL dashboard or panel. Pass dashboardId and optionally panelId and filters; the server resolves the saved query and dry-runs it through Analytics' existing connection without executing or billing a warehouse query. Returns bytes, estimated cost per refresh, scheduled email costs and explicit partial or unpriced results. Accepts no raw SQL and does not edit the dashboard.",
  schema: z.strictObject({
    dashboardId: z
      .string()
      .min(1)
      .describe("Accessible saved SQL dashboard ID."),
    panelId: z
      .string()
      .min(1)
      .optional()
      .describe("One queryable panel ID; omit to estimate the dashboard."),
    filters: z
      .record(z.string(), z.string())
      .optional()
      .describe("Saved dashboard filter values; omit for defaults."),
    runsPerMonth: z
      .preprocess(
        (value) => (value === null || value === "" ? undefined : value),
        z.coerce.number().int().min(0).max(100_000).optional(),
      )
      .describe(
        "Override scheduled runs per month; otherwise use accessible email schedules.",
      ),
  }),
  outputSchema: dashboardCostOutput,
  http: { method: "POST" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  timeoutMs: 55_000,
  run: async (args, context) =>
    dashboardCostOutput.parse(
      await estimateQueryCost.run(
        estimateQueryCost.schema.parse(args),
        context,
      ),
    ),
});
