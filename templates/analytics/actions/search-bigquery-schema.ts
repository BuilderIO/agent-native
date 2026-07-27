import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getBigQueryProjectId } from "../server/lib/bigquery";
import { getAccessToken } from "../server/lib/gcloud";
import { cliBoolean } from "./schema-helpers";

interface BigQueryField {
  name: string;
  type?: string;
  mode?: string;
  description?: string;
  fields?: BigQueryField[];
}

interface DatasetListResponse {
  datasets?: Array<{
    datasetReference?: { projectId?: string; datasetId?: string };
    friendlyName?: string;
    labels?: Record<string, string>;
    location?: string;
  }>;
}

interface TableListResponse {
  tables?: Array<{
    tableReference?: {
      projectId?: string;
      datasetId?: string;
      tableId?: string;
    };
    type?: string;
    friendlyName?: string;
    labels?: Record<string, string>;
  }>;
}

interface TableMetadata {
  tableReference?: {
    projectId?: string;
    datasetId?: string;
    tableId?: string;
  };
  friendlyName?: string;
  description?: string;
  type?: string;
  location?: string;
  numRows?: string;
  numBytes?: string;
  timePartitioning?: unknown;
  clustering?: unknown;
  schema?: { fields?: BigQueryField[] };
}

const PROJECT_RE = /^[A-Za-z][A-Za-z0-9-]{4,61}[A-Za-z0-9]$/;
const ID_RE = /^[A-Za-z0-9_]+$/;

function assertIdentifier(
  label: string,
  value: string,
  pattern = ID_RE,
): string {
  const clean = value.trim().replace(/^`|`$/g, "");
  if (!pattern.test(clean)) {
    throw new Error(`${label} must be a BigQuery identifier, got "${value}"`);
  }
  return clean;
}

function parseTableRef(
  projectId: string,
  dataset: string | undefined,
  table: string,
) {
  const cleanTable = table.trim().replace(/^`|`$/g, "");
  const parts = cleanTable.split(".");

  if (parts.length === 3) {
    return {
      projectId: assertIdentifier("project", parts[0], PROJECT_RE),
      datasetId: assertIdentifier("dataset", parts[1]),
      tableId: assertIdentifier("table", parts[2]),
    };
  }

  if (parts.length === 2) {
    return {
      projectId,
      datasetId: assertIdentifier("dataset", parts[0]),
      tableId: assertIdentifier("table", parts[1]),
    };
  }

  if (parts.length === 1 && dataset) {
    return {
      projectId,
      datasetId: assertIdentifier("dataset", dataset),
      tableId: assertIdentifier("table", parts[0]),
    };
  }

  throw new Error(
    "Provide table as dataset.table or project.dataset.table, or pass both dataset and table.",
  );
}

async function bigQueryGet<T>(url: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = "";
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      detail = parsed.error?.message ?? "";
    } catch {
      // Fall through to include the raw response body below.
    }
    if (detail) {
      throw new Error(detail);
    }
    throw new Error(
      `BigQuery metadata request failed (${res.status}): ${text}`,
    );
  }

  return (await res.json()) as T;
}

function flattenFields(
  fields: BigQueryField[] | undefined,
  prefix = "",
): Array<{
  name: string;
  type?: string;
  mode?: string;
  description?: string;
}> {
  if (!fields?.length) return [];
  const columns: Array<{
    name: string;
    type?: string;
    mode?: string;
    description?: string;
  }> = [];

  for (const field of fields) {
    const name = prefix ? `${prefix}.${field.name}` : field.name;
    columns.push({
      name,
      type: field.type,
      mode: field.mode,
      description: field.description,
    });
    columns.push(...flattenFields(field.fields, name));
  }

  return columns;
}

function compactTable(meta: TableMetadata, includeColumns: boolean) {
  const ref = meta.tableReference ?? {};
  return {
    projectId: ref.projectId,
    datasetId: ref.datasetId,
    tableId: ref.tableId,
    type: meta.type,
    friendlyName: meta.friendlyName,
    description: meta.description,
    location: meta.location,
    numRows: meta.numRows ? Number(meta.numRows) : undefined,
    numBytes: meta.numBytes ? Number(meta.numBytes) : undefined,
    timePartitioning: meta.timePartitioning,
    clustering: meta.clustering,
    columns: includeColumns ? flattenFields(meta.schema?.fields) : undefined,
  };
}

