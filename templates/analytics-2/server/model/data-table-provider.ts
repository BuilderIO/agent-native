import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  dataTableColumnModeSchema,
  type DataTableColumn,
  type DataTableMetadata,
} from "../../app/lib/model/data-table-contracts.js";
import type { runtimeForConnection } from "./data-connection-provider.js";

type ProviderRuntime = Awaited<ReturnType<typeof runtimeForConnection>>;

type ProviderField = {
  name: string;
  type: string;
  mode?: z.infer<typeof dataTableColumnModeSchema> | undefined;
  description?: string | undefined;
  fields?: ProviderField[] | undefined;
};

const providerFieldSchema: z.ZodType<ProviderField> = z.lazy(() =>
  z
    .object({
      name: z.string().min(1),
      type: z.string().min(1),
      mode: dataTableColumnModeSchema.optional(),
      description: z.string().optional(),
      fields: z.array(providerFieldSchema).optional(),
    })
    .passthrough(),
);

const envelopeSchema = z.object({
  response: z.object({
    ok: z.boolean(),
    status: z.number(),
    truncated: z.boolean().optional(),
    json: z.unknown().optional(),
  }),
});

const tableResponseSchema = z
  .object({
    kind: z.literal("bigquery#table"),
    tableReference: z.object({
      projectId: z.string().min(1),
      datasetId: z.string().min(1),
      tableId: z.string().min(1),
    }),
    schema: z.object({
      fields: z.array(providerFieldSchema),
    }),
    type: z.string().optional(),
    description: z.string().optional(),
    numRows: z.string().optional(),
    numBytes: z.string().optional(),
    lastModifiedTime: z.string().optional(),
    location: z.string().min(1).optional(),
    etag: z.string().min(1).optional(),
  })
  .passthrough();

function toColumn(field: ProviderField): DataTableColumn {
  return {
    name: field.name,
    type: field.type,
    mode: field.mode ?? null,
    description: field.description ?? null,
    // A record's children are its real fields; an absent list is an empty
    // nested schema, never a synthesized child count.
    fields: (field.fields ?? []).map(toColumn),
  };
}

/**
 * Read one table's schema and storage statistics from BigQuery.
 *
 * The runtime is the existing selected-credential seam. This module never
 * resolves, stores or logs a credential, and it never returns the provider's
 * raw JSON: only the identity, columns, types, nesting, description and
 * provider-supplied counts cross this boundary.
 */
export async function requestTableDetails(
  runtime: Pick<ProviderRuntime, "executeRequest">,
  table: { projectId: string; datasetId: string; tableId: string },
): Promise<DataTableMetadata> {
  const path = `/projects/${encodeURIComponent(table.projectId)}/datasets/${encodeURIComponent(table.datasetId)}/tables/${encodeURIComponent(table.tableId)}`;
  let raw: unknown;
  try {
    raw = await runtime.executeRequest({
      provider: "bigquery",
      method: "GET",
      path,
      // BASIC supplies the schema but not storage statistics. STORAGE_STATS
      // supplies the same schema plus numRows/numBytes/lastModifiedTime.
      query: { view: "STORAGE_STATS" },
      maxBytes: 16_000_000,
      timeoutMs: 30_000,
    });
  } catch {
    fail("The data source could not be read. Please try again.", {
      errorCode: "data_table_provider_unavailable",
      statusCode: 502,
    });
  }

  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success)
    fail("The data source returned an unreadable table response.", {
      errorCode: "data_table_bad_response",
      statusCode: 502,
    });
  const response = envelope.data.response;
  if (response.truncated)
    fail("The data source response was too large to read completely.", {
      errorCode: "data_table_response_truncated",
      statusCode: 502,
    });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      fail("You do not have permission to read this table.", {
        errorCode: "data_table_permission_denied",
        statusCode: 403,
      });
    if (response.status === 404)
      fail("The selected table was not found.", {
        errorCode: "data_table_not_found",
        statusCode: 404,
      });
    fail("The data source rejected the table metadata request.", {
      errorCode: "data_table_provider_rejected",
      statusCode: 502,
    });
  }
  if (response.json === undefined)
    fail("The data source returned an unreadable table response.", {
      errorCode: "data_table_bad_response",
      statusCode: 502,
    });
  const parsed = tableResponseSchema.safeParse(response.json);
  if (!parsed.success)
    fail("The data source returned an unreadable table response.", {
      errorCode: "data_table_bad_response",
      statusCode: 502,
    });
  const body = parsed.data;
  if (
    body.tableReference.projectId !== table.projectId ||
    body.tableReference.datasetId !== table.datasetId ||
    body.tableReference.tableId !== table.tableId
  )
    fail("The data source returned a different table.", {
      errorCode: "data_table_bad_response",
      statusCode: 502,
    });

  const columns = body.schema.fields.map(toColumn);
  return {
    projectId: table.projectId,
    datasetId: table.datasetId,
    tableId: table.tableId,
    name: table.tableId,
    type: body.type ?? null,
    description: body.description ?? null,
    numRows: body.numRows ?? null,
    numBytes: body.numBytes ?? null,
    lastModifiedTime: body.lastModifiedTime ?? null,
    ...(body.location ? { location: body.location } : {}),
    ...(body.etag
      ? {
          providerRevision: createHash("sha256")
            .update(body.etag)
            .digest("hex"),
        }
      : {}),
    columnCount: columns.length,
    columns,
  };
}
