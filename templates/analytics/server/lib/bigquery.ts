import { createHash } from "crypto";

import { getDbExec } from "@agent-native/core/db";
import { getRequestRunContext } from "@agent-native/core/server";

import { DASHBOARD_SQL_VALIDATION_TIMEOUT_MS } from "../../shared/dashboard-report-timeouts.js";
import { resolveCredential } from "./credentials";
import {
  credentialCacheScope,
  requireRequestCredentialContext,
  type CredentialContext,
} from "./credentials-context";
import { getAccessToken } from "./gcloud";
import { assertReadOnlySql } from "./read-only-sql";

async function getProjectContext(): Promise<{
  projectId: string;
  cacheScope: string;
  ctx: CredentialContext;
}> {
  const ctx = requireRequestCredentialContext("BIGQUERY_PROJECT_ID");
  const projectId = await resolveCredential("BIGQUERY_PROJECT_ID", ctx);
  if (!projectId) throw new Error("BIGQUERY_PROJECT_ID not configured");
  return {
    projectId,
    cacheScope: credentialCacheScope("BIGQUERY_PROJECT_ID", ctx),
    ctx,
  };
}

export async function getBigQueryProjectId(): Promise<string> {
  const { projectId } = await getProjectContext();
  return projectId;
}

async function getProjectInfo(): Promise<{
  projectId: string;
  cacheScope: string;
  appEventsTable: BigQueryTableRef;
}> {
  const { projectId, cacheScope, ctx } = await getProjectContext();
  return {
    projectId,
    cacheScope,
    appEventsTable: await getAppEventsTable(projectId, ctx),
  };
}

export interface BigQueryTableRef {
  projectId: string;
  datasetId: string;
  tableId: string;
  fullyQualified: string;
}

function parseBigQueryTableRef(
  raw: string | null | undefined,
  fallbackProjectId: string,
): BigQueryTableRef {
  const value = raw?.trim().replace(/^`|`$/g, "");
  const parts = value ? value.split(".") : [];
  const [projectId, datasetId, tableId] =
    parts.length === 3
      ? parts
      : parts.length === 2
        ? [fallbackProjectId, parts[0], parts[1]]
        : [fallbackProjectId, "analytics", "events_partitioned"];

  if (
    !/^[A-Za-z][A-Za-z0-9-]{4,61}[A-Za-z0-9]$/.test(projectId) ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(datasetId) ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableId)
  ) {
    throw new Error(
      "ANALYTICS_BIGQUERY_EVENTS_TABLE must be dataset.table or project.dataset.table",
    );
  }

  return {
    projectId,
    datasetId,
    tableId,
    fullyQualified: `${projectId}.${datasetId}.${tableId}`,
  };
}

export async function getAppEventsTable(
  fallbackProjectId: string,
  ctx: CredentialContext,
): Promise<BigQueryTableRef> {
  const configured =
    (await resolveCredential("ANALYTICS_BIGQUERY_EVENTS_TABLE", ctx)) ||
    (await resolveCredential("BIGQUERY_APP_EVENTS_TABLE", ctx));
  return parseBigQueryTableRef(configured, fallbackProjectId);
}

async function resolveTablePlaceholder(
  sql: string,
  projectId?: string,
  appEventsTable?: BigQueryTableRef,
): Promise<string> {
  if (!projectId || !appEventsTable) {
    const info = await getProjectInfo();
    projectId ??= info.projectId;
    appEventsTable ??= info.appEventsTable;
  }
  const quotedAppEventsTable = `\`${appEventsTable.fullyQualified}\``;
  return sql
    .replace(/`?@app_events`?/gi, quotedAppEventsTable)
    .replace(
      /`?@project\.analytics\.events_partitioned`?/gi,
      quotedAppEventsTable,
    )
    .replace(
      /`?[A-Za-z][A-Za-z0-9-]{4,61}[A-Za-z0-9]\.analytics\.events_partitioned`?/gi,
      quotedAppEventsTable,
    )
    .replace(
      /(^|[^A-Za-z0-9_.-])`?analytics\.events_partitioned`?/gi,
      (_match, prefix: string) => `${prefix}${quotedAppEventsTable}`,
    )
    .replace(/`@project\./g, `\`${projectId}.`)
    .replace(/\b@project\./g, `${projectId}.`);
}

