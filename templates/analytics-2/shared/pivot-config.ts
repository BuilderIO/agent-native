import { z } from "zod";

export const PIVOT_AXIS_LIMIT = 8;
export const PIVOT_VALUE_LIMIT = 8;

export const pivotScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const fieldId = z.string().min(1);
const valueFilter = z.strictObject({ fieldId });
const pivotFilterSchema = z.discriminatedUnion("op", [
  valueFilter.extend({ op: z.literal("eq"), value: pivotScalarSchema }),
  valueFilter.extend({
    op: z.literal("in"),
    values: z.array(pivotScalarSchema).min(1).max(200),
  }),
  valueFilter.extend({ op: z.enum(["is-null", "is-not-null"]) }),
]);

export const pivotProducerSchema = z.strictObject({
  cellId: z.string().min(1),
  exportId: z.string().min(1),
});

export const pivotBindingSchema = pivotProducerSchema.extend({
  resultId: z.string().min(1),
});

export const pivotAggregationSchema = z.enum([
  "sum",
  "count",
  "average",
  "min",
  "max",
  "median",
  "count-distinct",
]);

const pivotMeasureSchema = z.strictObject({
  fieldId,
  aggregation: pivotAggregationSchema,
});

export const pivotFormatRuleSchema = z.strictObject({
  measureId: z.string().min(1),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
  value: z.number(),
});

const legacyPivotConfigSchema = z.strictObject({
  version: z.literal(1),
  revision: z.int().nonnegative(),
  source: pivotBindingSchema.nullable(),
  rows: z.array(fieldId).max(2),
  columns: z.array(fieldId).max(2),
  values: z.array(pivotMeasureSchema).max(4),
  rowTotals: z.boolean(),
  columnTotals: z.boolean(),
  filters: z.array(pivotFilterSchema).max(32),
});

export const pivotConfigV2Schema = legacyPivotConfigSchema
  .extend({
    version: z.literal(2),
    source: pivotProducerSchema.nullable(),
    rows: z.array(fieldId).max(PIVOT_AXIS_LIMIT),
    columns: z.array(fieldId).max(PIVOT_AXIS_LIMIT),
    values: z
      .array(pivotMeasureSchema.extend({ measureId: z.string().min(1) }))
      .max(PIVOT_VALUE_LIMIT),
    subtotals: z.boolean(),
    orientation: z.enum(["columns", "rows"]),
    formatRules: z.array(pivotFormatRuleSchema).max(32).optional(),
  })
  .superRefine(({ rows, columns, values, formatRules }, ctx) => {
    const dimensions = [...rows, ...columns];
    if (new Set(dimensions).size !== dimensions.length)
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Duplicate pivot dimension",
      });
    if (
      new Set(values.map(({ measureId }) => measureId)).size !== values.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["values"],
        message: "Duplicate pivot measure ID",
      });
    if (
      formatRules?.some(
        (rule) =>
          !values.some((measure) => measure.measureId === rule.measureId),
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["formatRules"],
        message: "Conditional formatting references a missing pivot measure",
      });
  });

export const pivotConfigSchema = z.discriminatedUnion("version", [
  legacyPivotConfigSchema,
  pivotConfigV2Schema,
]);

export const defaultPivotConfig: PivotConfigV2 = {
  version: 2,
  revision: 0,
  source: null,
  rows: [],
  columns: [],
  values: [],
  rowTotals: true,
  columnTotals: true,
  subtotals: false,
  orientation: "columns",
  filters: [],
};

export type PivotConfig = z.infer<typeof pivotConfigSchema>;
export type PivotConfigV2 = z.infer<typeof pivotConfigV2Schema>;
export type PivotScalar = z.infer<typeof pivotScalarSchema>;

export function upgradePivotConfig(config: PivotConfig): PivotConfigV2 {
  if (config.version === 2) return config;
  const { source, values } = config;
  return {
    ...config,
    version: 2,
    source: source && { cellId: source.cellId, exportId: source.exportId },
    values: values.map((value, index) => ({
      ...value,
      measureId: `legacy-${index}`,
    })),
    subtotals: false,
    orientation: "columns",
  };
}
