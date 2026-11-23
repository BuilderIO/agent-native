import { fail } from "@agent-native/core/action";
import { credentialKeyMatches } from "@agent-native/core/workspace-connections";

import {
  dataTableDetailsSchema,
  getDataTableDetailsSchema,
  type DataTableDetails,
  type GetDataTableDetailsInput,
} from "../../app/lib/model/data-table-contracts.js";
import { sampleTable } from "../../app/lib/model/sample-data.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import { withOrganizationBigQueryRequestContext } from "../lib/org-bigquery-credentials.js";
import { getAnalytics2ProviderApiRuntime } from "../lib/provider-api.js";
import {
  currentWorkspaceCapabilities,
  requireCurrentWorkspace,
} from "../lib/workspace-access.js";
import { isBuiltinSampleConnection } from "./data-connection-dto.js";
import { resolveResourceAiUsage } from "./data-connection-policy.js";
import { runtimeForConnection } from "./data-connection-provider.js";
import {
  connectionIncludedForAgent,
  configuredDatasetNames,
  readBrowsableDataConnection,
} from "./data-connections.js";
import {
  readDataResourceMetadata,
  readResourcePolicyRevision,
} from "./data-resource-metadata.js";
import { requestTableDetails } from "./data-table-provider.js";
import { SAMPLE_PROJECT_ID, SAMPLE_SCHEMA_ID } from "./sample-catalog.js";

type ParsedTableId = {
  projectId: string;
  datasetId: string;
  tableId: string;
  schemaResourceId: string;
  tableResourceId: string;
  postgresOid?: string;
};

const TABLE_ID_PATTERN = /^table:([^:]+):([^:]+):([^:]+)$/;
const POSTGRES_TABLE_ID_PATTERN =
  /^pg-table:([^:]+):([^:]+):([^:]+):([1-9][0-9]*)$/;

/**
 * The browser's table id is an opaque, already-encoded path. Decode each
 * segment once, refuse anything that could become a different provider path,
 * and require the id to be in its canonical encoded form so metadata keys and
 * provider requests always describe the same table.
 */
function parseTableId(raw: string): ParsedTableId {
  const postgres = POSTGRES_TABLE_ID_PATTERN.exec(raw);
  const match = postgres ?? TABLE_ID_PATTERN.exec(raw);
  if (!match)
    fail("The selected table is invalid.", {
      errorCode: "data_table_id_invalid",
      statusCode: 422,
    });
  const decoded = match.slice(1, 4).map((segment) => {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      fail("The selected table is invalid.", {
        errorCode: "data_table_id_invalid",
        statusCode: 422,
      });
    }
    if (
      value === "" ||
      value === "." ||
      value === ".." ||
      // Encoded separators/control characters would be a path or header
      // injection rather than a provider identifier.
      (postgres ? value.includes("\0") : /[/\\\u0000-\u001f\u007f]/.test(value))
    )
      fail("The selected table is invalid.", {
        errorCode: "data_table_id_invalid",
        statusCode: 422,
      });
    return value;
  });
  const [projectId, datasetId, tableId] = decoded;
  if (!projectId || !datasetId || !tableId)
    fail("The selected table is invalid.", {
      errorCode: "data_table_id_invalid",
      statusCode: 422,
    });
  const schemaResourceId = postgresSchemaId(projectId, datasetId);
  const tableResourceId = postgres
    ? postgresTableId(projectId, datasetId, tableId, postgres[4] ?? "")
    : `table:${encodeURIComponent(projectId)}:${encodeURIComponent(datasetId)}:${encodeURIComponent(tableId)}`;
  if (tableResourceId !== raw)
    fail("The selected table is invalid.", {
      errorCode: "data_table_id_invalid",
      statusCode: 422,
    });
  return {
    projectId,
    datasetId,
    tableId,
    schemaResourceId,
    tableResourceId,
    ...(postgres?.[4] ? { postgresOid: postgres[4] } : {}),
  };
}

export function postgresSchemaId(database: string, schema: string) {
  return `schema:${encodeURIComponent(database)}:${encodeURIComponent(schema)}`;
}

