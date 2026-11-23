import { z } from "zod";

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "./bigquery-source-contract.js";

export const organizationWarehouseQueryInputSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        operation: z.literal("start"),
        connectionId: z.literal(ORGANIZATION_BIGQUERY_SOURCE_ID),
        sql: z.string().trim().min(1).max(100_000),
        maxRows: z.number().int().min(1).max(50_000).default(1000),
      })
      .strict(),
    z
      .object({
        operation: z.enum(["poll", "next-page"]),
        queryId: z.string().regex(/^[a-f0-9]{64}\.[a-f0-9-]{36}$/),
      })
      .strict(),
  ],
);
export const organizationWarehouseQueryOutputSchema = z.object({
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.enum([
        "string",
        "number",
        "boolean",
        "date",
        "datetime",
        "json",
        "unknown",
      ]),
    }),
  ),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int().nonnegative(),
  complete: z.boolean(),
  hasMore: z.boolean(),
  nextPageToken: z.string().nullable(),
  queryId: z.string().nullable(),
  status: z.enum(["running", "paging", "complete", "budget_exhausted"]),
  totalRows: z.string().nullable(),
  truncated: z.boolean(),
  jobComplete: z.boolean(),
  semanticDefinitionIds: z.array(z.string()).length(0),
  warnings: z.array(z.string()),
});
export type OrganizationWarehouseQueryInput = z.infer<
  typeof organizationWarehouseQueryInputSchema
>;
export type OrganizationWarehouseQueryOutput = z.infer<
  typeof organizationWarehouseQueryOutputSchema
>;

export const recoverOrganizationWarehouseQueryInputSchema = z
  .object({
    connectionId: z.literal(ORGANIZATION_BIGQUERY_SOURCE_ID),
    sql: z.string().trim().min(1).max(100_000),
  })
  .strict();
