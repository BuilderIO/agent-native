import { Buffer } from "node:buffer";

import { defineAction, fail } from "@agent-native/core/action";
import { resolveCredentialDetailed } from "@agent-native/core/credentials";
import {
  getCredentialContext,
  getRequestContext,
  runWithRequestContext,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  ORGANIZATION_SOURCE_ONLY_NOTE,
  rerouteMissingOrganizationSource,
} from "../server/lib/connection-routing.js";
import { requireOrganizationBigQueryCredentials } from "../server/lib/org-bigquery-credentials.js";
import { getAnalytics2ProviderApiRuntime } from "../server/lib/provider-api.js";
import {
  schemaRefreshFailureState,
  schemaRefreshStateForDiscovery,
} from "../server/lib/schema-refresh-lifecycle.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";
import {
  requireBigQueryModelCurator,
  requireSemanticOrg,
} from "./_semantic-helpers.js";

const MAX_COLUMNS = 128;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const MAX_ACTION_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const TABLE_IDENTIFIER = /^[-A-Za-z0-9_$ ]{1,1024}$/;
const DATASET_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;
const PROJECT_IDENTIFIER = /^[A-Za-z0-9-]{1,128}$/;
const QUALIFIED_TABLE_REFERENCE =
  /^(?:[A-Za-z0-9-]{1,128}\.[A-Za-z_][A-Za-z0-9_]{0,1023}\.[-A-Za-z0-9_$ ]{1,1024}|`[A-Za-z0-9-]{1,128}\.[A-Za-z_][A-Za-z0-9_]{0,1023}\.[-A-Za-z0-9_$ ]{1,1024}`)$/;
const LOCATION_IDENTIFIER = /^(?:US|EU|[a-z][a-z0-9-]*[a-z0-9])$/;

type BigQueryColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  ordinalPosition: number;
  description: string | null;
  descriptionTruncated: boolean;
};

