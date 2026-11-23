import { fail } from "@agent-native/core/action";

import type { GetDataTableDetailsInput } from "../../app/lib/model/data-table-contracts.js";
import { sampleTable } from "../../app/lib/model/sample-data.js";
import { notebookArrowRows } from "../execution/notebook-arrow.js";
import { quotePostgresIdentifier } from "../execution/postgres-connector.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { isBuiltinSampleConnection } from "./data-connection-dto.js";
import {
  executeConnectionQuery,
  readBrowsableDataConnection,
} from "./data-connections.js";
import { getDataTableDetails } from "./data-table-details.js";

const LIMIT = 50;

export function dataTableSqlIdentifier(
  connectionId: string,
  table: { projectId: string; datasetId: string; tableId: string },
  provider?: string,
) {
  if (provider === "postgres") {
    return `${quotePostgresIdentifier(table.datasetId)}.${quotePostgresIdentifier(table.tableId)}`;
  }
  const identifiers = [table.projectId, table.datasetId, table.tableId];
  if (identifiers.some((identifier) => !/^[A-Za-z0-9_-]+$/.test(identifier)))
    fail("This table identifier cannot be queried.", {
      errorCode: "data_table_preview_identifier_invalid",
      statusCode: 422,
    });
  return isBuiltinSampleConnection(connectionId)
    ? table.tableId
    : `\`${identifiers.join(".")}\``;
}

export async function getDataTablePreview(
  input: GetDataTableDetailsInput,
  caller?: string,
) {
  const details = await getDataTableDetails(input, caller);
  const connection = await readBrowsableDataConnection(input.connectionId);
  if (connection.config.disableTablePreviews === true)
    fail("Table previews are disabled for this connection.", {
      errorCode: "data_table_preview_disabled",
      statusCode: 403,
    });

  if (isBuiltinSampleConnection(input.connectionId)) {
    const sample = sampleTable(details.table.tableId);
    if (!sample)
      fail("The selected table was not found.", {
        errorCode: "data_table_not_found",
        statusCode: 404,
      });
    return {
      connectionId: input.connectionId,
      tableId: input.tableId,
      columns: sample.columns.map((column) => column.name),
      rows: sample.rows.slice(0, LIMIT),
    };
  }

  const current = await requireCurrentWorkspace();
  if (connection.provider === "postgres") {
    const { withWarehouseSource } =
      await import("../execution/warehouse-connector.js");
    return withWarehouseSource(
      input.connectionId,
      { ...current, caller: caller ?? "unknown" },
      async (source) => {
        if (source.kind !== "postgres")
          fail("The table connection changed.", {
            statusCode: 409,
            errorCode: "data_catalog_source_changed",
          });
        const compiled = source.compile(
          `select * from ${dataTableSqlIdentifier(input.connectionId, details.table, source.kind)} limit ${LIMIT}`,
          new Map(),
        );
        const cursor = await source.connector.submit(compiled);
        try {
          const page = await cursor.page(LIMIT);
          const result = notebookArrowRows(page.table, page.fields);
          return {
            connectionId: input.connectionId,
            tableId: input.tableId,
            columns: result.columns.map(({ name }) => name),
            rows: result.rows.map((row) => row.map(jsonPreviewValue)),
          };
        } finally {
          await cursor.cancel();
        }
      },
    );
  }
  const result = await executeConnectionQuery(
    {
      connectionId: input.connectionId,
      query: `SELECT * FROM ${dataTableSqlIdentifier(input.connectionId, details.table)} LIMIT ${LIMIT}`,
      first: LIMIT,
      remainingRows: LIMIT,
    },
    {
      userEmail: current.ownerEmail,
      orgId: current.orgId,
      ...(caller === undefined ? {} : { caller }),
    },
  );
  if (!result.jobComplete || result.hasNextPage || result.rows.length > LIMIT)
    fail("The table preview is incomplete. Please try again.", {
      errorCode: "data_table_preview_incomplete",
      statusCode: 503,
    });
  await getDataTableDetails(input, caller);
  const latest = await readBrowsableDataConnection(input.connectionId);
  if (latest.config.disableTablePreviews === true)
    fail("Table previews are disabled for this connection.", {
      errorCode: "data_table_preview_disabled",
      statusCode: 403,
    });
  return {
    connectionId: input.connectionId,
    tableId: input.tableId,
    columns: result.columns.map((column) => column.name),
    rows: result.rows,
  };
}

function jsonPreviewValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(jsonPreviewValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        jsonPreviewValue(entry),
      ]),
    );
  return value;
}
