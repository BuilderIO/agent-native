import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { z } from "zod";

import {
  BIGQUERY_AGENT_DATASET_ALLOWLIST,
  BigQueryAgentSqlRefusal,
  checkBigQueryAgentTableKind,
} from "../server/lib/bigquery-agent-sql-policy.js";
import {
  BigQueryMetadataError,
  flattenBigQueryFields,
  getBigQueryProjectId,
  getBigQueryTableMetadata,
  listBigQueryTablesPage,
  type BigQueryTableMetadata,
} from "../server/lib/bigquery.js";

const TABLES_PER_DATASET = 1_000;
const METADATA_READS_PER_CALL = 40;
const MAX_COLUMNS = 300;
const DEADLINE_MS = 15_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,1024}$/;

const ALLOWED_DATASETS = [
  ...new Set(
    Object.values(BIGQUERY_AGENT_DATASET_ALLOWLIST).flatMap(
      (datasets) => datasets ?? [],
    ),
  ),
] as [string, ...string[]];

const errors = defineActionErrors(
  "query_table_not_allowed",
  "invalid_table_ref",
  "table_not_found",
  "schema_unavailable",
);

const queryability = {
  queryable: z.boolean().nullable(),
  notQueryableReason: z.string().optional(),
};

const columnSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  mode: z.string().optional(),
  description: z.string().optional(),
});

const outputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("table"),
    table: z.object({
      projectId: z.string(),
      datasetId: z.string(),
      tableId: z.string(),
      type: z.string().nullable(),
      ...queryability,
      description: z.string().nullable(),
      location: z.string().nullable(),
      numRows: z.number().nullable(),
      timePartitioning: z.unknown().optional(),
      clustering: z.unknown().optional(),
      columns: z.array(columnSchema),
      columnsTruncated: z.boolean(),
    }),
  }),
  z.object({
    mode: z.literal("tables"),
    projectId: z.string(),
    datasets: z.array(z.string()),
    search: z.string().nullable(),
    tables: z.array(
      z.object({
        projectId: z.string(),
        datasetId: z.string(),
        tableId: z.string(),
        type: z.string().nullable(),
        ...queryability,
        description: z.string().optional(),
        matchedColumns: z.array(z.string()).optional(),
      }),
    ),
    matched: z.number(),
    truncated: z.boolean(),
    complete: z.boolean(),
    incompleteReasons: z.array(z.string()),
    errors: z.array(
      z.object({
        datasetId: z.string(),
        tableId: z.string().optional(),
        message: z.string(),
      }),
    ),
    columnSearch: z
      .object({ tablesRead: z.number(), tablesListed: z.number() })
      .optional(),
  }),
]);

function queryable(
  projectId: string,
  datasetId: string,
  tableId: string,
  resource: BigQueryTableMetadata | null,
): { queryable: boolean | null; notQueryableReason?: string } {
  if (!resource) {
    return {
      queryable: null,
      notQueryableReason:
        "Its table metadata could not be read, so whether query-warehouse can read it is unknown. Describe it with table to check.",
    };
  }
  try {
    checkBigQueryAgentTableKind({ projectId, datasetId, tableId }, resource);
    return { queryable: true };
  } catch (error) {
    if (error instanceof BigQueryAgentSqlRefusal) {
      return { queryable: false, notQueryableReason: error.message };
    }
    throw error;
  }
}

function unreadable(error: unknown): string {
  if (error instanceof BigQueryMetadataError) {
    return `BigQuery answered ${error.status}: ${error.message.slice(0, 300)}`;
  }
  return error instanceof Error && error.name === "AbortError"
    ? "The search's deadline passed before this was read."
    : "It could not be read.";
}

function allowedDatasetsFor(projectId: string): readonly string[] {
  const datasets = BIGQUERY_AGENT_DATASET_ALLOWLIST[projectId.toLowerCase()];
  if (!datasets?.length) {
    return errors.fail(
      "This Analytics BigQuery connection has no datasets approved for outside agents, so there is nothing to search.",
      "query_table_not_allowed",
      { statusCode: 403 },
    );
  }
  return datasets;
}

function parseTableRef(
  projectId: string,
  allowed: readonly string[],
  value: string,
): { projectId: string; datasetId: string; tableId: string } {
  const parts = value.replace(/`/g, "").trim().split(".");
  if (parts.length !== 2 && parts.length !== 3) {
    errors.fail(
      "Name the table as dataset.table or project.dataset.table.",
      "invalid_table_ref",
      { statusCode: 400 },
    );
  }
  const [project, datasetId, tableId] =
    parts.length === 3
      ? (parts as [string, string, string])
      : [projectId, parts[0] ?? "", parts[1] ?? ""];
  if (project.toLowerCase() !== projectId.toLowerCase()) {
    errors.fail(
      `Only tables in this connection's project (${projectId}) can be searched.`,
      "query_table_not_allowed",
      { statusCode: 403 },
    );
  }
  if (!allowed.includes(datasetId)) {
    errors.fail(
      `\`${datasetId}\` is not a dataset approved for outside agents (${allowed.join(", ")}).`,
      "query_table_not_allowed",
      { statusCode: 403 },
    );
  }
  if (!IDENTIFIER.test(tableId)) {
    errors.fail(
      "Table names may use letters, digits, underscores and dashes.",
      "invalid_table_ref",
      { statusCode: 400 },
    );
  }
  return { projectId, datasetId, tableId };
}

