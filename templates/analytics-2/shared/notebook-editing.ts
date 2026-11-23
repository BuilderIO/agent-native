import { z } from "zod";

import {
  chartAggregationSchema,
  chartTimeUnitSchema,
} from "../app/lib/model/contracts.js";

export const NOTEBOOK_SNAPSHOT_CELL_LIMIT = 8;
export const NOTEBOOK_SNAPSHOT_TEXT_LIMIT = 2000;
const shortText = z.string().max(200);

export const notebookEditingSchema = z.object({
  projectId: z.string().min(1).max(200),
  truncated: z.boolean(),
  cells: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          id: shortText,
          kind: z.enum(["sql", "markdown", "text", "code"]),
          text: z.string().max(NOTEBOOK_SNAPSHOT_TEXT_LIMIT),
          truncated: z.boolean(),
          unsaved: z.boolean(),
        }),
        z.object({
          id: shortText,
          kind: z.literal("chart"),
          dataframe: shortText.nullable(),
          chartSpec: z.object({
            mark: shortText,
            xField: shortText.nullable(),
            xTimeUnit: chartTimeUnitSchema.optional(),
            yField: shortText.nullable(),
            yAggregation: chartAggregationSchema.optional(),
            seriesField: shortText.nullable(),
            title: shortText.nullable(),
            yFields: z.array(shortText).max(4).optional(),
            stacked: z.boolean().optional(),
            colors: z.array(shortText).max(4).optional(),
            yFormatter: z.enum(["number", "percent"]).optional(),
            seriesLabels: z
              .record(shortText, shortText)
              .refine((labels) => Object.keys(labels).length <= 4)
              .optional(),
            seriesOrder: z.array(shortText).max(4).optional(),
            legend: z.boolean().optional(),
          }),
          truncated: z.boolean().optional(),
          unsaved: z.boolean(),
        }),
      ]),
    )
    .max(NOTEBOOK_SNAPSHOT_CELL_LIMIT),
});

export type NotebookEditing = z.infer<typeof notebookEditingSchema>;

export const notebookEditingSummarySchema = notebookEditingSchema.extend({
  cells: z
    .array(
      z.object({
        id: shortText,
        kind: z.enum(["sql", "markdown", "text", "code", "chart"]),
        truncated: z.boolean().optional(),
        unsaved: z.boolean(),
      }),
    )
    .max(NOTEBOOK_SNAPSHOT_CELL_LIMIT),
});
