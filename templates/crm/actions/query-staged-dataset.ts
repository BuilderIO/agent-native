import { createQueryStagedDatasetAction as defineActionFactory } from "@agent-native/core/provider-api/actions/staged-datasets";
import { z } from "zod";

import { CRM_APP_ID } from "../server/lib/provider-api.js";

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

const AggregateSchema = z.object({
  column: z.string().min(1),
  op: z.enum(["sum", "avg", "count", "min", "max", "count_distinct"]),
  as: z.string().optional(),
});

export default defineActionFactory({
  description:
    "Filter, project, sort, or aggregate a caller-scoped staged HubSpot dataset without re-fetching the provider. For exhaustive CRM analysis, stage every bounded page first and report the dataset's source scope, row count, pagination status, truncation, and gaps.",
  schema: z.object({
    datasetId: z.string().min(1),
    where: z.array(WhereSchema).optional(),
    groupBy: z.array(z.string().min(1)).optional(),
    aggregate: z.array(AggregateSchema).optional(),
    select: z.array(z.string().min(1)).optional(),
    orderBy: z.string().optional(),
    orderDir: z.enum(["asc", "desc"]).optional(),
    limit: z.coerce.number().int().min(1).max(10_000).optional(),
  }),
  http: false,
  appId: CRM_APP_ID,
});
