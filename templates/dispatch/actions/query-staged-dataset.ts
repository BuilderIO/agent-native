import { createQueryStagedDatasetAction } from "@agent-native/core/provider-api/actions/staged-datasets";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { DISPATCH_APP_ID } from "../server/lib/provider-api.js";

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

export default createQueryStagedDatasetAction({
  description:
    "Run a filter/aggregate/project query over a staged dataset previously written by provider-api-request (stageAs). Use after staging provider records, messages, documents, issues, events, or search results to count, group, filter, or project rows without re-fetching provider APIs.",
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
  appId: DISPATCH_APP_ID,
  getOwnerEmail: () => getCredentialContext()?.userEmail ?? null,
  http: false,
  readOnly: true,
});
