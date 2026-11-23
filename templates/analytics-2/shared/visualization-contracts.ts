import { z } from "zod";

import { appSessionIdSchema } from "./notebook-execution.js";
import {
  authorizedResultRefSchema,
  resultFieldSchema,
} from "./notebook-result-contract.js";
import {
  pivotAggregationSchema,
  pivotBindingSchema,
  pivotConfigV2Schema,
  pivotScalarSchema,
} from "./pivot-config.js";
import { tableFilterSchema } from "./table-visualization-config.js";

export {
  defaultPivotConfig,
  PIVOT_AXIS_LIMIT,
  PIVOT_VALUE_LIMIT,
  pivotAggregationSchema,
  pivotConfigSchema,
  type PivotConfig,
  type PivotScalar,
} from "./pivot-config.js";

export const transformSourceSchema = z.strictObject({
  result: authorizedResultRefSchema,
  fields: z.array(resultFieldSchema),
  completeness: z.literal("complete"),
  rowCount: z.int().nonnegative(),
});

export const sourceOptionSchema = z.strictObject({
  binding: pivotBindingSchema,
  name: z.string(),
  fields: z.array(resultFieldSchema),
});

const axisKeySchema = z.array(pivotScalarSchema).nullable();
const matrixValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("value"),
    value: z.number().nullable(),
    selectionId: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("missing") }),
]);

const transformFailures = [
  z.strictObject({ status: z.literal("unconfigured") }),
  z.strictObject({
    status: z.literal("stale"),
    reason: z.enum(["result_superseded", "notebook_conflict"]),
  }),
  z.strictObject({
    status: z.literal("denied"),
    reason: z.literal("result_source_denied"),
  }),
  z.strictObject({
    status: z.literal("blocked"),
    reason: z.enum([
      "result_incomplete",
      "visualization_binding_invalid",
      "pivot_aggregate_invalid",
      "result_limit",
    ]),
  }),
  z.strictObject({
    status: z.literal("unreadable"),
    reason: z.literal("result_unreadable"),
  }),
] as const;

const ready = z.strictObject({
  status: z.enum(["ready", "empty"]),
  source: transformSourceSchema,
  visualizationResultId: z.string().optional(),
  capped: z.boolean().optional(),
});
const pivotResult = ready.extend({
  columns: z.array(axisKeySchema),
  rowAxisCount: z.int().nonnegative().optional(),
  columnAxisCount: z.int().nonnegative().optional(),
  rowPage: z.int().positive().optional(),
  columnPage: z.int().positive().optional(),
  columnSubtotals: z.array(z.int().nonnegative()).optional(),
  orientation: z.enum(["columns", "rows"]).optional(),
  config: pivotConfigV2Schema.optional(),
  rows: z.array(
    z.strictObject({
      key: axisKeySchema,
      subtotal: z.boolean().optional(),
      values: z.array(matrixValueSchema),
    }),
  ),
});
const chartResult = ready.extend({
  kind: z.literal("chart"),
  visualizationResultId: z.string(),
  categories: z.array(pivotScalarSchema),
  rows: z.array(
    z.strictObject({
      x: pivotScalarSchema,
      series: pivotScalarSchema,
      value: z.number().nullable(),
      selectionId: z.string(),
    }),
  ),
});
const metricResult = ready.extend({
  kind: z.literal("metric"),
  field: resultFieldSchema,
  aggregation: pivotAggregationSchema.nullable(),
  value: pivotScalarSchema,
});

export const notebookTransformSchema = z.strictObject({
  sources: z.array(sourceOptionSchema),
  result: z.union([
    pivotResult,
    chartResult,
    metricResult,
    ...transformFailures,
  ]),
});

export type TransformSource = z.infer<typeof transformSourceSchema>;
export type NotebookTransform = z.infer<typeof notebookTransformSchema>;
export type VisualizationFailure = z.infer<(typeof transformFailures)[number]>;
export type PivotTransformResult = z.infer<typeof pivotResult>;
export type ChartTransformResult = z.infer<typeof chartResult>;
export type MetricTransformResult = z.infer<typeof metricResult>;

const page = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.int().min(1).max(2_147_483_647));
const cell = z.strictObject({
  projectId: z.string().min(1),
  cellId: z.string().min(1),
  releaseId: z.string().min(1).optional(),
  sessionId: appSessionIdSchema.optional(),
  previewId: z.string().min(1).optional(),
});
export const visualizationPageInputSchema = cell.extend({
  kind: z.literal("table"),
  page: page.optional(),
  resultId: z.string().min(1).optional(),
  expectedUpdatedAt: z.string().optional(),
});
const pageResult = z.strictObject({
  status: z.enum(["ready", "empty"]),
  columns: z.array(resultFieldSchema),
  rows: z.array(z.array(pivotScalarSchema)).max(50),
  totalRows: z.int().nonnegative(),
  page: z.int().positive(),
});
const withSources = { sources: z.array(sourceOptionSchema) };
export const visualizationPageOutputSchema = z.union([
  pageResult.extend({
    resultId: z.string(),
    totals: z.array(z.union([z.number(), z.string(), z.null()])),
    ...withSources,
  }),
  ...transformFailures.map((failure) => failure.extend(withSources)),
]);

export const visualizationDrillInputSchema = cell.extend({
  visualizationResultId: z.string().min(1),
  selectionId: z.string().min(1),
  mode: z.enum(["view-data", "drill-down", "keep", "remove"]),
  nextFieldId: z.string().min(1).optional(),
  page: page.optional(),
  requestId: z.uuid(),
});
export const visualizationDrillOutputSchema = z.union([
  pageResult.extend({
    resultId: z.string(),
    filters: z.array(
      z.strictObject({ name: z.string(), value: pivotScalarSchema }),
    ),
    predicate: z.array(tableFilterSchema).optional(),
  }),
  ...transformFailures,
]);
export type VisualizationPageInput = z.infer<
  typeof visualizationPageInputSchema
>;
export type VisualizationPageOutput = z.infer<
  typeof visualizationPageOutputSchema
>;
export type VisualizationDrillInput = z.infer<
  typeof visualizationDrillInputSchema
>;
export type VisualizationDrillOutput = z.infer<
  typeof visualizationDrillOutputSchema
>;
