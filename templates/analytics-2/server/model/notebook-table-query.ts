import { createHash } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";

import type { GetDataTableDetailsInput } from "../../app/lib/model/data-table-contracts.js";
import { capabilityScopeRefSchema } from "../../shared/capabilities.js";
import type { QueryNotebookTableInput } from "../../shared/notebook-table-query.js";
import { warehouseTableProvenanceSchema } from "../../shared/warehouse-table.js";
import { withWarehouseSource } from "../execution/warehouse-connector.js";
import {
  ANALYTICS_CONTROL_IDS,
  evaluateCapability,
} from "../lib/analytics-capabilities.js";
import { warehouseCatalogSnapshotToken } from "./data-browser-catalog.js";
import { dataTableSqlIdentifier } from "./data-table-preview.js";
import { wakeNotebookRun } from "./notebook-execution/service.js";
import type { ExecutionActor } from "./notebook-execution/snapshot.js";
import {
  applyNotebookTableQuery,
  readNotebookTableQueryReplay,
} from "./notebook-operations/store.js";

function generation(value: unknown) {
  const digest = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
  return BigInt(`0x${digest}`).toString();
}

export async function requireTableQuerySource<T>(
  actor: ExecutionActor,
  connectionId: string,
  run: Parameters<typeof withWarehouseSource<T>>[2],
) {
  try {
    return await withWarehouseSource(connectionId, actor, run);
  } catch (error) {
    if (!isActionContractError(error)) throw error;
    if (
      error.statusCode === 404 ||
      error.errorCode === "data_table_project_denied"
    )
      fail("Table not found.", {
        statusCode: 404,
        errorCode: "table_not_found",
      });
    if (error.statusCode === 403)
      fail("You don’t have permission to query this table.", {
        statusCode: 403,
        errorCode: "table_query_denied",
      });
    if (typeof error.statusCode === "number" && error.statusCode >= 500)
      fail("The table catalog could not be read.", {
        statusCode: 503,
        errorCode: "catalog_unreadable",
      });
    throw error;
  }
}

async function prepareTableQuery(
  actor: ExecutionActor,
  input: GetDataTableDetailsInput,
) {
  return requireTableQuerySource(actor, input.connectionId, async (source) => {
    const { table } = await source.describe(input.tableId);
    if (source.kind === "bigquery" && table.location === undefined)
      fail("The table region could not be read.", {
        statusCode: 503,
        errorCode: "catalog_unreadable",
      });
    const snapshotToken = await warehouseCatalogSnapshotToken(
      actor,
      input.connectionId,
    );
    const provenance = warehouseTableProvenanceSchema.parse({
      ...input,
      authorityGeneration: source.generation ?? "0",
      catalogGeneration: generation([
        input.connectionId,
        input.tableId,
        snapshotToken,
        table.providerRevision ?? null,
        table.columns,
        table.location ?? null,
      ]),
      projectId: table.projectId,
      schema: table.datasetId,
      name: table.tableId,
      location: table.location ?? null,
    });
    return {
      provenance,
      snapshotToken,
      sql: `select * from ${dataTableSqlIdentifier(input.connectionId, table, source.kind)} limit 100`,
    };
  });
}

export async function readNotebookTableReference(
  actor: ExecutionActor,
  input: GetDataTableDetailsInput,
) {
  return (await prepareTableQuery(actor, input)).provenance;
}

function staleTable(): never {
  fail("The catalog changed. Refresh and choose the table again.", {
    statusCode: 409,
    errorCode: "catalog_generation_stale",
  });
}

export async function queryNotebookTable(
  actor: ExecutionActor,
  intent: QueryNotebookTableInput,
  wake: boolean,
) {
  const replay = await readNotebookTableQueryReplay(actor, intent);
  const capability = await evaluateCapability(
    ANALYTICS_CONTROL_IDS.queryNotebookTable,
    capabilityScopeRefSchema.parse({
      kind: "project",
      workspaceId: actor.orgId,
      projectId: intent.projectId,
    }),
  );
  if (capability.status !== "allowed")
    fail("You don’t have permission to query this table.", {
      statusCode: capability.status === "unreadable" ? 503 : 403,
      errorCode:
        capability.status === "unreadable"
          ? "catalog_unreadable"
          : "notebook_edit_denied",
    });
  if (replay) {
    await requireTableQuerySource(
      actor,
      intent.table.connectionId,
      async () => {},
    );
    if (wake) wakeNotebookRun(actor, replay.runId);
    return replay;
  }
  const { connectionId, tableId } = intent.table;
  const { provenance, snapshotToken, sql } = await prepareTableQuery(actor, {
    connectionId,
    tableId,
  });
  if (
    provenance.catalogGeneration !== intent.table.catalogGeneration ||
    provenance.authorityGeneration !== intent.table.authorityGeneration
  )
    staleTable();
  const receipt = await applyNotebookTableQuery(
    actor,
    intent,
    provenance,
    sql,
    () =>
      requireTableQuerySource(actor, connectionId, async (source) => {
        if (
          (source.generation ?? "0") !== provenance.authorityGeneration ||
          (await warehouseCatalogSnapshotToken(actor, connectionId)) !==
            snapshotToken
        )
          staleTable();
      }),
  );
  if (wake) wakeNotebookRun(actor, receipt.runId);
  return receipt;
}