interface L1Entry {
  result: QueryResult;
  createdAt: number;
  generation: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_L1_ENTRIES = 200;
const STALE_REFRESH_MS = 5 * 60 * 1000;

const l1Cache = new Map<string, L1Entry>();

interface CacheFence {
  generation: number;
  refreshInProgress: boolean;
}

function getCacheKey(
  sql: string,
  projectId: string,
  cacheScope: string,
): string {
  // Scope by caller as well as project so a warm server process cannot serve
  // cached warehouse results across tenants that happen to query the same
  // project/table names.
  return createHash("sha256")
    .update(`${cacheScope}\n${projectId}\n${sql}`)
    .digest("hex");
}

function addUtcDateCacheKey(sql: string): string {
  if (!/\bCURRENT_DATE\s*(?:\(\s*\))?/i.test(sql)) return sql;
  return `${sql}\n/* agent-native-utc-date:${new Date().toISOString().slice(0, 10)} */`;
}

function getL1(key: string, generation: number): QueryResult | null {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (
    entry.generation !== generation ||
    Date.now() - entry.createdAt > CACHE_TTL_MS
  ) {
    l1Cache.delete(key);
    return null;
  }
  return entry.result;
}

function setL1(key: string, result: QueryResult, generation: number): void {
  if (l1Cache.size >= MAX_L1_ENTRIES) {
    const oldest = l1Cache.keys().next().value;
    if (oldest) l1Cache.delete(oldest);
  }
  l1Cache.set(key, { result, createdAt: Date.now(), generation });
}

async function getCacheFence(key: string): Promise<CacheFence> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const db = getDbExec();
    const { rows } = await db.execute({
      sql: "SELECT generation, refresh_in_progress, refresh_started_at FROM bigquery_cache WHERE key = $1",
      args: [key],
    });
    if (!rows.length) return { generation: 0, refreshInProgress: false };

    const entry = rows[0] as {
      generation: unknown;
      refresh_in_progress: unknown;
      refresh_started_at: unknown;
    };
    const generation = Number(entry.generation);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new Error("BigQuery cache generation is invalid");
    }
    const refreshInProgress = entry.refresh_in_progress === true;
    if (!refreshInProgress) return { generation, refreshInProgress: false };

    if (typeof entry.refresh_started_at !== "string") {
      throw new Error("BigQuery cache refresh timestamp is missing");
    }
    const refreshStartedAt = Date.parse(entry.refresh_started_at);
    if (!Number.isFinite(refreshStartedAt)) {
      throw new Error("BigQuery cache refresh timestamp is invalid");
    }
    if (Date.now() - refreshStartedAt <= STALE_REFRESH_MS) {
      return { generation, refreshInProgress: true };
    }

    // A terminated request must not leave forced refreshes blocked indefinitely.
    const released = await db.execute({
      sql: "UPDATE bigquery_cache SET refresh_in_progress = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $2 AND refresh_in_progress = TRUE AND refresh_started_at = $3 AND refresh_started_at < $4 RETURNING key",
      args: [
        key,
        generation,
        entry.refresh_started_at,
        new Date(Date.now() - STALE_REFRESH_MS).toISOString(),
      ],
    });
    if (released.rows.length) {
      return { generation, refreshInProgress: false };
    }
  }
  throw new Error("BigQuery cache refresh state changed repeatedly");
}

async function beginForcedRefresh(key: string, sql: string): Promise<number> {
  const db = getDbExec();
  const now = new Date().toISOString();
  const { rows } = await db.execute({
    sql: "INSERT INTO bigquery_cache (key, sql, result, bytes_processed, created_at, expires_at, generation, refresh_in_progress, refresh_started_at) VALUES ($1, $2, '{}', 0, $3, $3, 1, TRUE, $3) ON CONFLICT (key) DO UPDATE SET sql = EXCLUDED.sql, generation = bigquery_cache.generation + 1, expires_at = EXCLUDED.expires_at, refresh_in_progress = TRUE, refresh_started_at = EXCLUDED.refresh_started_at RETURNING generation",
    args: [key, sql, now],
  });
  const generation = Number(
    (rows[0] as { generation?: unknown } | undefined)?.generation,
  );
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("Could not establish BigQuery cache refresh fence");
  }
  return generation;
}

