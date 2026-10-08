import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  bigQueryGet,
  flattenBigQueryFields,
  getBigQueryProjectId,
  getBigQueryTableMetadata,
  listBigQueryTables,
  type BigQueryTableMetadata,
  type BigQueryTableSummary,
} from "../server/lib/bigquery";
import { cliBoolean } from "./schema-helpers";

interface DatasetListResponse {
  datasets?: Array<{
    datasetReference?: { projectId?: string; datasetId?: string };
    friendlyName?: string;
    labels?: Record<string, string>;
    location?: string;
  }>;
}

const PROJECT_RE = /^[A-Za-z][A-Za-z0-9-]{4,61}[A-Za-z0-9]$/;
const ID_RE = /^[A-Za-z0-9_]+$/;
const GLOBAL_SEARCH_DATASET_LIMIT = 100;
const GLOBAL_SEARCH_TABLE_LIMIT = 250;
const GLOBAL_SEARCH_METADATA_BATCH_SIZE = 20;

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

function compactTable(meta: BigQueryTableMetadata, includeColumns: boolean) {
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
    columns: includeColumns
      ? flattenBigQueryFields(meta.schema?.fields)
      : undefined,
  };
}

function matchesSearch(meta: BigQueryTableMetadata, search: string): boolean {
  const terms = search
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return true;
  const ref = meta.tableReference ?? {};
  const haystack = [
    ref.projectId,
    ref.datasetId,
    ref.tableId,
    meta.friendlyName,
    meta.description,
    ...flattenBigQueryFields(meta.schema?.fields).flatMap((column) => [
      column.name,
      column.type,
      column.description,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[._-]+/g, " ");
  return terms.every((term) => haystack.includes(term));
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

async function searchAcrossDatasets(
  projectId: string,
  search: string,
  limit: number,
) {
  const datasets = await listDatasets(
    projectId,
    GLOBAL_SEARCH_DATASET_LIMIT + 1,
    "",
  );
  const scannableDatasets = datasets.slice(0, GLOBAL_SEARCH_DATASET_LIMIT);
  const tables: BigQueryTableSummary[] = [];
  const datasetCount = scannableDatasets.filter(
    (dataset) => typeof dataset.datasetId === "string" && dataset.datasetId,
  ).length;
  let datasetsScanned = 0;
  let truncated = datasets.length > GLOBAL_SEARCH_DATASET_LIMIT;

  for (const dataset of scannableDatasets) {
    const datasetId = dataset.datasetId;
    if (!datasetId) continue;
    if (tables.length >= GLOBAL_SEARCH_TABLE_LIMIT) {
      truncated = true;
      break;
    }

    datasetsScanned += 1;
    const remaining = GLOBAL_SEARCH_TABLE_LIMIT - tables.length;
    const listed = await listBigQueryTables(
      projectId,
      datasetId,
      Math.min(remaining, GLOBAL_SEARCH_TABLE_LIMIT),
    );
    tables.push(...listed);
  }

  if (datasetsScanned < datasetCount) truncated = true;

  const matches: ReturnType<typeof compactTable>[] = [];
  const errors: Array<{
    projectId?: string;
    datasetId?: string;
    tableId?: string;
    error: string;
  }> = [];

  for (
    let offset = 0;
    offset < tables.length;
    offset += GLOBAL_SEARCH_METADATA_BATCH_SIZE
  ) {
    const batch = tables.slice(
      offset,
      offset + GLOBAL_SEARCH_METADATA_BATCH_SIZE,
    );
    const settled = await Promise.allSettled(
      batch.map(async (table) => {
        if (!table.datasetId || !table.tableId) return null;
        const metadata = await getBigQueryTableMetadata({
          projectId,
          datasetId: table.datasetId,
          tableId: table.tableId,
        });
        return matchesSearch(metadata, search)
          ? compactTable(metadata, true)
          : null;
      }),
    );

    settled.forEach((result, index) => {
      const table = batch[index];
      if (result.status === "fulfilled") {
        if (result.value) matches.push(result.value);
        return;
      }
      errors.push({
        projectId: table?.projectId ?? projectId,
        datasetId: table?.datasetId,
        tableId: table?.tableId,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    });
  }

  return {
    mode: "table-search",
    projectId,
    search,
    datasetsScanned,
    tablesScanned: tables.length,
    truncated,
    tables: matches.slice(0, limit),
    ...(errors.length
      ? { errors: errors.slice(0, 12), errorCount: errors.length }
      : {}),
    nextStep:
      "Use table=dataset.table for full metadata. Global search is bounded; pass a returned dataset/table reference for a complete inspection.",
  };
}

export default defineAction({
  description:
    "Search or describe BigQuery metadata for the configured warehouse. Use before writing SQL when the data dictionary does not already name the dataset, table, and columns. With no args, lists datasets. With search and no dataset, searches accessible tables and columns across the configured project so the user does not need to provide internal table names. With dataset, lists tables. With dataset + table or a dataset.table value, returns columns for that table.",
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
  mcpTool: false,
  toolCallable: true,
  run: async (args) => {
    const configuredProjectId = await getBigQueryProjectId();
    const limit = args.limit ?? 50;
    const search = (args.search ?? "").trim();

    if (args.table) {
      const ref = parseTableRef(configuredProjectId, args.dataset, args.table);
      const meta = await getBigQueryTableMetadata(ref);
      return {
        mode: "table",
        table: compactTable(meta, true),
      };
    }

    if (!args.dataset) {
      if (search) {
        return searchAcrossDatasets(configuredProjectId, search, limit);
      }
      return {
        mode: "datasets",
        projectId: configuredProjectId,
        datasets: await listDatasets(configuredProjectId, limit, search),
        nextStep:
          "Pass dataset=<datasetId> to list tables, or table=dataset.table to inspect columns.",
      };
    }

    const datasetId = assertIdentifier("dataset", args.dataset);
    const tables = await listBigQueryTables(
      configuredProjectId,
      datasetId,
      limit,
    );
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
        return getBigQueryTableMetadata({
          projectId: configuredProjectId,
          datasetId,
          tableId,
        });
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
