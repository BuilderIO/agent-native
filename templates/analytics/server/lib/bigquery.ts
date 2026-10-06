import { createHash, randomUUID } from "crypto";

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
  fenceToken: string | null;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_L1_ENTRIES = 200;
const STALE_REFRESH_MS = 5 * 60 * 1000;

const l1Cache = new Map<string, L1Entry>();

interface CacheFence {
  generation: number;
  fenceToken: string | null;
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

function getL1(
  key: string,
  generation: number,
  fenceToken: string | null,
): QueryResult | null {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (
    entry.generation !== generation ||
    entry.fenceToken !== fenceToken ||
    Date.now() - entry.createdAt > CACHE_TTL_MS
  ) {
    l1Cache.delete(key);
    return null;
  }
  return entry.result;
}

function setL1(key: string, result: QueryResult, fence: CacheFence): void {
  if (l1Cache.size >= MAX_L1_ENTRIES) {
    const oldest = l1Cache.keys().next().value;
    if (oldest) l1Cache.delete(oldest);
  }
  l1Cache.set(key, {
    result,
    createdAt: Date.now(),
    generation: fence.generation,
    fenceToken: fence.fenceToken,
  });
}

async function getCacheFence(key: string): Promise<CacheFence> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const db = getDbExec();
    const { rows } = await db.execute({
      sql: "SELECT generation, fence_token, refresh_in_progress, refresh_started_at FROM bigquery_cache WHERE key = $1",
      args: [key],
    });
    if (!rows.length) {
      return { generation: 0, fenceToken: null, refreshInProgress: false };
    }

    const entry = rows[0] as {
      generation: unknown;
      fence_token: unknown;
      refresh_in_progress: unknown;
      refresh_started_at: unknown;
    };
    const generation = Number(entry.generation);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new Error("BigQuery cache generation is invalid");
    }
    if (entry.fence_token !== null && typeof entry.fence_token !== "string") {
      throw new Error("BigQuery cache fence token is invalid");
    }
    const fenceToken = entry.fence_token;
    const refreshInProgress = entry.refresh_in_progress === true;
    if (!refreshInProgress) {
      return { generation, fenceToken, refreshInProgress: false };
    }

    if (typeof entry.refresh_started_at !== "string") {
      throw new Error("BigQuery cache refresh timestamp is missing");
    }
    const refreshStartedAt = Date.parse(entry.refresh_started_at);
    if (!Number.isFinite(refreshStartedAt)) {
      throw new Error("BigQuery cache refresh timestamp is invalid");
    }
    if (Date.now() - refreshStartedAt <= STALE_REFRESH_MS) {
      return { generation, fenceToken, refreshInProgress: true };
    }

    // A terminated request must not leave forced refreshes blocked indefinitely.
    const released = await db.execute({
      sql: "UPDATE bigquery_cache SET refresh_in_progress = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $2 AND fence_token IS NOT DISTINCT FROM $5 AND refresh_in_progress = TRUE AND refresh_started_at = $3 AND refresh_started_at < $4 RETURNING key",
      args: [
        key,
        generation,
        entry.refresh_started_at,
        new Date(Date.now() - STALE_REFRESH_MS).toISOString(),
        fenceToken,
      ],
    });
    if (released.rows.length) {
      return { generation, fenceToken, refreshInProgress: false };
    }
  }
  throw new Error("BigQuery cache refresh state changed repeatedly");
}

