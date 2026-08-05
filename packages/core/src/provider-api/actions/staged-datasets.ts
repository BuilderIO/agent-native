import { z, type ZodTypeAny } from "zod";

import { defineAction, type ActionHttpConfig } from "../../action.js";
import { getCredentialContext } from "../../server/request-context.js";
import { runAggregateQuery } from "../staged-datasets-aggregate.js";
import {
  deleteStagedDataset,
  getStagedDatasetMeta,
  getStagedDatasetRows,
  listStagedDatasets,
} from "../staged-datasets-store.js";

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

export function createQueryStagedDatasetSchema(
  options: {
    includeAppId?: boolean;
  } = {},
) {
  const shape = {
    datasetId: z
      .string()
      .min(1)
      .describe(
        "Dataset id returned by provider-api-request when stageAs was set, or from list-staged-datasets.",
      ),
    where: z
      .array(WhereSchema)
      .optional()
      .describe(
        "Optional row-level filters. All clauses must match (AND). Ops: equals, not_equals, contains, not_contains, gt, gte, lt, lte, exists, not_exists.",
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
        "Aggregation fields. When omitted, rows are returned as-is after filters and projection.",
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
  };
  return options.includeAppId
    ? z.object({
        ...shape,
        appId: z.string().min(1).describe("App id that owns the dataset."),
      })
    : z.object(shape);
}

export function createListStagedDatasetsSchema(
  options: {
    includeAppId?: boolean;
  } = {},
) {
  return options.includeAppId
    ? z.object({
        appId: z.string().min(1).describe("App id that owns the datasets."),
      })
    : z.object({});
}

export function createDeleteStagedDatasetSchema(
  options: {
    includeAppId?: boolean;
  } = {},
) {
  const shape = {
    datasetId: z
      .string()
      .min(1)
      .describe("Dataset id to delete (from list-staged-datasets)."),
  };
  return options.includeAppId
    ? z.object({
        ...shape,
        appId: z.string().min(1).describe("App id that owns the dataset."),
      })
    : z.object(shape);
}

type StagedActionArgs = {
  appId?: string;
  datasetId?: string;
  where?: Array<{
    column: string;
    op:
      | "equals"
      | "not_equals"
      | "contains"
      | "not_contains"
      | "gt"
      | "gte"
      | "lt"
      | "lte"
      | "exists"
      | "not_exists";
    value?: unknown;
  }>;
  groupBy?: string[];
  aggregate?: Array<{
    column: string;
    op: "sum" | "avg" | "count" | "min" | "max" | "count_distinct";
    as?: string;
  }>;
  select?: string[];
  orderBy?: string;
  orderDir?: "asc" | "desc";
  limit?: number;
};

export interface StagedDatasetActionRuntime {
  getMeta: typeof getStagedDatasetMeta;
  getRows: typeof getStagedDatasetRows;
  list: typeof listStagedDatasets;
  delete: typeof deleteStagedDataset;
  aggregate: typeof runAggregateQuery;
}

const defaultRuntime: StagedDatasetActionRuntime = {
  getMeta: getStagedDatasetMeta,
  getRows: getStagedDatasetRows,
  list: listStagedDatasets,
  delete: deleteStagedDataset,
  aggregate: runAggregateQuery,
};

interface StagedDatasetActionBaseOptions<TSchema extends ZodTypeAny> {
  appId?: string;
  schema?: TSchema;
  description?: string;
  http?: ActionHttpConfig | false;
  getOwnerEmail?: () => string | null;
  runtime?: StagedDatasetActionRuntime;
}

function resolveScope(
  actionName: string,
  args: StagedActionArgs,
  options: Pick<
    StagedDatasetActionBaseOptions<ZodTypeAny>,
    "appId" | "getOwnerEmail"
  >,
) {
  const appId = options.appId ?? args.appId;
  if (!appId) throw new Error(`No app id for ${actionName}.`);
  const ownerEmail = options.getOwnerEmail
    ? options.getOwnerEmail()
    : (getCredentialContext()?.userEmail ?? null);
  if (!ownerEmail)
    throw new Error(`No authenticated context for ${actionName}.`);
  return { appId, ownerEmail };
}

export type CreateQueryStagedDatasetActionOptions<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createQueryStagedDatasetSchema
  >,
> = StagedDatasetActionBaseOptions<TSchema>;

export function createQueryStagedDatasetAction<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createQueryStagedDatasetSchema
  >,
>(options: CreateQueryStagedDatasetActionOptions<TSchema> = {}) {
  const schema =
    options.schema ??
    createQueryStagedDatasetSchema({ includeAppId: !options.appId });
  const runtime = options.runtime ?? defaultRuntime;
  return defineAction({
    description:
      options.description ??
      "Run a filter, aggregate, or projection query over a staged dataset stored by provider-api-request. Aggregation runs in-process and remains database-portable.",
    schema,
    http: options.http ?? false,
    readOnly: true,
    run: async (rawArgs) => {
      const args = rawArgs as StagedActionArgs;
      const scope = resolveScope("query-staged-dataset", args, options);
      const datasetId = String(args.datasetId ?? "");
      const meta = await runtime.getMeta({ id: datasetId, ...scope });
      if (!meta) {
        throw new Error(
          `Dataset ${datasetId} not found (or belongs to a different owner/app).`,
        );
      }
      const rows = await runtime.getRows({ id: datasetId, ...scope });
      const result = runtime.aggregate(rows, {
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
}

export type CreateListStagedDatasetsActionOptions<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createListStagedDatasetsSchema
  >,
> = StagedDatasetActionBaseOptions<TSchema>;

export function createListStagedDatasetsAction<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createListStagedDatasetsSchema
  >,
>(options: CreateListStagedDatasetsActionOptions<TSchema> = {}) {
  const schema =
    options.schema ??
    createListStagedDatasetsSchema({ includeAppId: !options.appId });
  const runtime = options.runtime ?? defaultRuntime;
  return defineAction({
    description:
      options.description ??
      "List staged datasets stored by provider-api-request for the current user and app.",
    schema,
    http: options.http ?? { method: "GET" },
    readOnly: true,
    run: async (rawArgs) => {
      const args = rawArgs as StagedActionArgs;
      const scope = resolveScope("list-staged-datasets", args, options);
      const datasets = await runtime.list(scope);
      return {
        datasets: datasets.map((dataset) => ({
          id: dataset.id,
          name: dataset.name,
          rowCount: dataset.rowCount,
          columns: dataset.columns,
          byteSize: dataset.byteSize,
          updatedAt: new Date(dataset.updatedAt).toISOString(),
        })),
        total: datasets.length,
      };
    },
  });
}

export type CreateDeleteStagedDatasetActionOptions<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createDeleteStagedDatasetSchema
  >,
> = StagedDatasetActionBaseOptions<TSchema>;

export function createDeleteStagedDatasetAction<
  TSchema extends ZodTypeAny = ReturnType<
    typeof createDeleteStagedDatasetSchema
  >,
>(options: CreateDeleteStagedDatasetActionOptions<TSchema> = {}) {
  const schema =
    options.schema ??
    createDeleteStagedDatasetSchema({ includeAppId: !options.appId });
  const runtime = options.runtime ?? defaultRuntime;
  return defineAction({
    description:
      options.description ??
      "Delete a staged dataset by id, freeing its scratch storage. Only the owner who staged the dataset can delete it.",
    schema,
    http: options.http ?? false,
    run: async (rawArgs) => {
      const args = rawArgs as StagedActionArgs;
      const scope = resolveScope("delete-staged-dataset", args, options);
      const datasetId = String(args.datasetId ?? "");
      const deleted = await runtime.delete({ id: datasetId, ...scope });
      if (!deleted) {
        throw new Error(
          `Dataset ${datasetId} not found (or belongs to a different owner/app).`,
        );
      }
      return { deleted: true, datasetId };
    },
  });
}

export interface CreateStagedDatasetActionsOptions {
  appId?: string;
  getOwnerEmail?: () => string | null;
  runtime?: StagedDatasetActionRuntime;
  query?: Omit<
    CreateQueryStagedDatasetActionOptions,
    "appId" | "getOwnerEmail" | "runtime"
  >;
  list?: Omit<
    CreateListStagedDatasetsActionOptions,
    "appId" | "getOwnerEmail" | "runtime"
  >;
  delete?: Omit<
    CreateDeleteStagedDatasetActionOptions,
    "appId" | "getOwnerEmail" | "runtime"
  >;
}

export function createStagedDatasetActions(
  options: CreateStagedDatasetActionsOptions = {},
) {
  const shared = {
    appId: options.appId,
    getOwnerEmail: options.getOwnerEmail,
    runtime: options.runtime,
  };
  return {
    query: createQueryStagedDatasetAction({ ...shared, ...options.query }),
    list: createListStagedDatasetsAction({ ...shared, ...options.list }),
    delete: createDeleteStagedDatasetAction({ ...shared, ...options.delete }),
  };
}
