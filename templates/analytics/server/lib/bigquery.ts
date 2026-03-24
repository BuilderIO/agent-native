import { createHash } from "crypto";
import { getAccessToken } from "./gcloud";

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || "your-gcp-project-id";

const APP_EVENTS_TABLE = `${PROJECT_ID}.analytics.events_partitioned`;

/**
 * Resolve @app_events placeholder to the fully-qualified table name.
 */
function resolveTablePlaceholder(sql: string): string {
  return sql.replace(/@app_events/gi, `\`${APP_EVENTS_TABLE}\``);
}

/**
 * Filter out dbt_dev schema from queries.
 * Adds a WHERE clause to exclude tables from dbt_dev schema.
 */
function filterDevSchema(sql: string): string {
  // Add global filter to exclude dbt_dev schema tables
  // This works by wrapping queries that reference schema metadata
  // For most queries, we'll add a comment to track this filter

  // Skip if already has dbt_dev filter
  if (sql.includes("dbt_dev") || sql.includes("DBT_DEV")) {
    return sql;
  }

  // For INFORMATION_SCHEMA queries, add schema exclusion
  if (sql.includes("INFORMATION_SCHEMA")) {
    // Add WHERE clause to exclude dbt_dev schema if not already present
    if (!sql.toLowerCase().includes("where")) {
      sql = sql.replace(
        /FROM\s+`([^`]+)\.INFORMATION_SCHEMA/gi,
        "FROM `$1.INFORMATION_SCHEMA` WHERE table_schema != 'dbt_dev'",
      );
    } else {
      sql = sql.replace(/WHERE\s+/gi, "WHERE table_schema != 'dbt_dev' AND ");
    }
  }

  // Add comment to track that dev schema filtering is enabled
  return `-- Excluding dbt_dev schema\n${sql}`;
}

// --- In-memory query cache ---

interface CacheEntry {
  result: QueryResult;
  createdAt: number;
}

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

const queryCache = new Map<string, CacheEntry>();

function getCacheKey(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function getCached(sql: string): QueryResult | null {
  const key = getCacheKey(sql);
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(sql: string, result: QueryResult): void {
  // Evict oldest entries if cache is full
  if (queryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = queryCache.keys().next().value;
    if (oldest) queryCache.delete(oldest);
  }
  queryCache.set(getCacheKey(sql), { result, createdAt: Date.now() });
}

// --- Query execution ---

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  schema: { name: string; type: string }[];
  bytesProcessed: number;
  cached?: boolean;
}

interface BigQueryField {
  name: string;
  type: string;
  mode?: string;
  fields?: BigQueryField[];
}

interface BigQueryQueryResponse {
  schema?: { fields?: BigQueryField[] };
  rows?: { f: { v: unknown }[] }[];
  totalRows?: string;
  totalBytesProcessed?: string;
  jobComplete?: boolean;
  jobReference?: { jobId: string };
}

interface BigQueryGetQueryResultsResponse {
  schema?: { fields?: BigQueryField[] };
  rows?: { f: { v: unknown }[] }[];
  totalRows?: string;
  jobComplete?: boolean;
  totalBytesProcessed?: string;
}

/**
 * Convert BigQuery REST API row format to plain objects.
 * BigQuery returns rows as { f: [{ v: value }, ...] } arrays
 * mapped to the schema fields.
 */
function rowsToObjects(
  rows: { f: { v: unknown }[] }[],
  fields: BigQueryField[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    row.f.forEach((cell, i) => {
      obj[fields[i].name] = cell.v;
    });
    return obj;
  });
}

export async function runQuery(sql: string): Promise<QueryResult> {
  let resolvedSql = resolveTablePlaceholder(sql);
  resolvedSql = filterDevSchema(resolvedSql);

  const cached = getCached(resolvedSql);
  if (cached) {
    return { ...cached, cached: true };
  }

  const token = await getAccessToken();
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: resolvedSql,
      useLegacySql: false,
      maximumBytesBilled: "750000000000", // 750GB cap
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BigQuery API error ${res.status}: ${text}`);
  }

  let data = (await res.json()) as BigQueryQueryResponse;

  // If the job isn't complete, poll until it is
  if (!data.jobComplete && data.jobReference?.jobId) {
    const jobId = data.jobReference.jobId;
    const resultsUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}`;

    let attempts = 0;
    while (!data.jobComplete && attempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const pollRes = await fetch(resultsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!pollRes.ok) {
        const text = await pollRes.text();
        throw new Error(`BigQuery poll error ${pollRes.status}: ${text}`);
      }
      data = (await pollRes.json()) as BigQueryGetQueryResultsResponse;
      attempts++;
    }

    if (!data.jobComplete) {
      throw new Error("BigQuery query timed out after 60 seconds");
    }
  }

  const fields = data.schema?.fields ?? [];
  const schema = fields.map((f) => ({
    name: f.name,
    type: f.type,
  }));

  const rows = data.rows ? rowsToObjects(data.rows, fields) : [];
  const bytesProcessed = parseInt(data.totalBytesProcessed || "0", 10);

  const result: QueryResult = {
    rows,
    totalRows: rows.length,
    schema,
    bytesProcessed,
  };

  setCache(resolvedSql, result);

  return result;
}
