/**
 * Thin Brain re-export of the staged dataset query helper, pre-bound to appId="brain".
 */
import { defineAction } from "@agent-native/core";
import { runAggregateQuery } from "@agent-native/core/provider-api/staged-datasets-aggregate";
import {
  getStagedDatasetMeta,
  getStagedDatasetRows,
} from "@agent-native/core/provider-api/staged-datasets-store";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { BRAIN_APP_ID } from "../server/lib/provider-api.js";

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
    "Run a filter/aggregate/project query over a staged dataset previously written by provider-api-request (stageAs). Use after staging provider source records, messages, transcripts, documents, issues, events, or search results to count, group, filter, or project rows without re-fetching provider APIs.",
  schema: z.object({
    datasetId: z
      .string()
      .min(1)
      .describe(
        "Dataset id from provider-api-request stageAs result, or from list-staged-datasets.",
      ),
    where: z
      .array(WhereSchema)
      .optional()
      .describe(
        "Row-level filters (AND). Ops: equals, not_equals, contains, not_contains, gt, gte, lt, lte, exists, not_exists.",
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
        "Aggregation operations. When set, non-group columns are aggregated. Omit to return raw rows.",
      ),
    select: z
      .array(z.string().min(1))
      .optional()
      .describe("Column projection when aggregate is empty."),
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
  readOnly: true,
  run: async (args) => {
    const ctx = getCredentialContext();
    if (!ctx) {
      throw new Error("No authenticated context for query-staged-dataset.");
    }

    const meta = await getStagedDatasetMeta({
      id: args.datasetId,
      appId: BRAIN_APP_ID,
      ownerEmail: ctx.userEmail,
    });
    if (!meta) {
      throw new Error(
        `Dataset ${args.datasetId} not found (or belongs to a different owner/app).`,
      );
    }

    const rows = await getStagedDatasetRows({
      id: args.datasetId,
      appId: BRAIN_APP_ID,
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