export function postgresTableId(
  database: string,
  schema: string,
  name: string,
  oid: string,
) {
  return `pg-table:${encodeURIComponent(database)}:${encodeURIComponent(schema)}:${encodeURIComponent(name)}:${oid}`;
}

/**
 * The credential reference is chosen exactly as the existing connection model
 * chooses it: the explicitly saved reference only when it still exists, then
 * the one reference that matches the BigQuery service-account key kind. This
 * never selects an unrelated first key and never relaxes a workspace ACL.
 */
function credentialKeyForConnection(connection: {
  config: Record<string, unknown>;
  credentialRefs: readonly { key: string }[];
}): string | undefined {
  const saved = connection.config.serviceAccountCredentialKey;
  if (
    typeof saved === "string" &&
    connection.credentialRefs.some((ref) => ref.key === saved)
  )
    return saved;
  return connection.credentialRefs.find((ref) =>
    credentialKeyMatches(
      "bigquery",
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      ref.key,
    ),
  )?.key;
}

function allowedProjects(connection: {
  provider: string;
  config: Record<string, unknown>;
  accountId: string | null;
}): Set<string> {
  if (connection.provider === "postgres") {
    const database = connection.config.database;
    return new Set(typeof database === "string" && database ? [database] : []);
  }
  const primary =
    typeof connection.config.projectId === "string"
      ? connection.config.projectId
      : connection.accountId;
  const extra =
    typeof connection.config.additionalProjectIds === "string"
      ? connection.config.additionalProjectIds
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  return new Set(
    [primary, ...extra].filter(
      (value): value is string => typeof value === "string" && value !== "",
    ),
  );
}

/**
 * For agent callers the table inherits the connection's effective AI usage,
 * then a schema override, then its own table override. An excluded ancestor
 * always wins. A policy read that cannot complete is an explicit pending
 * failure, never an implicit include or exclude.
 */
async function assertTableIncludedForAgent(
  current: Awaited<ReturnType<typeof requireCurrentWorkspace>>,
  connectionId: string,
  table: ParsedTableId,
): Promise<void> {
  let metadata;
  try {
    metadata = await readDataResourceMetadata(
      { ownerEmail: current.ownerEmail, orgId: current.orgId },
      connectionId,
      [
        { kind: "schema", id: table.schemaResourceId },
        { kind: "table", id: table.tableResourceId },
      ],
      { bypassCache: true },
    );
  } catch {
    fail("The table AI policy is unavailable. Please try again.", {
      errorCode: "data_table_ai_policy_pending",
      statusCode: 503,
    });
  }
  const schemaEntry = metadata.resources.find(
    (resource) =>
      resource.kind === "schema" && resource.id === table.schemaResourceId,
  );
  const tableEntry = metadata.resources.find(
    (resource) =>
      resource.kind === "table" && resource.id === table.tableResourceId,
  );
  // The connection gate above already proved this ancestor included.
  const schemaUsage = resolveResourceAiUsage(
    "included",
    schemaEntry?.aiUsage ?? null,
  );
  const tableUsage = resolveResourceAiUsage(
    schemaUsage,
    tableEntry?.aiUsage ?? null,
  );
  if (tableUsage !== "included")
    fail("This table is not included for AI.", {
      errorCode: "data_table_ai_disabled",
      statusCode: 403,
    });
}

async function requireTableWorkspace() {
  const current = await requireCurrentWorkspace();
  const capabilities = await currentWorkspaceCapabilities(current);
  if (!capabilities.allows("context-studio"))
    fail("You do not have access to the data browser.", {
      errorCode: "data_table_access_denied",
      statusCode: 403,
    });
  return current;
}