async function beginForcedRefresh(
  key: string,
  sql: string,
): Promise<CacheFence | null> {
  const now = new Date().toISOString();
  const fenceToken = randomUUID();
  const staleBefore = new Date(Date.now() - STALE_REFRESH_MS).toISOString();
  const { rows } = await getDbExec().execute({
    sql: "INSERT INTO bigquery_cache (key, sql, result, bytes_processed, created_at, expires_at, generation, fence_token, refresh_in_progress, refresh_started_at) VALUES ($1, $2, '{}', 0, $3, $3, 1, $5, TRUE, $3) ON CONFLICT (key) DO UPDATE SET sql = EXCLUDED.sql, generation = bigquery_cache.generation + 1, fence_token = EXCLUDED.fence_token, refresh_in_progress = TRUE, refresh_started_at = EXCLUDED.refresh_started_at WHERE bigquery_cache.refresh_in_progress = FALSE OR bigquery_cache.refresh_started_at < $4 RETURNING generation, fence_token",
    args: [key, sql, now, staleBefore, fenceToken],
  });
  if (!rows.length) return null;
  const row = rows[0] as { generation?: unknown; fence_token?: unknown };
  const generation = Number(row.generation);
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    row.fence_token !== fenceToken
  ) {
    throw new Error("Could not establish BigQuery cache refresh fence");
  }
  return { generation, fenceToken, refreshInProgress: true };
}