async function describeTable(
  ref: { projectId: string; datasetId: string; tableId: string },
  signal: AbortSignal,
) {
  let meta: BigQueryTableMetadata;
  try {
    meta = await getBigQueryTableMetadata(ref, signal);
  } catch (error) {
    if (error instanceof BigQueryMetadataError && error.status === 404) {
      return errors.fail(
        `\`${ref.datasetId}.${ref.tableId}\` does not exist. Search without table to find its name.`,
        "table_not_found",
        { statusCode: 404 },
      );
    }
    return errors.fail(
      `The table's schema could not be read. ${unreadable(error)}`,
      "schema_unavailable",
      { statusCode: 502 },
    );
  }
  const columns = flattenBigQueryFields(meta.schema?.fields);
  return {
    mode: "table" as const,
    table: {
      ...ref,
      type: meta.type ?? null,
      ...queryable(ref.projectId, ref.datasetId, ref.tableId, meta),
      description: meta.description ?? null,
      location: meta.location ?? null,
      numRows: meta.numRows ? Number(meta.numRows) : null,
      ...(meta.timePartitioning
        ? { timePartitioning: meta.timePartitioning }
        : {}),
      ...(meta.clustering ? { clustering: meta.clustering } : {}),
      columns: columns.slice(0, MAX_COLUMNS),
      columnsTruncated: columns.length > MAX_COLUMNS,
    },
  };
}

interface Candidate {
  datasetId: string;
  tableId: string;
  type: string | undefined;
  description?: string;
  nameScore: number;
  matchedColumns: string[];
  descriptionMatch: boolean;
  meta?: BigQueryTableMetadata | null;
}

function termsIn(text: string | undefined, terms: string[]): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term)).length;
}