type QualifiedTableReference = {
  projectId: string;
  datasetId: string;
  tableName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseQualifiedTableReference(
  value: string,
): QualifiedTableReference | null {
  const trimmed = value.trim();
  const quoted = trimmed.startsWith("`") && trimmed.endsWith("`");
  if (!quoted && trimmed.includes("`")) return null;
  const reference = quoted ? trimmed.slice(1, -1) : trimmed;
  const projectBoundary = reference.indexOf(".");
  const datasetBoundary = reference.indexOf(".", projectBoundary + 1);
  if (projectBoundary <= 0 || datasetBoundary <= projectBoundary + 1) {
    return null;
  }

  const parsed = {
    projectId: reference.slice(0, projectBoundary),
    datasetId: reference.slice(projectBoundary + 1, datasetBoundary),
    tableName: reference.slice(datasetBoundary + 1),
  };
  if (
    !PROJECT_IDENTIFIER.test(parsed.projectId) ||
    !DATASET_IDENTIFIER.test(parsed.datasetId) ||
    !TABLE_IDENTIFIER.test(parsed.tableName)
  ) {
    return null;
  }
  return parsed;
}

function parseDatasetLocation(
  raw: unknown,
  projectId: string,
  datasetId: string,
): string {
  if (!isRecord(raw) || !isRecord(raw.response)) {
    return metadataFailure(
      "BigQuery returned unreadable dataset location metadata.",
      "bigquery_dataset_location_unreadable",
      502,
    );
  }

  const response = raw.response;
  if (typeof response.truncated !== "boolean") {
    return metadataFailure(
      "BigQuery omitted the dataset location truncation status.",
      "bigquery_dataset_location_truncation_status_unreadable",
      502,
    );
  }
  if (response.truncated === true) {
    return metadataFailure(
      "BigQuery returned truncated dataset location metadata. Retry discovery.",
      "bigquery_dataset_location_truncated",
      502,
    );
  }
  if (response.ok !== true) {
    const status =
      typeof response.status === "number" &&
      Number.isInteger(response.status) &&
      response.status >= 100 &&
      response.status <= 599
        ? response.status
        : undefined;
    if (status === 401 || status === 403) {
      return metadataFailure(
        "BigQuery denied access to dataset location metadata.",
        "bigquery_dataset_location_access_denied",
        403,
      );
    }
    if (status === 404) {
      return metadataFailure(
        "BigQuery could not find the selected dataset in the organization project.",
        "bigquery_dataset_not_found",
        404,
      );
    }
    if (status === 429) {
      return metadataFailure(
        "BigQuery rate-limited dataset location discovery.",
        "bigquery_dataset_location_rate_limited",
        429,
      );
    }
    if (status === 408 || status === 504) {
      return metadataFailure(
        "BigQuery dataset location discovery timed out.",
        "bigquery_dataset_location_timeout",
        504,
      );
    }
    return metadataFailure(
      "BigQuery could not return dataset location metadata.",
      "bigquery_dataset_location_provider_error",
      502,
    );
  }

  const result = response.json;
  const datasetReference = isRecord(result) ? result.datasetReference : null;
  const location = isRecord(result) ? result.location : null;
  if (
    !isRecord(datasetReference) ||
    datasetReference.projectId !== projectId ||
    datasetReference.datasetId !== datasetId ||
    typeof location !== "string" ||
    !LOCATION_IDENTIFIER.test(location)
  ) {
    return metadataFailure(
      "BigQuery returned missing or inconsistent dataset location metadata.",
      "bigquery_dataset_location_malformed",
      502,
    );
  }

  return location === "US" || location === "EU"
    ? location
    : location.toLowerCase();
}

function metadataFailure(
  message: string,
  errorCode: string,
  statusCode: number,
): never {
  fail(message, {
    errorCode,
    statusCode,
    details: {
      schemaRefreshLifecycle: schemaRefreshFailureState(
        ORGANIZATION_BIGQUERY_SOURCE_ID,
        errorCode,
      ),
    },
  });
}

function fieldDataType(field: Record<string, unknown>, depth = 0): string {
  const rawType = field.type;
  if (typeof rawType !== "string") {
    return metadataFailure(
      "BigQuery returned a schema field without a type.",
      "bigquery_schema_malformed",
      502,
    );
  }
  const typeAliases: Record<string, string> = {
    STRING: "STRING",
    BYTES: "BYTES",
    INTEGER: "INT64",
    INT64: "INT64",
    FLOAT: "FLOAT64",
    FLOAT64: "FLOAT64",
    NUMERIC: "NUMERIC",
    BIGNUMERIC: "BIGNUMERIC",
    BOOLEAN: "BOOL",
    BOOL: "BOOL",
    TIMESTAMP: "TIMESTAMP",
    DATE: "DATE",
    TIME: "TIME",
    DATETIME: "DATETIME",
    GEOGRAPHY: "GEOGRAPHY",
    JSON: "JSON",
    INTERVAL: "INTERVAL",
    RECORD: "STRUCT",
    STRUCT: "STRUCT",
  };
  const type = rawType.toUpperCase();
  let normalized = typeAliases[type];
  if (type === "RANGE") {
    const elementType = isRecord(field.rangeElementType)
      ? field.rangeElementType.type
      : null;
    if (
      elementType !== "DATE" &&
      elementType !== "DATETIME" &&
      elementType !== "TIMESTAMP"
    ) {
      return metadataFailure(
        "BigQuery returned an unsupported range field type.",
        "bigquery_schema_malformed",
        502,
      );
    }
    normalized = `RANGE<${elementType}>`;
  }
  if (!normalized) {
    return metadataFailure(
      "BigQuery returned an unsupported schema field type.",
      "bigquery_schema_malformed",
      502,
    );
  }

  if (normalized === "STRUCT") {
    const fields = field.fields;
    if (!Array.isArray(fields) || fields.length === 0 || depth >= 8) {
      return metadataFailure(
        "BigQuery returned an unreadable nested schema.",
        "bigquery_schema_malformed",
        502,
      );
    }
    const nested = fields.map((rawChild) => {
      if (!isRecord(rawChild) || typeof rawChild.name !== "string") {
        return metadataFailure(
          "BigQuery returned an unreadable nested schema field.",
          "bigquery_schema_malformed",
          502,
        );
      }
      const name = rawChild.name;
      if (!name || Buffer.byteLength(name, "utf8") > 1024) {
        return metadataFailure(
          "BigQuery returned an invalid nested schema field name.",
          "bigquery_schema_malformed",
          502,
        );
      }
      const escapedName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        ? name
        : `\`${name.replaceAll("`", "``")}\``;
      const childType = fieldDataType(rawChild, depth + 1);
      return `${escapedName} ${childType}`;
    });
    normalized = `STRUCT<${nested.join(", ")}>`;
  }

  const mode = field.mode === undefined ? "NULLABLE" : field.mode;
  if (mode !== "NULLABLE" && mode !== "REQUIRED" && mode !== "REPEATED") {
    return metadataFailure(
      "BigQuery returned an invalid schema field mode.",
      "bigquery_schema_malformed",
      502,
    );
  }
  const dataType = mode === "REPEATED" ? `ARRAY<${normalized}>` : normalized;
  if (Buffer.byteLength(dataType, "utf8") > 1024) {
    return metadataFailure(
      "BigQuery returned schema type metadata outside the discovery limit.",
      "bigquery_schema_malformed",
      502,
    );
  }
  return dataType;
}

function parseTableSchema(
  raw: unknown,
  projectId: string,
  datasetId: string,
  tableName: string,
  columnOffset: number | undefined,
): {
  columns: BigQueryColumn[];
  totalColumns: number;
  schemaVersion: string | null;
  partitionColumn: string | null;
  clusteringColumns: string[];
} {
  if (!isRecord(raw) || !isRecord(raw.response)) {
    return metadataFailure(
      "BigQuery returned unreadable table metadata.",
      "bigquery_schema_unreadable",
      502,
    );
  }

  const response = raw.response;
  if (typeof response.truncated !== "boolean") {
    return metadataFailure(
      "BigQuery omitted the table metadata truncation status.",
      "bigquery_schema_truncation_status_unreadable",
      502,
    );
  }
  if (response.truncated === true) {
    return metadataFailure(
      "BigQuery returned truncated table metadata. Retry the discovery.",
      "bigquery_schema_response_truncated",
      502,
    );
  }
  if (response.ok !== true) {
    const status =
      typeof response.status === "number" &&
      Number.isInteger(response.status) &&
      response.status >= 100 &&
      response.status <= 599
        ? response.status
        : undefined;
    if (status === 401 || status === 403) {
      return metadataFailure(
        "BigQuery denied access to table metadata.",
        "bigquery_schema_access_denied",
        403,
      );
    }
    if (status === 404) {
      return metadataFailure(
        "BigQuery could not find the selected table in this dataset.",
        "bigquery_table_schema_not_found",
        404,
      );
    }
    if (status === 429) {
      return metadataFailure(
        "BigQuery rate-limited table metadata discovery.",
        "bigquery_schema_rate_limited",
        429,
      );
    }
    if (status === 408 || status === 504) {
      return metadataFailure(
        "BigQuery table metadata discovery timed out.",
        "bigquery_schema_timeout",
        504,
      );
    }
    return metadataFailure(
      "BigQuery could not return table metadata.",
      "bigquery_schema_provider_error",
      502,
    );
  }

  const result = response.json;
  if (!isRecord(result)) {
    return metadataFailure(
      "BigQuery returned an unreadable table metadata object.",
      "bigquery_schema_malformed",
      502,
    );
  }
  const metadataReference = result.tableReference;
  if (
    !isRecord(metadataReference) ||
    metadataReference.projectId !== projectId ||
    metadataReference.datasetId !== datasetId ||
    metadataReference.tableId !== tableName
  ) {
    return metadataFailure(
      "BigQuery returned missing or inconsistent table metadata.",
      "bigquery_schema_malformed",
      502,
    );
  }
  const schema = result.schema;
  const fields = isRecord(schema) ? schema.fields : null;
  if (!Array.isArray(fields)) {
    return metadataFailure(
      "BigQuery returned no readable table columns.",
      "bigquery_schema_malformed",
      502,
    );
  }

  if (columnOffset === undefined && fields.length > MAX_COLUMNS) {
    return metadataFailure(
      "This table has more columns than one schema discovery can return. Retry with columnOffset 0 to page through it.",
      "bigquery_schema_column_limit_exceeded",
      409,
    );
  }

  const columns: BigQueryColumn[] = [];
  const names = new Set<string>();
  for (const [index, rawField] of fields.entries()) {
    if (!isRecord(rawField)) {
      return metadataFailure(
        "BigQuery returned a malformed schema field.",
        "bigquery_schema_malformed",
        502,
      );
    }
    const name = rawField.name;
    const mode = rawField.mode === undefined ? "NULLABLE" : rawField.mode;
    if (
      typeof name !== "string" ||
      !name ||
      Buffer.byteLength(name, "utf8") > 1024 ||
      (mode !== "NULLABLE" && mode !== "REQUIRED" && mode !== "REPEATED") ||
      names.has(name)
    ) {
      return metadataFailure(
        "BigQuery returned unsupported or inconsistent schema metadata.",
        "bigquery_schema_malformed",
        502,
      );
    }
    names.add(name);
    if (
      rawField.description !== undefined &&
      typeof rawField.description !== "string"
    ) {
      return metadataFailure(
        "BigQuery returned an invalid field description.",
        "bigquery_schema_malformed",
        502,
      );
    }
    const description = rawField.description as string | undefined;
    const dataType = fieldDataType(rawField);
    if (
      columnOffset === undefined ||
      (index >= columnOffset && index < columnOffset + MAX_COLUMNS)
    ) {
      columns.push({
        name,
        dataType,
        nullable: mode === "NULLABLE",
        ordinalPosition: index + 1,
        description: description?.slice(0, 240) ?? null,
        descriptionTruncated: (description?.length ?? 0) > 240,
      });
    }
  }

  const timePartitioning = result.timePartitioning;
  const rangePartitioning = result.rangePartitioning;
  const clustering = result.clustering;
  if (
    (timePartitioning !== undefined && !isRecord(timePartitioning)) ||
    (rangePartitioning !== undefined && !isRecord(rangePartitioning)) ||
    (clustering !== undefined &&
      (!isRecord(clustering) || !Array.isArray(clustering.fields))) ||
    (timePartitioning !== undefined && rangePartitioning !== undefined)
  ) {
    return metadataFailure(
      "BigQuery returned malformed partition or clustering metadata.",
      "bigquery_schema_malformed",
      502,
    );
  }
  const partition = isRecord(timePartitioning)
    ? timePartitioning
    : isRecord(rangePartitioning)
      ? rangePartitioning
      : null;
  const partitionColumn = partition
    ? (partition.field ??
      (partition === timePartitioning ? "_PARTITIONTIME" : null))
    : null;
  const clusteringColumns = isRecord(clustering) ? clustering.fields : [];
  if (
    (partitionColumn !== null &&
      (typeof partitionColumn !== "string" ||
        (partitionColumn !== "_PARTITIONTIME" &&
          !names.has(partitionColumn)))) ||
    !Array.isArray(clusteringColumns) ||
    clusteringColumns.length > 4 ||
    clusteringColumns.some(
      (field) => typeof field !== "string" || !names.has(field),
    ) ||
    new Set(clusteringColumns).size !== clusteringColumns.length
  ) {
    return metadataFailure(
      "BigQuery returned malformed partition or clustering metadata.",
      "bigquery_schema_malformed",
      502,
    );
  }
  return {
    columns,
    totalColumns: fields.length,
    schemaVersion:
      typeof result.etag === "string" &&
      result.etag.trim().length > 0 &&
      result.etag.length <= 1024
        ? result.etag
        : null,
    partitionColumn,
    clusteringColumns: clusteringColumns as string[],
  };
}

function exactOrganizationCredentialValue(
  credential: Awaited<ReturnType<typeof resolveCredentialDetailed>>,
  orgId: string,
): string | null {
  if (
    !credential ||
    credential.scope !== "org" ||
    credential.scopeId !== orgId ||
    !credential.value.trim()
  ) {
    return null;
  }
  return credential.value.trim();
}

export default defineAction({
  description: `Return bounded column names, data types and descriptions for one project-qualified BigQuery table using organization credentials. ${ORGANIZATION_SOURCE_ONLY_NOTE} A descriptionTruncated flag means its full meaning was not returned. Use columnOffset to page wide schemas; each partial page is incomplete and pages must have the same non-null schemaVersion before combining. Dataset location and table schema are read concurrently from BigQuery metadata; no table rows are read. Requires an active workspace admin or owner.`,
  schema: z.object({
    tableReference: z
      .string()
      .trim()
      .min(1)
      .max(2200)
      .regex(QUALIFIED_TABLE_REFERENCE)
      .describe(
        "Exact project.dataset.table reference returned by BigQuery table discovery; a backtick-quoted reference is also accepted. The project must match the active organization BigQuery project.",
      ),
    columnOffset: z
      .number()
      .int()
      .min(0)
      .max(100000)
      .optional()
      .describe(
        "Zero-based column offset for an explicit page of at most 128 columns. Compare non-null schemaVersion across pages before treating a combined search as complete.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  planMode: { effect: "read" },
  audit: {
    recordInputs: false,
    target: () => ({
      type: "provider-api",
      id: "bigquery",
      visibility: "private",
    }),
    summary: () => "Discovered bounded BigQuery table schema metadata.",
  },
  run: async ({ tableReference, columnOffset }) => {
    const selectedTable = parseQualifiedTableReference(tableReference);
    if (!selectedTable) {
      fail("Provide one valid project-qualified BigQuery table reference.", {
        errorCode: "bigquery_table_reference_invalid",
        statusCode: 400,
      });
    }

    const orgId = await requireSemanticOrg();
    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    const currentCredentialContext = getCredentialContext();
    const currentRequestContext = getRequestContext();
    if (
      !userEmail ||
      !currentCredentialContext ||
      !currentRequestContext ||
      currentCredentialContext.userEmail.trim().toLowerCase() !== userEmail ||
      currentCredentialContext.orgId !== orgId ||
      currentRequestContext.userEmail?.trim().toLowerCase() !== userEmail ||
      currentRequestContext.orgId !== orgId
    ) {
      fail("An authenticated member of the active workspace is required.", {
        errorCode: "workspace_membership_required",
        statusCode: 403,
      });
    }

    await requireBigQueryModelCurator({ orgId, userEmail });
    await requireOrganizationBigQueryCredentials({ orgId, userEmail }).catch(
      rerouteMissingOrganizationSource,
    );

    let projectCredential:
      | Awaited<ReturnType<typeof resolveCredentialDetailed>>
      | undefined;
    try {
      projectCredential = await resolveCredentialDetailed(
        "BIGQUERY_PROJECT_ID",
        { userEmail, orgId, credentialScope: "org" },
      );
    } catch {
      fail(
        "Organization BigQuery settings could not be checked. Retry shortly.",
        { errorCode: "bigquery_credentials_unavailable", statusCode: 503 },
      );
    }
    const projectId = exactOrganizationCredentialValue(
      projectCredential,
      orgId,
    );
    if (!projectId || !/^[A-Za-z0-9-]{1,128}$/.test(projectId)) {
      fail("The active organization has no valid BigQuery project setting.", {
        errorCode: "bigquery_project_id_invalid",
        statusCode: 409,
      });
    }
    if (selectedTable.projectId !== projectId) {
      fail(
        "The selected table must belong to the active organization's BigQuery project.",
        { errorCode: "bigquery_table_project_mismatch", statusCode: 409 },
      );
    }

    const requestContext = {
      ...currentRequestContext,
      userEmail,
      orgId,
      credentialScope: "org" as const,
    };
    const runtime = getAnalytics2ProviderApiRuntime();
    const requestMetadata = (
      request: Parameters<typeof runtime.executeRequest>[0],
      kind: "dataset" | "table",
    ) =>
      Promise.resolve(
        runWithRequestContext(requestContext, () =>
          runtime.executeRequest(request),
        ),
      ).catch((error: unknown) => {
        const record = isRecord(error) ? error : null;
        const timeout =
          record?.errorCode === "provider_api_timeout" ||
          record?.name === "AbortError";
        const isDataset = kind === "dataset";
        fail(
          timeout
            ? isDataset
              ? "BigQuery dataset location discovery timed out."
              : "BigQuery table metadata discovery timed out."
            : isDataset
              ? "BigQuery could not complete dataset location discovery."
              : "BigQuery could not complete table metadata discovery.",
          {
            errorCode: timeout
              ? isDataset
                ? "bigquery_dataset_location_timeout"
                : "bigquery_schema_timeout"
              : isDataset
                ? "bigquery_dataset_location_request_failed"
                : "bigquery_schema_request_failed",
            statusCode: timeout ? 504 : 502,
            details: {
              schemaRefreshLifecycle: schemaRefreshFailureState(
                ORGANIZATION_BIGQUERY_SOURCE_ID,
                timeout
                  ? "bigquery_schema_timeout"
                  : "bigquery_schema_request_failed",
              ),
            },
          },
        );
      });

    const [datasetMetadata, tableMetadata] = await Promise.all([
      requestMetadata(
        {
          provider: "bigquery",
          method: "GET",
          path: `/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(selectedTable.datasetId)}`,
          maxBytes: MAX_PROVIDER_RESPONSE_BYTES,
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        "dataset",
      ),
      requestMetadata(
        {
          provider: "bigquery",
          method: "GET",
          path: `/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(selectedTable.datasetId)}/tables/${encodeURIComponent(selectedTable.tableName)}`,
          query: { view: "BASIC" },
          maxBytes: MAX_PROVIDER_RESPONSE_BYTES,
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        "table",
      ),
    ]);
    const location = parseDatasetLocation(
      datasetMetadata,
      projectId,
      selectedTable.datasetId,
    );
    const { datasetId, tableName } = selectedTable;
    const result = parseTableSchema(
      tableMetadata,
      projectId,
      datasetId,
      tableName,
      columnOffset,
    );
    const canonicalTableReference = /^[A-Za-z_][A-Za-z0-9_$]{0,1023}$/.test(
      tableName,
    )
      ? `${projectId}.${datasetId}.${tableName}`
      : `\`${projectId}.${datasetId}.${tableName}\``;
    const offset = columnOffset ?? 0;
    const complete =
      offset === 0 && result.columns.length === result.totalColumns;
    const nextColumnOffset =
      offset + result.columns.length < result.totalColumns
        ? offset + result.columns.length
        : null;
    const output = {
      status: complete ? ("complete" as const) : ("incomplete" as const),
      complete,
      truncated: !complete,
      schemaRefreshLifecycle: complete
        ? schemaRefreshStateForDiscovery(
            ORGANIZATION_BIGQUERY_SOURCE_ID,
            canonicalTableReference,
            result.totalColumns,
          )
        : {
            status: "unverified" as const,
            connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
            tableReference: canonicalTableReference,
          },
      columnOffset: offset,
      nextColumnOffset,
      schemaVersion: result.schemaVersion,
      projectId,
      datasetId,
      tableName,
      tableReference: canonicalTableReference,
      location,
      totalColumns: result.totalColumns,
      columns: result.columns,
      partitionColumn: result.partitionColumn,
      clusteringColumns: result.clusteringColumns,
    };
    if (
      Buffer.byteLength(JSON.stringify(output), "utf8") >
      MAX_ACTION_RESPONSE_BYTES
    ) {
      fail("The table schema exceeds the response-size limit.", {
        errorCode: "bigquery_schema_response_too_large",
        statusCode: 502,
        details: {
          schemaRefreshLifecycle: schemaRefreshFailureState(
            ORGANIZATION_BIGQUERY_SOURCE_ID,
            "bigquery_schema_response_too_large",
          ),
        },
      });
    }
    return output;
  },
});
