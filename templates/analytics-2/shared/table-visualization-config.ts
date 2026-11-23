import { z } from "zod";

import { pivotAggregationSchema, pivotScalarSchema } from "./pivot-config.js";

const fieldId = z.string().min(1);
const fieldFilter = z.strictObject({ fieldId });

export const tableFilterSchema = z.discriminatedUnion("op", [
  fieldFilter.extend({
    op: z.enum([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "contains",
      "not-contains",
    ]),
    value: pivotScalarSchema,
  }),
  fieldFilter.extend({
    op: z.enum(["in", "not-in"]),
    values: z.array(pivotScalarSchema).min(1).max(200),
  }),
  fieldFilter.extend({ op: z.enum(["is-null", "is-not-null"]) }),
]);

export const tableSourceSchema = z.strictObject({
  cellId: z.string().min(1),
  exportId: z.string().min(1),
});

export const tableFormatSchema = z.enum(["default", "number", "percent"]);

const columnPreferenceSchema = z.strictObject({
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
  label: z.string().min(1).max(200).optional(),
  format: tableFormatSchema.optional(),
});

export const tableVisualizationConfigSchema = z.strictObject({
  version: z.literal(1),
  source: tableSourceSchema.nullable(),
  filters: z.array(tableFilterSchema).max(32),
  sort: z
    .strictObject({ fieldId, direction: z.enum(["asc", "desc"]) })
    .nullable(),
  totals: z.record(fieldId, pivotAggregationSchema),
  columns: z.record(fieldId, columnPreferenceSchema),
  columnOrder: z.array(fieldId).optional(),
  view: z.strictObject({
    rowNumbers: z.boolean(),
    typeIcons: z.boolean(),
    rowNumbersPinned: z.boolean(),
    columnWidth: z.int().min(60).max(500).nullable(),
  }),
  formatRules: z.array(tableFilterSchema).max(32),
});

export const defaultTableConfig: TableConfig = {
  version: 1,
  source: null,
  filters: [],
  sort: null,
  totals: {},
  columns: {},
  view: {
    rowNumbers: true,
    typeIcons: true,
    rowNumbersPinned: false,
    columnWidth: null,
  },
  formatRules: [],
};

export type TableConfig = z.infer<typeof tableVisualizationConfigSchema>;
export type TableFilter = z.infer<typeof tableFilterSchema>;
export type TableColumnPreference = z.infer<typeof columnPreferenceSchema>;