export default defineAction({
  description:
    "Find tables and columns that query-warehouse can read: Analytics' reviewed BigQuery datasets only, never the rest of the warehouse. With search, ranks tables whose dataset, table, column names or descriptions contain the words; with dataset, limits the search to that dataset; with table (dataset.table or project.dataset.table), returns that table's columns and whether query-warehouse can query it (unreviewed views, external and BigLake tables cannot; queryable is null when the table's metadata could not be read). Bounded: each dataset lists up to 1,000 tables and one call reads at most 40 tables' metadata, for columns and queryable alike (queryable is null for a returned table past that); complete: false, incompleteReasons, errors and columnSearch say what was not searched, so narrow with dataset rather than treating a miss as absence. Reads metadata only; nothing is billed.",
  schema: z.object({
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe(
        "Words to find in dataset, table, and column names or descriptions, e.g. 'signups week'.",
      ),
    dataset: z
      .enum(ALLOWED_DATASETS)
      .optional()
      .describe("Search only this approved dataset."),
    table: z
      .string()
      .max(1_200)
      .optional()
      .describe(
        "dataset.table or project.dataset.table to describe column by column.",
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(
        `Most tables to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`,
      ),
  }),
  outputSchema,
  errors,
  mcpOutputSchema: true,
  http: false,
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: false, readOnly: true, requiresAuth: true },
  run: async (args) => {
    const deadline = AbortSignal.timeout(DEADLINE_MS);
    const projectId = await getBigQueryProjectId(deadline);
    const allowed = allowedDatasetsFor(projectId);
    if (args.table) {
      return describeTable(
        parseTableRef(projectId, allowed, args.table),
        deadline,
      );
    }
    const datasets = args.dataset ? [args.dataset] : [...allowed];
    if (!datasets.every((dataset) => allowed.includes(dataset))) {
      errors.fail(
        `\`${args.dataset}\` is not approved for this connection's project.`,
        "query_table_not_allowed",
        { statusCode: 403 },
      );
    }
    const terms = (args.search ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const incompleteReasons: string[] = [];
    const failures: { datasetId: string; tableId?: string; message: string }[] =
      [];
    const listed = await Promise.all(
      datasets.map(async (datasetId) => {
        try {
          const page = await listBigQueryTablesPage(
            projectId,
            datasetId,
            TABLES_PER_DATASET,
            { signal: deadline },
          );
          if (page.nextPageToken) {
            incompleteReasons.push(
              `${datasetId} has more than ${TABLES_PER_DATASET.toLocaleString("en-US")} tables; only the first ${TABLES_PER_DATASET.toLocaleString("en-US")} were searched.`,
            );
          }
          return page.tables.flatMap((table) =>
            table.tableId
              ? [{ datasetId, tableId: table.tableId, type: table.type }]
              : [],
          );
        } catch (error) {
          failures.push({ datasetId, message: unreadable(error) });
          return [];
        }
      }),
    );
    const candidates: Candidate[] = listed.flat().map((table) => ({
      ...table,
      nameScore: termsIn(`${table.datasetId}.${table.tableId}`, terms),
      matchedColumns: [],
      descriptionMatch: false,
    }));

    let metadataReads = 0;
    const readMetadata = async (candidate: Candidate) => {
      if (candidate.meta !== undefined) return candidate.meta;
      if (metadataReads >= METADATA_READS_PER_CALL) return undefined;
      metadataReads++;
      try {
        candidate.meta = await getBigQueryTableMetadata(
          {
            projectId,
            datasetId: candidate.datasetId,
            tableId: candidate.tableId,
          },
          deadline,
        );
        candidate.type = candidate.meta.type ?? candidate.type;
        if (candidate.meta.description) {
          candidate.description = candidate.meta.description;
        }
      } catch (error) {
        candidate.meta = null;
        failures.push({
          datasetId: candidate.datasetId,
          tableId: candidate.tableId,
          message: unreadable(error),
        });
      }
      return candidate.meta;
    };

    let columnSearch: { tablesRead: number; tablesListed: number } | undefined;
    if (terms.length) {
      const toRead = [...candidates]
        .sort(
          (a, b) =>
            b.nameScore - a.nameScore ||
            `${a.datasetId}.${a.tableId}`.localeCompare(
              `${b.datasetId}.${b.tableId}`,
            ),
        )
        .slice(0, METADATA_READS_PER_CALL);
      let tablesRead = 0;
      await Promise.all(
        toRead.map(async (candidate) => {
          const meta = await readMetadata(candidate);
          if (!meta) return;
          tablesRead++;
          candidate.descriptionMatch = termsIn(meta.description, terms) > 0;
          candidate.matchedColumns = flattenBigQueryFields(meta.schema?.fields)
            .filter(
              (column) =>
                termsIn(column.name, terms) > 0 ||
                termsIn(column.description, terms) > 0,
            )
            .map((column) => column.name);
        }),
      );
      columnSearch = { tablesRead, tablesListed: candidates.length };
      if (tablesRead < candidates.length) {
        incompleteReasons.push(
          `Columns were searched in ${tablesRead} of ${candidates.length} tables (those whose names matched first); pass dataset to search the rest.`,
        );
      }
    }
    const score = (candidate: Candidate) =>
      candidate.nameScore * 10 +
      candidate.matchedColumns.length * 3 +
      (candidate.descriptionMatch ? 2 : 0);
    const matches = candidates
      .filter((candidate) => !terms.length || score(candidate) > 0)
      .sort(
        (a, b) =>
          score(b) - score(a) ||
          `${a.datasetId}.${a.tableId}`.localeCompare(
            `${b.datasetId}.${b.tableId}`,
          ),
      );
    const limit = args.limit ?? DEFAULT_LIMIT;
    const returned = matches.slice(0, limit);
    await Promise.all(returned.map(readMetadata));
    const unchecked = returned.filter(
      (candidate) => candidate.meta === undefined,
    ).length;
    if (unchecked) {
      incompleteReasons.push(
        `${unchecked} returned table${unchecked === 1 ? " was" : "s were"} not checked: one call reads at most ${METADATA_READS_PER_CALL} tables' metadata, so their queryable is null. Describe one with table, or narrow with dataset or search.`,
      );
    }
    if (failures.length) {
      incompleteReasons.push(
        `${failures.length} dataset or table read${failures.length === 1 ? "" : "s"} failed; see errors.`,
      );
    }
    return {
      mode: "tables" as const,
      projectId,
      datasets,
      search: args.search || null,
      tables: returned.map((candidate) => ({
        projectId,
        datasetId: candidate.datasetId,
        tableId: candidate.tableId,
        type: candidate.type ?? null,
        ...(candidate.meta === undefined
          ? {
              queryable: null,
              notQueryableReason: `Not checked: one call reads at most ${METADATA_READS_PER_CALL} tables' metadata. Describe it with table to check.`,
            }
          : queryable(
              projectId,
              candidate.datasetId,
              candidate.tableId,
              candidate.meta,
            )),
        ...(candidate.description
          ? { description: candidate.description.slice(0, 500) }
          : {}),
        ...(terms.length ? { matchedColumns: candidate.matchedColumns } : {}),
      })),
      matched: matches.length,
      truncated: matches.length > limit,
      complete: incompleteReasons.length === 0,
      incompleteReasons,
      errors: failures,
      ...(columnSearch ? { columnSearch } : {}),
    };
  },
});