async function beginTableAccess(
  current: Awaited<ReturnType<typeof requireCurrentWorkspace>>,
  connectionId: string,
  tables: ParsedTableId[],
  caller?: string,
) {
  const connection = await readBrowsableDataConnection(connectionId);
  const builtin = isBuiltinSampleConnection(connection.id);
  if (!builtin && !["bigquery", "postgres"].includes(connection.provider))
    fail("This data connection does not support table metadata.", {
      errorCode: "data_table_provider_unsupported",
      statusCode: 422,
    });
  if (connection.status !== "connected" || connection.config.draft === true)
    fail("This data connection is not connected.", {
      errorCode: "data_connection_not_connected",
      statusCode: 409,
    });
  const forAgent = caller !== "frontend";
  const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
  const revision = forAgent
    ? await readResourcePolicyRevision(scope, connection.id, {
        bypassCache: true,
      })
    : 0;
  if (forAgent && !(await connectionIncludedForAgent(connection)))
    fail(
      "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
      {
        errorCode: "data_connection_ai_disabled",
        statusCode: 403,
      },
    );
  const projects = allowedProjects(connection);
  const primaryProject = connection.config.projectId ?? connection.accountId;
  const datasets =
    connection.provider === "bigquery" &&
    typeof connection.config.datasetNames === "string"
      ? configuredDatasetNames(connection.config)
      : [];
  for (const table of tables) {
    if (builtin) table.schemaResourceId = SAMPLE_SCHEMA_ID;
    if (
      (connection.provider === "postgres") !==
        (table.postgresOid !== undefined) ||
      (builtin
        ? table.projectId !== SAMPLE_PROJECT_ID || table.datasetId !== "PUBLIC"
        : !projects.has(table.projectId)) ||
      (table.projectId === primaryProject &&
        datasets.length > 0 &&
        !datasets.includes(table.datasetId))
    )
      fail("The selected table is not in this data connection.", {
        errorCode: "data_table_project_denied",
        statusCode: 403,
      });
    if (forAgent)
      await assertTableIncludedForAgent(current, connection.id, table);
  }
  return { connection, builtin, forAgent, scope, revision, tables };
}

async function revalidateTableAccess(
  access: Awaited<ReturnType<typeof beginTableAccess>>,
) {
  if (!access.forAgent) return;
  const latest = await readBrowsableDataConnection(access.connection.id);
  if (!(await connectionIncludedForAgent(latest, { bypassCache: true })))
    fail(
      "This data connection is not included for AI. Turn on Included for AI for it in the data browser, then try again.",
      {
        errorCode: "data_connection_ai_disabled",
        statusCode: 403,
      },
    );
  if (
    (await readResourcePolicyRevision(access.scope, access.connection.id, {
      bypassCache: true,
    })) !== access.revision
  )
    fail("The data resource policy changed while the table was loading.", {
      errorCode: "data_resource_policy_changed",
      statusCode: 409,
    });
  const projects = allowedProjects(latest);
  if (
    !access.builtin &&
    access.tables.some((table) => !projects.has(table.projectId))
  )
    fail("The selected table is not in this data connection.", {
      errorCode: "data_table_project_denied",
      statusCode: 403,
    });
}

/**
 * Read bounded metadata for one table on one granted BigQuery connection.
 *
 * Frontend callers keep the existing explorer grant and may read a table whose
 * AI policy excludes it. Every other caller is gated by the canonical
 * connection AI helper before any resource-policy read, and by the schema/table
 * ancestry before the provider request. No caller-supplied agent flag exists.
 */
