import { z } from "zod";

import type { ResultField } from "./notebook-result-contract.js";
import { pivotAggregationSchema, pivotProducerSchema } from "./pivot-config.js";

export const metricFormatSchema = z.enum([
  "plain",
  "number",
  "percent",
  "scientific",
  "currency",
  "long-currency",
  "financial",
  "iso-date",
  "date",
  "long-date",
  "time",
  "date-time",
]);

export const metricConfigSchema = z.strictObject({
  version: z.literal(1),
  revision: z.int().nonnegative(),
  source: pivotProducerSchema
    .nullable()
    .describe(
      "The producer cell and dataframe export, or null to leave it unset.",
    ),
  fieldId: z
    .string()
    .min(1)
    .nullable()
    .describe("The producer's result field ID. Null selects its first field."),
  mode: z.enum(["aggregate", "row"]),
  aggregation: pivotAggregationSchema
    .nullable()
    .describe("Null uses the selected field type's default aggregate."),
  row: z
    .int()
    .describe("Zero-based row index. Negative indices count from the end."),
  title: z.string(),
  format: metricFormatSchema.nullable(),
});

export type MetricConfig = z.infer<typeof metricConfigSchema>;
export type MetricFormat = z.infer<typeof metricFormatSchema>;
type MetricAggregation = NonNullable<MetricConfig["aggregation"]>;

export const defaultMetricConfig: MetricConfig = {
  version: 1,
  revision: 0,
  source: null,
  fieldId: null,
  mode: "aggregate",
  aggregation: null,
  row: 0,
  title: "",
  format: null,
};

function numeric({ type }: ResultField) {
  return type === "number" || type === "integer" || type === "decimal";
}

function temporal({ type }: ResultField) {
  return type === "date" || type === "datetime" || type === "time";
}

export function metricAggregations(field: ResultField): MetricAggregation[] {
  if (numeric(field))
    return [
      "sum",
      "average",
      "min",
      "max",
      "median",
      "count",
      "count-distinct",
    ];
  if (temporal(field)) return ["min", "max", "count", "count-distinct"];
  return ["count", "count-distinct"];
}

export function defaultMetricAggregation(
  field: ResultField,
): MetricAggregation {
  if (numeric(field)) return "sum";
  if (temporal(field)) return "max";
  return "count-distinct";
}
