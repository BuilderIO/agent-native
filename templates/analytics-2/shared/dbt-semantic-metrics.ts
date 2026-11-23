import { z } from "zod";

export const listDbtSemanticMetricsInput = z
  .object({
    connectionId: z.string().trim().min(1).max(500),
    pageNum: z.number().int().min(1).max(2_147_483_647).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    search: z.string().max(500).optional(),
  })
  .strict();

export const dbtSemanticGrainSchema = z.enum([
  "SECOND",
  "MINUTE",
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
]);
const grain = dbtSemanticGrainSchema;
export const dbtSemanticMetricsOutput = z.object({
  connectionId: z.string(),
  items: z.array(
    z.object({
      name: z.string().min(1).max(256),
      description: z.string().max(20_000).nullable(),
      type: z.string().max(100),
      dimensions: z.array(
        z.object({
          name: z.string().min(1).max(256),
          description: z.string().max(20_000).nullable(),
          type: z.string().max(100),
          queryableGranularities: z.array(grain),
        }),
      ),
      queryableGranularities: z.array(grain),
    }),
  ),
  pageNum: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const queryDbtSemanticMetricsInput = z
  .object({
    connectionId: z.string().trim().min(1).max(500),
    metrics: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            alias: z.string().min(1).max(256).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    groupBy: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            grain: grain.optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    where: z
      .array(z.object({ sql: z.string().min(1).max(8_000) }).strict())
      .max(100)
      .optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

export const queryDbtSemanticMetricsOutput = z.object({
  connectionId: z.string(),
  queryId: z.string(),
  status: z.literal("SUCCESSFUL"),
  pageNum: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  sql: z.string().nullable(),
  fields: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.record(z.string(), z.unknown())),
  hasMore: z.boolean(),
});

export function sharedQueryableGranularities(
  metrics: ReadonlyArray<{
    queryableGranularities: ReadonlyArray<z.infer<typeof grain>>;
  }>,
) {
  const [first, ...rest] = metrics;
  if (!first) return [];
  return [...new Set(first.queryableGranularities)].filter((value) =>
    rest.every((metric) => metric.queryableGranularities.includes(value)),
  );
}
