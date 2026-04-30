import { createHash } from "crypto";
import { getAccessToken } from "./gcloud";
import { resolveCredential } from "./credentials";
import { requireRequestCredentialContext } from "./credentials-context";
import { getDbExec } from "@agent-native/core/db";

async function getProjectId(): Promise<string> {
  const ctx = requireRequestCredentialContext("BIGQUERY_PROJECT_ID");
  return (
    (await resolveCredential("BIGQUERY_PROJECT_ID", ctx)) ||
    "your-gcp-project-id"
  );
}

/**
 * Resolve @app_events placeholder to the fully-qualified table name.
 */
async function resolveTablePlaceholder(sql: string): Promise<string> {
  const projectId = await getProjectId();
  const appEventsTable = `${projectId}.analytics.events_partitioned`;
  return sql.replace(/@app_events/gi, `\`${appEventsTable}\``);
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

// --- Query cache ---
//
// Two tiers:
//   L1: per-process Map (fast hits within a single invocation)
//   L2: SQL-backed `bigquery_cache` table (shared across serverless invocations
//       and deployments). Global scope — BigQuery results are not user-specific.

interface L1Entry {
  result: QueryResult;
  createdAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_L1_ENTRIES = 200;

const l1Cache = new Map<string, L1Entry>();

function getCacheKey(sql: string, projectId: string): string {
  // Scope by project so reconnecting BigQuery to a different GCP project
  // doesn't serve stale results from the previous project's data.
  return createHash("sha256").update(`${projectId}\n${sql}`).digest("hex");
}

function getL1(key: string): QueryResult | null {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    l1Cache.delete(key);
    return null;
  }
  return entry.result;
}

function setL1(key: string, result: QueryResult): void {
  if (l1Cache.size >= MAX_L1_ENTRIES) {
    const oldest = l1Cache.keys().next().value;
    if (oldest) l1Cache.delete(oldest);
  }
  l1Cache.set(key, { result, createdAt: Date.now() });
}

async function getL2(key: string): Promise<QueryResult | null> {
  try {
    const db = getDbExec();
    const nowIso = new Date().toISOString();
    const { rows } = await db.execute({
      sql: "SELECT result FROM bigquery_cache WHERE key = ? AND expires_at > ?",
      args: [key, nowIso],
    });
    if (!rows.length) return null;
    const raw = (rows[0] as { result: string }).result;
    return JSON.parse(raw) as QueryResult;
  } catch (err) {
    console.warn("[bigquery] L2 cache read failed:", err);
    return null;
  }
}

async function setL2(
  key: string,
  sql: string,
  result: QueryResult,
): Promise<void> {
  try {
    const db = getDbExec();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    const serialized = JSON.stringify(result);
    // Upsert — use delete+insert to stay dialect-agnostic (SQLite/Postgres).
    await db.execute({
      sql: "DELETE FROM bigquery_cache WHERE key = ?",
      args: [key],
    });
    await db.execute({
      sql: "INSERT INTO bigquery_cache (key, sql, result, bytes_processed, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [
        key,
        sql,
        serialized,
        result.bytesProcessed ?? 0,
        now.toISOString(),
        expiresAt.toISOString(),
      ],
    });
    // Opportunistically prune expired rows so the cache table doesn't grow
    // unbounded — the explorer accepts arbitrary SQL so the keyspace is huge.
    // Run ~1% of the time to avoid thrashing on every write.
    if (Math.random() < 0.01) {
      await db.execute({
        sql: "DELETE FROM bigquery_cache WHERE expires_at <= ?",
        args: [now.toISOString()],
      });
    }
  } catch (err) {
    console.warn("[bigquery] L2 cache write failed:", err);
  }
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
 *
 * The REST API serializes every value as a string (even numeric types
 * — FLOAT64 comes back as Java-style "6.925207756232687E-4"). Coerce
 * numeric and boolean columns to real JS types using the schema so
 * downstream formatters and charts can work with them.
 */
const NUMERIC_BQ_TYPES = new Set([
  "INTEGER",
  "INT64",
  "FLOAT",
  "FLOAT64",
  "NUMERIC",
  "BIGNUMERIC",
]);

function coerceCell(value: unknown, type: string): unknown {
  if (value == null) return value;
  const upper = type.toUpperCase();
  if (NUMERIC_BQ_TYPES.has(upper) && typeof value === "string") {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  if ((upper === "BOOL" || upper === "BOOLEAN") && typeof value === "string") {
    return value === "true";
  }
  return value;
}

function rowsToObjects(
  rows: { f: { v: unknown }[] }[],
  fields: BigQueryField[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    row.f.forEach((cell, i) => {
      const field = fields[i];
      obj[field.name] = coerceCell(cell.v, field.type);
    });
    return obj;
  });
}

/**
 * Validate a BigQuery SQL statement without executing it. Uses BigQuery's
 * `dryRun` flag, which is free (no bytes billed) and returns query-compilation
 * errors — unknown columns, type mismatches, missing tables — in the same
 * format as a real run. Use this before persisting agent-generated SQL so
 * the agent gets immediate feedback instead of saving a broken dashboard.
 *
 * Returns `null` when the query is valid; otherwise returns a short error
 * string suitable for bubbling back to the agent.
 */
export async function dryRunQuery(sql: string): Promise<string | null> {
  let resolvedSql = await resolveTablePlaceholder(sql);
  resolvedSql = filterDevSchema(resolvedSql);

  const projectId = await getProjectId();
  const token = await getAccessToken();
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      configuration: {
        dryRun: true,
        query: { query: resolvedSql, useLegacySql: false },
      },
    }),
  });

  if (res.ok) return null;

  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string };
    };
    const msg = parsed.error?.message?.trim();
    if (msg) return msg;
  } catch {
    // Fall through
  }
  return `BigQuery validation failed (${res.status})`;
}

export async function runQuery(sql: string): Promise<QueryResult> {
  let resolvedSql = await resolveTablePlaceholder(sql);
  resolvedSql = filterDevSchema(resolvedSql);

  const projectId = await getProjectId();
  const cacheKey = getCacheKey(resolvedSql, projectId);
  const l1Hit = getL1(cacheKey);
  if (l1Hit) {
    return { ...l1Hit, cached: true };
  }
  const l2Hit = await getL2(cacheKey);
  if (l2Hit) {
    setL1(cacheKey, l2Hit);
    return { ...l2Hit, cached: true };
  }

  const token = await getAccessToken();
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;

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
    const resultsUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`;

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

  setL1(cacheKey, result);
  await setL2(cacheKey, resolvedSql, result);

  return result;
}