function matchesSearch(meta: TableMetadata, search: string): boolean {
  const q = search.toLowerCase();
  const ref = meta.tableReference ?? {};
  const haystack = [
    ref.projectId,
    ref.datasetId,
    ref.tableId,
    meta.friendlyName,
    meta.description,
    ...flattenFields(meta.schema?.fields).flatMap((column) => [
      column.name,
      column.type,
      column.description,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

async function listDatasets(projectId: string, limit: number, search: string) {
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets`,
  );
  url.searchParams.set("maxResults", String(Math.min(limit, 1000)));
  const result = await bigQueryGet<DatasetListResponse>(url.toString());
  const q = search.toLowerCase();
  return (result.datasets ?? [])
    .map((dataset) => ({
      projectId: dataset.datasetReference?.projectId,
      datasetId: dataset.datasetReference?.datasetId,
      friendlyName: dataset.friendlyName,
      labels: dataset.labels,
      location: dataset.location,
    }))
    .filter((dataset) => {
      if (!q) return true;
      return [dataset.datasetId, dataset.friendlyName, dataset.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .slice(0, limit);
}

async function listTables(projectId: string, datasetId: string, limit: number) {
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`,
  );
  url.searchParams.set("maxResults", String(Math.min(limit, 1000)));
  const result = await bigQueryGet<TableListResponse>(url.toString());
  return (result.tables ?? []).map((table) => ({
    projectId: table.tableReference?.projectId,
    datasetId: table.tableReference?.datasetId,
    tableId: table.tableReference?.tableId,
    type: table.type,
    friendlyName: table.friendlyName,
    labels: table.labels,
  }));
}

async function getTableMetadata(
  projectId: string,
  datasetId: string,
  tableId: string,
) {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables/${tableId}`;
  return await bigQueryGet<TableMetadata>(url);
}

export default defineAction({
  description:
    "Search or describe BigQuery metadata for the configured warehouse. Use before writing SQL when the data dictionary does not already name the dataset, table, and columns. With no args, lists datasets. With dataset, lists tables. With dataset + table or a dataset.table value, returns columns for that table.",
  schema: z.object({
    dataset: z
      .string()
      .optional()
      .describe("Dataset id to list/search, e.g. analytics or product_events"),
    table: z
      .string()
      .optional()
      .describe(
        "Table id, dataset.table, or project.dataset.table to describe",
      ),
    search: z
      .string()
      .optional()
      .describe(
        "Case-insensitive search across dataset, table, and column names",
      ),
    includeColumns: cliBoolean
      .optional()
      .describe("Include column metadata when listing/searching tables"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum results to return (default 50, max 200)"),
  }),
  http: { method: "GET" },
  readOnly: true,
  toolCallable: true,
  run: async (args) => {
    const configuredProjectId = await getBigQueryProjectId();
    const limit = args.limit ?? 50;
    const search = (args.search ?? "").trim();

    if (args.table) {
      const ref = parseTableRef(configuredProjectId, args.dataset, args.table);
      const meta = await getTableMetadata(
        ref.projectId,
        ref.datasetId,
        ref.tableId,
      );
      return {
        mode: "table",
        table: compactTable(meta, true),
      };
    }

    if (!args.dataset) {
      return {
        mode: "datasets",
        projectId: configuredProjectId,
        datasets: await listDatasets(configuredProjectId, limit, search),
        nextStep:
          "Pass dataset=<datasetId> to list tables, or table=dataset.table to inspect columns.",
      };
    }

    const datasetId = assertIdentifier("dataset", args.dataset);
    const tables = await listTables(configuredProjectId, datasetId, limit);
    const includeColumns = args.includeColumns === true || !!search;

    if (!includeColumns) {
      const q = search.toLowerCase();
      return {
        mode: "tables",
        projectId: configuredProjectId,
        datasetId,
        tables: tables
          .filter((table) => {
            if (!q) return true;
            return [table.tableId, table.friendlyName, table.type]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q);
          })
          .slice(0, limit),
        nextStep:
          "Pass table=<tableId> with this dataset to inspect columns before writing SQL.",
      };
    }

    const metadata = await Promise.all(
      tables.slice(0, Math.min(tables.length, limit)).map((table) => {
        const tableId = table.tableId ?? "";
        return getTableMetadata(configuredProjectId, datasetId, tableId);
      }),
    );

    return {
      mode: search ? "table-search" : "tables-with-columns",
      projectId: configuredProjectId,
      datasetId,
      tables: metadata
        .filter((meta) => !search || matchesSearch(meta, search))
        .map((meta) => compactTable(meta, true))
        .slice(0, limit),
      note: "Use exact table and column names from this metadata. If the business meaning is unclear, save an unapproved data-dictionary entry or ask the user.",
    };
  },
});