async function getL2(
  key: string,
  generation: number,
): Promise<QueryResult | null> {
  try {
    const db = getDbExec();
    const { rows } = await db.execute({
      sql: "SELECT result FROM bigquery_cache WHERE key = $1 AND generation = $2 AND refresh_in_progress = FALSE AND expires_at > $3",
      args: [key, generation, new Date().toISOString()],
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
  generation: number,
): Promise<boolean> {
  try {
    const db = getDbExec();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    const serialized = JSON.stringify(result);
    const { rows } = await db.execute({
      sql: "INSERT INTO bigquery_cache (key, sql, result, bytes_processed, created_at, expires_at, generation, refresh_in_progress, refresh_started_at) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NULL) ON CONFLICT (key) DO UPDATE SET sql = EXCLUDED.sql, result = EXCLUDED.result, bytes_processed = EXCLUDED.bytes_processed, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at WHERE bigquery_cache.generation = EXCLUDED.generation AND bigquery_cache.refresh_in_progress = FALSE RETURNING key",
      args: [
        key,
        sql,
        serialized,
        result.bytesProcessed ?? 0,
        now.toISOString(),
        expiresAt.toISOString(),
        generation,
      ],
    });
    if (!rows.length) return false;
    if (Math.random() < 0.01) {
      await db.execute({
        sql: "DELETE FROM bigquery_cache WHERE expires_at <= $1 AND refresh_in_progress = FALSE",
        args: [now.toISOString()],
      });
    }
    return true;
  } catch (err) {
    console.warn("[bigquery] L2 cache write failed:", err);
    return false;
  }
}

async function finishForcedRefresh(
  key: string,
  sql: string,
  result: QueryResult,
  generation: number,
): Promise<boolean> {
  try {
    const db = getDbExec();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    const { rows } = await db.execute({
      sql: "UPDATE bigquery_cache SET sql = $2, result = $3, bytes_processed = $4, created_at = $5, expires_at = $6, refresh_in_progress = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $7 AND refresh_in_progress = TRUE RETURNING key",
      args: [
        key,
        sql,
        JSON.stringify(result),
        result.bytesProcessed ?? 0,
        now.toISOString(),
        expiresAt.toISOString(),
        generation,
      ],
    });
    return rows.length > 0;
  } catch (err) {
    console.warn("[bigquery] Forced cache refresh write failed:", err);
    return false;
  }
}

async function releaseForcedRefresh(
  key: string,
  generation: number,
): Promise<void> {
  try {
    await getDbExec().execute({
      sql: "UPDATE bigquery_cache SET refresh_in_progress = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $2 AND refresh_in_progress = TRUE",
      args: [key, generation],
    });
  } catch (err) {
    console.warn("[bigquery] Forced cache refresh release failed:", err);
  }
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  schema: { name: string; type: string }[];
  bytesProcessed: number;
  cached?: boolean;
  truncated?: boolean;
}

export interface RunQueryOptions {
  signal?: AbortSignal;
  forceRefresh?: boolean;
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

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("BigQuery query aborted", "AbortError");
  }
  const error = new Error("BigQuery query aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function waitForPollInterval(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 1000);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function cancelQueryJob(
  projectId: string,
  jobId: string,
  token: string,
): Promise<void> {
  try {
    await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs/${jobId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch {
    // Cancellation is best-effort and must not hide the original abort or
    // timeout reason if BigQuery or the network is unavailable.
  }
}

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

export interface DryRunQueryOptions {
  signal?: AbortSignal;
}

export async function dryRunQuery(
  sql: string,
  options: DryRunQueryOptions = {},
): Promise<string | null> {
  if (options.signal?.aborted) {
    throw new Error("BigQuery validation was cancelled before it started");
  }
  const { projectId, appEventsTable } = await getProjectInfo();
  const resolvedSql = await resolveTablePlaceholder(
    sql,
    projectId,
    appEventsTable,
  );

  const token = await getAccessToken();
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs`;

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMessage = `BigQuery validation timed out after ${Math.round(DASHBOARD_SQL_VALIDATION_TIMEOUT_MS / 1000)} seconds`;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(timeoutMessage));
      }, DASHBOARD_SQL_VALIDATION_TIMEOUT_MS);
    });
    const request = fetch(url, {
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
      signal: controller.signal,
    });
    const res = await Promise.race([request, timeout]);

    if (res.ok) return null;

    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
      };
      const msg = parsed.error?.message?.trim();
      if (msg) return msg;
      // coercion-ok: malformed BigQuery error bodies use the status fallback below.
    } catch {
      // Fall through
    }
    return `BigQuery validation failed (${res.status})`;
  } catch (error) {
    if (timedOut) return timeoutMessage;
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortFromCaller);
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runQuery(
  sql: string,
  options: RunQueryOptions = {},
): Promise<QueryResult> {
  assertReadOnlySql(sql, "bigquery");
  const { signal } = options;
  throwIfAborted(signal);
  const { projectId, cacheScope, appEventsTable } = await getProjectInfo();
  const resolvedSql = await resolveTablePlaceholder(
    sql,
    projectId,
    appEventsTable,
  );
  const cacheableSql = addUtcDateCacheKey(resolvedSql);

  const cacheKey = getCacheKey(cacheableSql, projectId, cacheScope);
  const forceRefresh = options.forceRefresh === true;
  let cacheGeneration: number | null = null;
  let refreshInProgress = false;
  if (forceRefresh) {
    cacheGeneration = await beginForcedRefresh(cacheKey, cacheableSql);
    l1Cache.delete(cacheKey);
  } else {
    try {
      const fence = await getCacheFence(cacheKey);
      cacheGeneration = fence.generation;
      refreshInProgress = fence.refreshInProgress;
    } catch (err) {
      console.warn("[bigquery] Cache fence read failed; bypassing cache:", err);
    }
    if (cacheGeneration !== null && !refreshInProgress) {
      const l1Hit = getL1(cacheKey, cacheGeneration);
      if (l1Hit) {
        return { ...l1Hit, cached: true };
      }
      const l2Hit = await getL2(cacheKey, cacheGeneration);
      if (l2Hit) {
        setL1(cacheKey, l2Hit, cacheGeneration);
        return { ...l2Hit, cached: true };
      }
    }
  }

  try {
    const token = await getAccessToken();
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;

    throwIfAborted(signal);
    const res = await fetch(url, {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: cacheableSql,
        useLegacySql: false,
        maximumBytesBilled: "750000000000", // 750GB cap
        ...(forceRefresh ? { useQueryCache: false } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BigQuery API error ${res.status}: ${text}`);
    }

    let data = (await res.json()) as BigQueryQueryResponse;

    if (!data.jobComplete && data.jobReference?.jobId) {
      const jobId = data.jobReference.jobId;
      const resultsUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`;

      let attempts = 0;
      try {
        while (!data.jobComplete && attempts < 60) {
          await waitForPollInterval(signal);
          throwIfAborted(signal);
          const pollRes = await fetch(resultsUrl, {
            ...(signal ? { signal } : {}),
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
      } catch (error) {
        if (signal?.aborted) {
          await cancelQueryJob(projectId, jobId, token);
        }
        throw error;
      }

      if (!data.jobComplete) {
        await cancelQueryJob(projectId, jobId, token);
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

    const reportedTotal = Number.parseInt(data.totalRows || "", 10);
    const totalRows = Number.isFinite(reportedTotal)
      ? reportedTotal
      : rows.length;

    const result: QueryResult = {
      rows,
      totalRows,
      schema,
      bytesProcessed,
      ...(totalRows > rows.length ? { truncated: true } : {}),
    };

    if (forceRefresh && cacheGeneration !== null) {
      const persisted = await finishForcedRefresh(
        cacheKey,
        cacheableSql,
        result,
        cacheGeneration,
      );
      if (persisted) setL1(cacheKey, result, cacheGeneration);
      else await releaseForcedRefresh(cacheKey, cacheGeneration);
    } else if (cacheGeneration !== null && !refreshInProgress) {
      setL1(cacheKey, result, cacheGeneration);
      const l2Persistence = setL2(
        cacheKey,
        cacheableSql,
        result,
        cacheGeneration,
      );
      const waitUntil = getRequestRunContext()?.waitUntil;
      if (waitUntil) waitUntil(l2Persistence);
      else await l2Persistence;
    }

    return result;
  } catch (error) {
    if (forceRefresh && cacheGeneration !== null) {
      await releaseForcedRefresh(cacheKey, cacheGeneration);
    }
    throw error;
  }
}