async function getL2(key: string): Promise<QueryResult | null> {
  try {
    const db = getDbExec();
    const { rows } = await db.execute({
      sql: "SELECT result FROM bigquery_cache WHERE key = $1 AND expires_at > $2",
      args: [key, new Date().toISOString()],
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
  fence: CacheFence,
): Promise<CacheFence | null> {
  try {
    const db = getDbExec();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    const serialized = JSON.stringify(result);
    const nextFence = {
      generation: fence.generation + 1,
      fenceToken: randomUUID(),
      refreshInProgress: false,
    } satisfies CacheFence;
    const { rows } = await db.execute({
      sql: "INSERT INTO bigquery_cache (key, sql, result, bytes_processed, created_at, expires_at, generation, fence_token, refresh_in_progress, refresh_started_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, NULL) ON CONFLICT (key) DO UPDATE SET sql = EXCLUDED.sql, result = EXCLUDED.result, bytes_processed = EXCLUDED.bytes_processed, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at, generation = EXCLUDED.generation, fence_token = EXCLUDED.fence_token WHERE bigquery_cache.generation = $9 AND bigquery_cache.fence_token IS NOT DISTINCT FROM $10 AND bigquery_cache.refresh_in_progress = FALSE RETURNING generation, fence_token",
      args: [
        key,
        sql,
        serialized,
        result.bytesProcessed ?? 0,
        now.toISOString(),
        expiresAt.toISOString(),
        nextFence.generation,
        nextFence.fenceToken,
        fence.generation,
        fence.fenceToken,
      ],
    });
    if (!rows.length) return null;
    const row = rows[0] as { generation?: unknown; fence_token?: unknown };
    const generation = Number(row.generation);
    if (
      generation !== nextFence.generation ||
      row.fence_token !== nextFence.fenceToken
    ) {
      throw new Error("BigQuery cache fence changed during write");
    }
    if (Math.random() < 0.01) {
      await db.execute({
        sql: "DELETE FROM bigquery_cache WHERE expires_at <= $1 AND refresh_in_progress = FALSE",
        args: [now.toISOString()],
      });
    }
    return { ...nextFence, generation };
  } catch (err) {
    console.warn("[bigquery] L2 cache write failed:", err);
    return null;
  }
}

async function finishForcedRefresh(
  key: string,
  sql: string,
  result: QueryResult,
  fence: CacheFence,
): Promise<CacheFence | null> {
  try {
    const db = getDbExec();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    const { rows } = await db.execute({
      sql: "UPDATE bigquery_cache SET sql = $2, result = $3, bytes_processed = $4, created_at = $5, expires_at = $6, generation = generation + 1, refresh_in_progress = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $7 AND fence_token = $8 AND refresh_in_progress = TRUE RETURNING generation, fence_token",
      args: [
        key,
        sql,
        JSON.stringify(result),
        result.bytesProcessed ?? 0,
        now.toISOString(),
        expiresAt.toISOString(),
        fence.generation,
        fence.fenceToken,
      ],
    });
    if (!rows.length) return null;
    const row = rows[0] as { generation?: unknown; fence_token?: unknown };
    const generation = Number(row.generation);
    if (
      !Number.isSafeInteger(generation) ||
      generation !== fence.generation + 1 ||
      row.fence_token !== fence.fenceToken
    ) {
      throw new Error("BigQuery cache refresh fence changed during commit");
    }
    return { ...fence, generation, refreshInProgress: false };
  } catch (err) {
    console.warn("[bigquery] Forced cache refresh write failed:", err);
    return null;
  }
}

async function releaseForcedRefresh(
  key: string,
  fence: CacheFence,
): Promise<void> {
  try {
    await getDbExec().execute({
      sql: "UPDATE bigquery_cache SET refresh_in_progress = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $2 AND fence_token = $3 AND refresh_in_progress = TRUE",
      args: [key, fence.generation, fence.fenceToken],
    });
  } catch (err) {
    console.warn("[bigquery] Forced cache refresh release failed:", err);
  }
}

async function waitForCacheRefresh(
  key: string,
  fence: CacheFence,
  signal?: AbortSignal,
): Promise<CacheFence> {
  let current = fence;
  while (current.refreshInProgress) {
    await waitForPollInterval(signal);
    current = await getCacheFence(key);
  }
  return current;
}

async function acquireForcedRefresh(
  key: string,
  sql: string,
  signal?: AbortSignal,
): Promise<{ fence: CacheFence } | { result: QueryResult }> {
  while (true) {
    throwIfAborted(signal);
    const fence = await beginForcedRefresh(key, sql);
    if (fence) return { fence };

    const activeFence = await getCacheFence(key);
    if (!activeFence.refreshInProgress) continue;

    const completedFence = await waitForCacheRefresh(key, activeFence, signal);
    if (completedFence.generation > activeFence.generation) {
      const result = await getL2(key);
      if (result) return { result };
    }
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
  let cacheFence: CacheFence | null = null;
  if (forceRefresh) {
    const acquired = await acquireForcedRefresh(cacheKey, cacheableSql, signal);
    if ("result" in acquired) return { ...acquired.result, cached: true };
    cacheFence = acquired.fence;
    l1Cache.delete(cacheKey);
  } else {
    try {
      cacheFence = await getCacheFence(cacheKey);
    } catch (err) {
      console.warn("[bigquery] Cache fence read failed; bypassing cache:", err);
    }
    if (cacheFence) {
      const l1Hit = getL1(
        cacheKey,
        cacheFence.generation,
        cacheFence.fenceToken,
      );
      if (l1Hit) {
        return { ...l1Hit, cached: true };
      }
      const l2Hit = await getL2(cacheKey);
      if (l2Hit) {
        setL1(cacheKey, l2Hit, cacheFence);
        return { ...l2Hit, cached: true };
      }
      if (cacheFence.refreshInProgress) {
        cacheFence = await waitForCacheRefresh(cacheKey, cacheFence, signal);
        const refreshed = await getL2(cacheKey);
        if (refreshed) {
          setL1(cacheKey, refreshed, cacheFence);
          return { ...refreshed, cached: true };
        }
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

    if (forceRefresh && cacheFence) {
      const persisted = await finishForcedRefresh(
        cacheKey,
        cacheableSql,
        result,
        cacheFence,
      );
      if (persisted) setL1(cacheKey, result, persisted);
      else await releaseForcedRefresh(cacheKey, cacheFence);
    } else if (cacheFence) {
      const l2Persistence = setL2(
        cacheKey,
        cacheableSql,
        result,
        cacheFence,
      ).then((persisted) => {
        if (persisted) setL1(cacheKey, result, persisted);
        return persisted;
      });
      const waitUntil = getRequestRunContext()?.waitUntil;
      if (waitUntil) waitUntil(l2Persistence);
      else await l2Persistence;
    }

    return result;
  } catch (error) {
    if (forceRefresh && cacheFence) {
      await releaseForcedRefresh(cacheKey, cacheFence);
    }
    throw error;
  }
}
