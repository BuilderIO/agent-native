import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  decodeSearchCursor,
  matchSearchFields,
  paginateSearchResults,
  semanticScopeCompatibility,
  semanticScopeForSearch,
} from "../server/lib/analytics-term-matcher.js";
import {
  bigQueryGet,
  flattenBigQueryFields,
  getBigQueryProjectId,
  getBigQueryTableMetadata,
  listBigQueryTables,
  listBigQueryTablesPage,
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
  nextPageToken?: string;
  totalItems?: number;
}

const PROJECT_RE = /^[A-Za-z][A-Za-z0-9-]{4,61}[A-Za-z0-9]$/;
const ID_RE = /^[A-Za-z0-9_]+$/;
const GLOBAL_SEARCH_DATASET_LIMIT = 100;
const GLOBAL_SEARCH_TABLE_LIMIT = 250;
const GLOBAL_SEARCH_METADATA_BATCH_SIZE = 20;

function apiCursorHash(search: string): string {
  return createHash("sha256")
    .update(search.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function encodeApiPageCursor(search: string, pageToken: string): string {
  return `bq1.${apiCursorHash(search)}.${Buffer.from(pageToken).toString("base64url")}`;
}

function decodeApiPageCursor(
  search: string,
  cursor?: string,
): string | undefined {
  if (!cursor) return undefined;
  const match = cursor.match(/^bq1\.([a-f0-9]{16})\.([A-Za-z0-9_-]+)$/);
  if (!match || match[1] !== apiCursorHash(search)) {
    fail("The search cursor does not match this query.", {
      errorCode: "invalid_search_cursor",
      statusCode: 400,
    });
  }
  const pageToken = Buffer.from(match[2]!, "base64url").toString("utf8");
  if (!pageToken || pageToken.length > 2_048) {
    fail("The search cursor is invalid.", {
      errorCode: "invalid_search_cursor",
      statusCode: 400,
    });
  }
  return pageToken;
}

function decodeSearchOffset(search: string, cursor?: string): number {
  try {
    return decodeSearchCursor(search, cursor);
  } catch {
    return fail("The search cursor is invalid or does not match this query.", {
      errorCode: "invalid_search_cursor",
      statusCode: 400,
    });
  }
}

function assertIdentifier(
  label: string,
  value: string,
  pattern = ID_RE,
): string {
  const clean = value.trim().replace(/^`|`$/g, "");
  if (!pattern.test(clean)) {
    fail(`${label} must be a BigQuery identifier, got "${value}"`, {
      errorCode: "invalid_bigquery_identifier",
      statusCode: 400,
    });
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

  fail(
    "Provide table as dataset.table or project.dataset.table, or pass both dataset and table.",
    { errorCode: "invalid_bigquery_table_reference", statusCode: 400 },
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

function scoreSearch(meta: BigQueryTableMetadata, search: string) {
  const ref = meta.tableReference ?? {};
  const columns = flattenBigQueryFields(meta.schema?.fields);
  return matchSearchFields(search, [
    { value: `${ref.datasetId ?? ""}.${ref.tableId ?? ""}`, weight: 24 },
    { value: meta.friendlyName, weight: 12 },
    { value: meta.description, weight: 8 },
    ...columns.flatMap((column) => [
      { value: column.name, weight: 6 },
      { value: column.description, weight: 3 },
    ]),
  ]);
}

async function listDatasetsPage(
  projectId: string,
  limit: number,
  search: string,
  pageToken?: string,
) {
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets`,
  );
  url.searchParams.set("maxResults", String(Math.min(limit, 1000)));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const result = await bigQueryGet<DatasetListResponse>(url.toString());
  const q = search.toLowerCase();
  const datasets = (result.datasets ?? [])
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
  return {
    datasets,
    ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    ...(typeof result.totalItems === "number"
      ? { totalItems: result.totalItems }
      : {}),
  };
}

async function searchAcrossDatasets(
  projectId: string,
  search: string,
  limit: number,
  nextPage?: string,
) {
  const datasets = (
    await listDatasetsPage(projectId, GLOBAL_SEARCH_DATASET_LIMIT + 1, "")
  ).datasets;
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

  const matches: Array<{
    table: ReturnType<typeof compactTable>;
    score: number;
    scopeRank: number;
  }> = [];
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
        const match = scoreSearch(metadata, search);
        if (match.score <= 0) return null;
        const semanticScope = semanticScopeForSearch(
          [
            metadata.tableReference?.tableId,
            metadata.friendlyName,
            metadata.description,
            ...flattenBigQueryFields(metadata.schema?.fields).map(
              (column) => column.name,
            ),
          ]
            .filter(Boolean)
            .join(" "),
        );
        const requestedScope = semanticScopeForSearch(search);
        const scopeRank = semanticScopeCompatibility(
          semanticScope,
          requestedScope,
        );
        return {
          table: compactTable(metadata, true),
          score: match.score,
          scopeRank,
        };
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

  matches.sort((a, b) => {
    if (b.scopeRank !== a.scopeRank) return b.scopeRank - a.scopeRank;
    if (b.score !== a.score) return b.score - a.score;
    return `${a.table.datasetId}.${a.table.tableId}`.localeCompare(
      `${b.table.datasetId}.${b.table.tableId}`,
    );
  });
  const hasScopeMatch = matches.some((match) => match.scopeRank === 2);
  const scopedMatches = hasScopeMatch
    ? matches.filter((match) => match.scopeRank === 2)
    : matches;
  const cursorSearch = `global\n${search.toLowerCase()}`;
  const offset = decodeSearchOffset(cursorSearch, nextPage);
  if (offset > scopedMatches.length) {
    fail("The search cursor is no longer valid; restart the search.", {
      errorCode: "invalid_search_cursor",
      statusCode: 400,
    });
  }
  const page = paginateSearchResults({
    search: cursorSearch,
    results: scopedMatches.map((match) => match.table),
    searched: tables.length,
    limit,
    offset,
    truncated,
  });

  return {
    mode: "table-search",
    projectId,
    search,
    datasetsScanned,
    tablesScanned: tables.length,
    ...page,
    tables: page.results,
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
    nextPage: z.string().max(4_096).optional(),
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
        return searchAcrossDatasets(
          configuredProjectId,
          search,
          limit,
          args.nextPage,
        );
      }
      const cursorSearch = `datasets\n${configuredProjectId}`;
      const datasetPage = await listDatasetsPage(
        configuredProjectId,
        limit,
        search,
        decodeApiPageCursor(cursorSearch, args.nextPage),
      );
      const nextPage = datasetPage.nextPageToken
        ? encodeApiPageCursor(cursorSearch, datasetPage.nextPageToken)
        : null;
      return {
        mode: "datasets",
        projectId: configuredProjectId,
        datasets: datasetPage.datasets,
        searched: datasetPage.datasets.length,
        of: datasetPage.totalItems ?? datasetPage.datasets.length,
        truncated: nextPage !== null,
        nextPage,
        nextStep:
          "Pass dataset=<datasetId> to list tables, or table=dataset.table to inspect columns.",
      };
    }

    const datasetId = assertIdentifier("dataset", args.dataset);
    const includeColumns = args.includeColumns === true || !!search;
    const cursorSearch = `tables\n${configuredProjectId}\n${datasetId}\n${search.toLowerCase()}\n${includeColumns}`;
    const tablePage = await listBigQueryTablesPage(
      configuredProjectId,
      datasetId,
      limit,
      { pageToken: decodeApiPageCursor(cursorSearch, args.nextPage) },
    );
    const nextPage = tablePage.nextPageToken
      ? encodeApiPageCursor(cursorSearch, tablePage.nextPageToken)
      : null;
    const tables = tablePage.tables;

    if (!includeColumns) {
      const q = search.toLowerCase();
      const visibleTables = tables.filter((table) => {
        if (!q) return true;
        return [table.tableId, table.friendlyName, table.type]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
      return {
        mode: "tables",
        projectId: configuredProjectId,
        datasetId,
        tables: visibleTables,
        searched: tables.length,
        of: tablePage.totalItems ?? tables.length,
        truncated: nextPage !== null,
        nextPage,
        nextStep:
          "Pass table=<tableId> with this dataset to inspect columns before writing SQL.",
      };
    }

    const metadata = await Promise.all(
      tables.map((table) => {
        const tableId = table.tableId ?? "";
        return getBigQueryTableMetadata({
          projectId: configuredProjectId,
          datasetId,
          tableId,
        });
      }),
    );

    if (!search) {
      return {
        mode: "tables-with-columns",
        projectId: configuredProjectId,
        datasetId,
        tables: metadata.map((meta) => compactTable(meta, true)),
        searched: metadata.length,
        of: tablePage.totalItems ?? metadata.length,
        truncated: nextPage !== null,
        nextPage,
        note: "Use exact table and column names from this metadata. If the business meaning is unclear, save an unapproved data-dictionary entry or ask the user.",
      };
    }

    const requestedScope = semanticScopeForSearch(search);
    const ranked = metadata.flatMap((meta) => {
      const match = scoreSearch(meta, search);
      if (match.score <= 0) return [];
      const candidateScope = semanticScopeForSearch(
        [
          meta.tableReference?.tableId,
          meta.friendlyName,
          meta.description,
          ...flattenBigQueryFields(meta.schema?.fields).map(
            (column) => column.name,
          ),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return [
        {
          table: compactTable(meta, true),
          score: match.score,
          scopeRank: semanticScopeCompatibility(candidateScope, requestedScope),
        },
      ];
    });
    ranked.sort((a, b) => {
      if (b.scopeRank !== a.scopeRank) return b.scopeRank - a.scopeRank;
      if (b.score !== a.score) return b.score - a.score;
      return `${a.table.datasetId}.${a.table.tableId}`.localeCompare(
        `${b.table.datasetId}.${b.table.tableId}`,
      );
    });
    const hasScopeMatch = ranked.some((match) => match.scopeRank === 2);
    const scopedResults = hasScopeMatch
      ? ranked.filter((match) => match.scopeRank === 2)
      : ranked;
    return {
      mode: "table-search",
      projectId: configuredProjectId,
      datasetId,
      search,
      searched: metadata.length,
      of: scopedResults.length,
      truncated: nextPage !== null,
      nextPage,
      tables: scopedResults.map((match) => match.table),
      note: "Use exact table and column names from this metadata. If the business meaning is unclear, save an unapproved data-dictionary entry or ask the user.",
    };
  },
});