export async function getDataTableDetails(
  input: GetDataTableDetailsInput,
  caller?: string,
): Promise<DataTableDetails> {
  const parsed = getDataTableDetailsSchema.safeParse(input);
  if (!parsed.success)
    fail("The table metadata request is invalid.", {
      errorCode: "data_table_request_invalid",
      statusCode: 422,
    });

  const current = await requireTableWorkspace();
  const table = parseTableId(parsed.data.tableId);
  const access = await beginTableAccess(
    current,
    parsed.data.connectionId,
    [table],
    caller,
  );
  const { connection, builtin } = access;

  if (builtin) {
    const sample = sampleTable(table.tableId);
    if (!sample)
      fail("The selected table was not found.", {
        errorCode: "data_table_not_found",
        statusCode: 404,
      });
    return dataTableDetailsSchema.parse({
      connectionId: connection.id,
      table: {
        projectId: SAMPLE_PROJECT_ID,
        datasetId: "PUBLIC",
        tableId: sample.name,
        name: sample.name,
        type: "TABLE",
        description: null,
        numRows: String(sample.rows.length),
        numBytes: null,
        lastModifiedTime: null,
        columnCount: sample.columns.length,
        columns: sample.columns.map((column) => ({
          name: column.name,
          type: column.type,
          mode: null,
          description: column.description ?? null,
          fields: [],
        })),
      },
    });
  }

  if (connection.provider === "postgres") {
    const { withWarehouseSource } =
      await import("../execution/warehouse-connector.js");
    return withWarehouseSource(
      connection.id,
      { ...access.scope, caller: caller ?? "unknown" },
      async (source) => {
        if (source.kind !== "postgres")
          fail("The table connection changed.", {
            errorCode: "data_table_project_denied",
            statusCode: 403,
          });
        const catalog = await source.connector.catalog({
          schema: table.datasetId,
          table: table.tableId,
        });
        const matched = catalog.tables.find(
          ({ oid }) => oid === table.postgresOid,
        );
        if (!matched)
          fail("The selected table was not found.", {
            errorCode: "data_table_not_found",
            statusCode: 404,
          });
        await revalidateTableAccess(access);
        return dataTableDetailsSchema.parse({
          connectionId: connection.id,
          table: {
            projectId: table.projectId,
            datasetId: matched.schema,
            tableId: matched.name,
            name: matched.name,
            type: "TABLE",
            description: matched.description,
            providerRevision: matched.oid,
            numRows: null,
            numBytes: null,
            lastModifiedTime: null,
            columnCount: catalog.columns.length,
            columns: catalog.columns.map((column) => ({
              name: column.name,
              type: column.type,
              mode: column.nullable ? "NULLABLE" : "REQUIRED",
              description: column.description,
              fields: [],
            })),
          },
        });
      },
    );
  }

  if (connection.id === ORGANIZATION_BIGQUERY_SOURCE_ID) {
    const metadata = await withOrganizationBigQueryRequestContext(
      { orgId: current.orgId, userEmail: current.ownerEmail },
      () => requestTableDetails(getAnalytics2ProviderApiRuntime(), table),
    );
    await revalidateTableAccess(access);
    return dataTableDetailsSchema.parse({
      connectionId: connection.id,
      table: metadata,
    });
  }

  const credentialKey = credentialKeyForConnection(connection);
  if (!credentialKey)
    fail("This data connection has no credentials.", {
      errorCode: "data_connection_credentials_missing",
      statusCode: 409,
    });

  const metadata = await requestTableDetails(
    await runtimeForConnection(connection.id, credentialKey, {
      driveAccess: connection.config.driveAccess === true,
    }),
    table,
  );
  await revalidateTableAccess(access);
  return dataTableDetailsSchema.parse({
    connectionId: connection.id,
    table: metadata,
  });
}

/** Revalidate saved table references without fetching provider metadata for each row. */
export async function authorizeFavoriteTables(
  refs: readonly GetDataTableDetailsInput[],
  caller?: string,
  options?: { allowMissingSample?: boolean },
) {
  const current = await requireTableWorkspace();
  const groups = new Map<
    string,
    Array<{ index: number; table: ParsedTableId }>
  >();
  refs.forEach((ref, index) => {
    const group = groups.get(ref.connectionId) ?? [];
    group.push({ index, table: parseTableId(ref.tableId) });
    groups.set(ref.connectionId, group);
  });
  const names: string[] = new Array(refs.length);
  for (const [connectionId, group] of groups) {
    const access = await beginTableAccess(
      current,
      connectionId,
      group.map(({ table }) => table),
      caller,
    );
    for (const { index, table } of group) {
      if (
        access.builtin &&
        !options?.allowMissingSample &&
        !sampleTable(table.tableId)
      )
        fail("The selected table was not found.", {
          errorCode: "data_table_not_found",
          statusCode: 404,
        });
      names[index] = table.tableId;
    }
    await revalidateTableAccess(access);
  }
  return names;
}
