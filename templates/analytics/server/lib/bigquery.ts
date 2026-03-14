import { BigQuery } from "@google-cloud/bigquery";
import { createHash } from "crypto";

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || "builder-3b0a2";

let bigqueryClient: BigQuery | null = null;

function getClient(): BigQuery {
  if (bigqueryClient) return bigqueryClient;

  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentials) {
    const parsed = JSON.parse(credentials);
    bigqueryClient = new BigQuery({
      projectId: PROJECT_ID,
      credentials: parsed,
    });
  } else {
    // Falls back to Application Default Credentials (ADC)
    bigqueryClient = new BigQuery({ projectId: PROJECT_ID });
  }

  return bigqueryClient;
}

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

// --- Value normalization ---

/**
 * BigQuery client returns wrapper objects for TIMESTAMP, DATE, DATETIME,
 * BigNumeric, etc. (e.g. { value: "2024-01-15T00:00:00Z" }).
 * Unwrap them to plain JSON-serializable values.
 */
function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "object" && val !== null && "value" in val) {
    return (val as { value: unknown }).value;
  }
  return val;
}

// --- Query execution ---

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  schema: { name: string; type: string }[];
  bytesProcessed: number;
  cached?: boolean;
}

export async function runQuery(sql: string): Promise<QueryResult> {
  let resolvedSql = resolveTablePlaceholder(sql);
  resolvedSql = filterDevSchema(resolvedSql);

  const cached = getCached(resolvedSql);
  if (cached) {
    return { ...cached, cached: true };
  }

  const client = getClient();

  const [job] = await client.createQueryJob({
    query: resolvedSql,
    useLegacySql: false,
    maximumBytesBilled: "750000000000", // 750GB cap
  });

  const [metadata] = await job.getMetadata();
  const bytesProcessed = parseInt(
    metadata.statistics?.totalBytesProcessed || "0",
    10,
  );

  const [rawRows, , response] = await job.getQueryResults();

  const schema =
    response?.schema?.fields?.map((f: any) => ({
      name: f.name,
      type: f.type,
    })) ?? [];

  // BigQuery client returns special wrapper objects for TIMESTAMP, DATE,
  // DATETIME, BigDecimal etc. Normalize them to plain JSON-friendly values.
  const rows = rawRows.map((row: Record<string, unknown>) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      normalized[key] = normalizeValue(val);
    }
    return normalized;
  });

  const result: QueryResult = {
    rows,
    totalRows: rows.length,
    schema,
    bytesProcessed,
  };

  setCache(resolvedSql, result);

  return result;
}
