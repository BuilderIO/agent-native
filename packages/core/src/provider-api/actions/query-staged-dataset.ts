/**
 * query-staged-dataset — run an in-memory aggregation over a staged dataset.
 *
 * All aggregation is done in TypeScript (no SQL JSON functions) so the action
 * works identically on Postgres and SQLite.
 */
import { defineAction } from "../../action.js";
import { z } from "zod";
import { getCredentialContext } from "../../server/request-context.js";
import {
  getStagedDatasetRows,
  getStagedDatasetMeta,
} from "../staged-datasets-store.js";
import { runAggregateQuery } from "../staged-datasets-aggregate.js";

const WhereSchema = z.object({
  column: z.string().min(1),
  op: z.enum([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "gt",
    "gte",
    "lt",
    "lte",
    "exists",
    "not_exists",
  ]),
  value: z.unknown().optional(),
});

const AggregateFieldSchema = z.object({
  column: z.string().min(1).describe("Column to aggregate."),
  op: z
    .enum(["sum", "avg", "count", "min", "max", "count_distinct"])
    .describe("Aggregation function."),
  as: z
    .string()
    .optional()
    .describe("Output column name. Default: {op}_{column}."),
});

export default defineAction({
  description:
    "Run a filter/aggregate/project query over a staged dataset stored by provider-api-request (stageAs). " +
    "All aggregation is done in-process — no SQL dialect differences. " +
    "Use this after staging to compute counts, sums, averages, min/max, or to filter/project rows without re-fetching the provider API.",
  schema: z.object({
    datasetId: z
      .string()
      .min(1)
      .describe(
        "Dataset id returned by provider-api-request when stageAs was set, or from list-staged-datasets.",
      ),
    appId: z
      .string()
      .min(1)
      .describe(
        "App id that owns the dataset (must match the staging context).",
      ),
    where: z
      .array(WhereSchema)
      .optional()
      .describe(
        "Optional row-level filters. All clauses must match (AND). " +
          "Ops: equals, not_equals, contains, not_contains, gt, gte, lt, lte, exists, not_exists.",
      ),
    groupBy: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Column(s) to group by. Omit for a single aggregate over all rows.",
      ),
    aggregate: z
      .array(AggregateFieldSchema)
      .optional()
      .describe(
        "Aggregation fields. When set, non-group columns are aggregated. " +
          "When omitted, rows are returned as-is (after where + select).",
      ),
    select: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Column projection when aggregate is empty. Omit to return all columns.",
      ),
    orderBy: z.string().optional().describe("Sort output by this column."),
    orderDir: z
      .enum(["asc", "desc"])
      .optional()
      .describe("Sort direction (default asc)."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Maximum rows to return (default all, max 10000)."),
  }),
  http: false,
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx)
      throw new Error("No authenticated context for query-staged-dataset.");

    const meta = await getStagedDatasetMeta({
      id: args.datasetId,
      appId: args.appId,
      ownerEmail: ctx.userEmail,
    });
    if (!meta) {
      throw new Error(
        `Dataset ${args.datasetId} not found (or belongs to a different owner/app).`,
      );
    }

    const rows = await getStagedDatasetRows({
      id: args.datasetId,
      appId: args.appId,
      ownerEmail: ctx.userEmail,
    });

    const result = runAggregateQuery(rows, {
      where: args.where,
      groupBy: args.groupBy,
      aggregate: args.aggregate,
      select: args.select,
      orderBy: args.orderBy,
      orderDir: args.orderDir,
      limit: args.limit,
    });

    return {
      dataset: { id: meta.id, name: meta.name, totalRows: meta.rowCount },
      rowCount: result.length,
      rows: result,
    };
  },
});
