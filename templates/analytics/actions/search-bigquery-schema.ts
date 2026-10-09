import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  matchSearchFields,
  semanticScopeCompatibility,
  semanticScopeForSearch,
} from "../server/lib/analytics-term-matcher.js";
import {
  bigQueryGet,
  flattenBigQueryFields,
  getBigQueryProjectId,
  getBigQueryTableMetadata,
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
const GLOBAL_SEARCH_CURSOR_MAX_LENGTH = 8_192;
const BIGQUERY_PAGE_TOKEN_MAX_LENGTH = 2_048;

function apiCursorHash(search: string): string {
  return createHash("sha256")
    .update(search.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

interface ApiPageCursor {
  pageToken?: string;
  searched: number;
  matches: number;
}

function encodeApiPageCursor(search: string, cursor: ApiPageCursor): string {
  const encoded = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `bq1.${apiCursorHash(search)}.${encoded}`;
}

function decodeApiPageCursor(search: string, cursor?: string): ApiPageCursor {
  if (!cursor) return { searched: 0, matches: 0 };
  const match = cursor.match(/^bq1\.([a-f0-9]{16})\.([A-Za-z0-9_-]+)$/);
  if (!match || match[1] !== apiCursorHash(search)) {
    fail("The search cursor does not match this query.", {
      errorCode: "invalid_search_cursor",
      statusCode: 400,
    });
  }
  const decoded = Buffer.from(match[2]!, "base64url").toString("utf8");
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Number.isSafeInteger((parsed as ApiPageCursor).searched) ||
      (parsed as ApiPageCursor).searched < 0 ||
      !Number.isSafeInteger((parsed as ApiPageCursor).matches) ||
      (parsed as ApiPageCursor).matches < 0 ||
      ((parsed as ApiPageCursor).pageToken !== undefined &&
        (typeof (parsed as ApiPageCursor).pageToken !== "string" ||
          !(parsed as ApiPageCursor).pageToken ||
          (parsed as ApiPageCursor).pageToken!.length > 2_048))
    ) {
      throw new Error("invalid");
    }
    return parsed as ApiPageCursor;
  } catch {
    if (!decoded || decoded.length > 2_048) {
      fail("The search cursor is invalid.", {
        errorCode: "invalid_search_cursor",
        statusCode: 400,
      });
    }
    return { pageToken: decoded, searched: 0, matches: 0 };
  }
}

interface GlobalSearchScanState {
  datasetPageToken?: string;
  datasetIndex: number;
  tablePageToken?: string;
}

interface GlobalSearchCursor {
  scan: GlobalSearchScanState;
  offset: number;
  scannedDatasets: number;
  scannedTables: number;
  matches: number;
}

function globalSearchCursorHash(projectId: string, search: string): string {
  return createHash("sha256")
    .update(`${projectId}\n${search.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

function encodeGlobalSearchCursor(
  projectId: string,
  search: string,
  cursor: GlobalSearchCursor,
): string {
  const encoded = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  const result = `bqg1.${globalSearchCursorHash(projectId, search)}.${encoded}`;
  if (result.length > GLOBAL_SEARCH_CURSOR_MAX_LENGTH) {
    fail("BigQuery returned an oversized continuation token.", {
      errorCode: "invalid_bigquery_page_token",
      statusCode: 502,
    });
  }
  return result;
}

function decodeGlobalSearchCursor(
  projectId: string,
  search: string,
  value?: string,
): GlobalSearchCursor {
  if (!value) {
    return {
      scan: { datasetIndex: 0 },
      offset: 0,
      scannedDatasets: 0,
      scannedTables: 0,
      matches: 0,
    };
  }
  const match = value.match(/^bqg1\.([a-f0-9]{16})\.([A-Za-z0-9_-]+)$/);
  if (
    value.length > GLOBAL_SEARCH_CURSOR_MAX_LENGTH ||
    !match ||
    match[1] !== globalSearchCursorHash(projectId, search)
  ) {
    return fail("The search cursor is invalid or does not match this query.", {
      errorCode: "invalid_search_cursor",
      statusCode: 400,
    });
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(match[2]!, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object") throw new Error("invalid");
    const cursor = parsed as Partial<GlobalSearchCursor>;
    const scan = cursor.scan;
    if (
      !scan ||
      typeof scan !== "object" ||
      !Number.isSafeInteger(scan.datasetIndex) ||
      scan.datasetIndex < 0 ||
      scan.datasetIndex > 1_000 ||
      !Number.isSafeInteger(cursor.offset) ||
      cursor.offset! < 0 ||
      (cursor.scannedDatasets !== undefined &&
        (!Number.isSafeInteger(cursor.scannedDatasets) ||
          cursor.scannedDatasets < 0)) ||
      (cursor.scannedTables !== undefined &&
        (!Number.isSafeInteger(cursor.scannedTables) ||
          cursor.scannedTables < 0)) ||
      (cursor.matches !== undefined &&
        (!Number.isSafeInteger(cursor.matches) || cursor.matches < 0)) ||
      (scan.datasetPageToken !== undefined &&
        (typeof scan.datasetPageToken !== "string" ||
          scan.datasetPageToken.length === 0 ||
          scan.datasetPageToken.length > BIGQUERY_PAGE_TOKEN_MAX_LENGTH)) ||
      (scan.tablePageToken !== undefined &&
        (typeof scan.tablePageToken !== "string" ||
          scan.tablePageToken.length === 0 ||
          scan.tablePageToken.length > BIGQUERY_PAGE_TOKEN_MAX_LENGTH))
    ) {
      throw new Error("invalid");
    }
    return {
      scan,
      offset: cursor.offset!,
      scannedDatasets: cursor.scannedDatasets ?? 0,
      scannedTables: cursor.scannedTables ?? 0,
      matches: cursor.matches ?? 0,
    };
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

async function scanGlobalTables(
  projectId: string,
  initial: GlobalSearchScanState,
): Promise<{
  tables: BigQueryTableSummary[];
  datasetsScanned: number;
  nextScan: GlobalSearchScanState | null;
}> {
  const tables: BigQueryTableSummary[] = [];
  let datasetsScanned = 0;
  let datasetsVisited = 0;
  let datasetPagesScanned = 0;
  let tablePagesScanned = 0;
  let cursor = { ...initial };
  let datasetPageToken = cursor.datasetPageToken;
  let datasetPage = await listDatasetsPage(
    projectId,
    GLOBAL_SEARCH_DATASET_LIMIT,
    "",
    datasetPageToken,
  );
  datasetPagesScanned += 1;

  while (true) {
    if (
      datasetsVisited >= GLOBAL_SEARCH_DATASET_LIMIT ||
      tables.length >= GLOBAL_SEARCH_TABLE_LIMIT
    ) {
      return { tables, datasetsScanned, nextScan: cursor };
    }

    if (cursor.datasetPageToken !== datasetPageToken) {
      if (datasetPagesScanned >= GLOBAL_SEARCH_DATASET_LIMIT) {
        return { tables, datasetsScanned, nextScan: cursor };
      }
      datasetPageToken = cursor.datasetPageToken;
      datasetPage = await listDatasetsPage(
        projectId,
        GLOBAL_SEARCH_DATASET_LIMIT,
        "",
        datasetPageToken,
      );
      datasetPagesScanned += 1;
    }

    if (cursor.datasetIndex >= datasetPage.datasets.length) {
      if (!datasetPage.nextPageToken) {
        return { tables, datasetsScanned, nextScan: null };
      }
      cursor = {
        datasetPageToken: datasetPage.nextPageToken,
        datasetIndex: 0,
      };
      continue;
    }

    const dataset = datasetPage.datasets[cursor.datasetIndex];
    const nextDatasetIndex = cursor.datasetIndex + 1;
    const nextDatasetState: GlobalSearchScanState | null =
      nextDatasetIndex < datasetPage.datasets.length
        ? {
            ...(datasetPageToken ? { datasetPageToken } : {}),
            datasetIndex: nextDatasetIndex,
          }
        : datasetPage.nextPageToken
          ? { datasetPageToken: datasetPage.nextPageToken, datasetIndex: 0 }
          : null;

    datasetsVisited += 1;
    if (!dataset.datasetId) {
      if (!nextDatasetState) {
        return { tables, datasetsScanned, nextScan: null };
      }
      cursor = nextDatasetState;
      continue;
    }

    datasetsScanned += 1;
    let tablePageToken = cursor.tablePageToken;
    while (true) {
      if (tablePagesScanned >= GLOBAL_SEARCH_TABLE_LIMIT) {
        return {
          tables,
          datasetsScanned,
          nextScan: {
            ...(datasetPageToken ? { datasetPageToken } : {}),
            datasetIndex: cursor.datasetIndex,
            ...(tablePageToken ? { tablePageToken } : {}),
          },
        };
      }

      const remaining = GLOBAL_SEARCH_TABLE_LIMIT - tables.length;
      const tablePage = await listBigQueryTablesPage(
        projectId,
        dataset.datasetId,
        remaining,
        { pageToken: tablePageToken },
      );
      tablePagesScanned += 1;
      tables.push(...tablePage.tables.slice(0, remaining));

      if (tablePage.nextPageToken) {
        tablePageToken = tablePage.nextPageToken;
        if (
          tables.length >= GLOBAL_SEARCH_TABLE_LIMIT ||
          tablePagesScanned >= GLOBAL_SEARCH_TABLE_LIMIT
        ) {
          return {
            tables,
            datasetsScanned,
            nextScan: {
              ...(datasetPageToken ? { datasetPageToken } : {}),
              datasetIndex: cursor.datasetIndex,
              tablePageToken,
            },
          };
        }
        continue;
      }

      cursor = nextDatasetState ?? cursor;
      if (!nextDatasetState) {
        return { tables, datasetsScanned, nextScan: null };
      }
      if (
        tables.length >= GLOBAL_SEARCH_TABLE_LIMIT ||
        datasetsVisited >= GLOBAL_SEARCH_DATASET_LIMIT
      ) {
        return { tables, datasetsScanned, nextScan: cursor };
      }
      break;
    }
  }
}

async function searchAcrossDatasets(
  projectId: string,
  search: string,
  limit: number,
  nextPage?: string,
) {
  const requestCursor = decodeGlobalSearchCursor(projectId, search, nextPage);
  const scanStart = requestCursor.scan;
  const scan = await scanGlobalTables(projectId, scanStart);
  const { tables, datasetsScanned } = scan;

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
  const rankedMatches = matches;
  const offset = requestCursor.offset;
  if (offset > rankedMatches.length) {
    fail("The search cursor is no longer valid; restart the search.", {
      errorCode: "invalid_search_cursor",
      statusCode: 400,
    });
  }
  const end = offset + limit;
  const hasMoreMatches = end < rankedMatches.length;
  const scannedDatasets = requestCursor.scannedDatasets + datasetsScanned;
  const scannedTables = requestCursor.scannedTables + tables.length;
  const totalMatches = requestCursor.matches + rankedMatches.length;
  const nextCursor = hasMoreMatches
    ? { ...requestCursor, scan: scanStart, offset: end }
    : scan.nextScan
      ? {
          scan: scan.nextScan,
          offset: 0,
          scannedDatasets,
          scannedTables,
          matches: totalMatches,
        }
      : null;
  const pageResults = rankedMatches
    .slice(offset, end)
    .map((match) => match.table);
  const page = {
    results: pageResults,
    searched: scannedTables,
    of: totalMatches,
    truncated: nextCursor !== null,
    nextPage: nextCursor
      ? encodeGlobalSearchCursor(projectId, search, nextCursor)
      : null,
  };

  return {
    mode: "table-search",
    projectId,
    search,
    datasetsScanned: scannedDatasets,
    tablesScanned: scannedTables,
    ...page,
    tables: pageResults,
    ...(errors.length
      ? { errors: errors.slice(0, 12), errorCount: errors.length }
      : {}),
    nextStep:
      "Follow nextPage to continue the bounded global scan. Pass table=dataset.table for full metadata on a specific result.",
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
    nextPage: z.string().max(GLOBAL_SEARCH_CURSOR_MAX_LENGTH).optional(),
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
      const cursor = decodeApiPageCursor(cursorSearch, args.nextPage);
      const datasetPage = await listDatasetsPage(
        configuredProjectId,
        limit,
        search,
        cursor.pageToken,
      );
      const nextPage = datasetPage.nextPageToken
        ? encodeApiPageCursor(cursorSearch, {
            pageToken: datasetPage.nextPageToken,
            searched: cursor.searched + datasetPage.datasets.length,
            matches: cursor.matches + datasetPage.datasets.length,
          })
        : null;
      const searched = cursor.searched + datasetPage.datasets.length;
      return {
        mode: "datasets",
        projectId: configuredProjectId,
        datasets: datasetPage.datasets,
        searched,
        of:
          datasetPage.totalItems ??
          cursor.matches + datasetPage.datasets.length,
        truncated: nextPage !== null,
        nextPage,
        nextStep:
          "Pass dataset=<datasetId> to list tables, or table=dataset.table to inspect columns.",
      };
    }

    const datasetId = assertIdentifier("dataset", args.dataset);
    const includeColumns = args.includeColumns === true || !!search;
    const cursorSearch = `tables\n${configuredProjectId}\n${datasetId}\n${search.toLowerCase()}\n${includeColumns}`;
    const cursor = decodeApiPageCursor(cursorSearch, args.nextPage);
    const tablePage = await listBigQueryTablesPage(
      configuredProjectId,
      datasetId,
      limit,
      { pageToken: cursor.pageToken },
    );
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
      const nextPage = tablePage.nextPageToken
        ? encodeApiPageCursor(cursorSearch, {
            pageToken: tablePage.nextPageToken,
            searched: cursor.searched + tables.length,
            matches: cursor.matches + visibleTables.length,
          })
        : null;
      return {
        mode: "tables",
        projectId: configuredProjectId,
        datasetId,
        tables: visibleTables,
        searched: cursor.searched + tables.length,
        of: tablePage.totalItems ?? cursor.matches + visibleTables.length,
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
      const nextPage = tablePage.nextPageToken
        ? encodeApiPageCursor(cursorSearch, {
            pageToken: tablePage.nextPageToken,
            searched: cursor.searched + metadata.length,
            matches: cursor.matches + metadata.length,
          })
        : null;
      return {
        mode: "tables-with-columns",
        projectId: configuredProjectId,
        datasetId,
        tables: metadata.map((meta) => compactTable(meta, true)),
        searched: cursor.searched + metadata.length,
        of: tablePage.totalItems ?? cursor.matches + metadata.length,
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
    const rankedResults = ranked;
    const nextPage = tablePage.nextPageToken
      ? encodeApiPageCursor(cursorSearch, {
          pageToken: tablePage.nextPageToken,
          searched: cursor.searched + metadata.length,
          matches: cursor.matches + rankedResults.length,
        })
      : null;
    return {
      mode: "table-search",
      projectId: configuredProjectId,
      datasetId,
      search,
      searched: cursor.searched + metadata.length,
      of: cursor.matches + rankedResults.length,
      truncated: nextPage !== null,
      nextPage,
      tables: rankedResults.map((match) => match.table),
      note: "Use exact table and column names from this metadata. If the business meaning is unclear, save an unapproved data-dictionary entry or ask the user.",
    };
  },
});
