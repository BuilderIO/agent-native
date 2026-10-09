import { createHash, randomUUID } from "crypto";

import { getDbExec } from "@agent-native/core/db";

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

export interface BigQueryTableField {
  name: string;
  type?: string;
  mode?: string;
  description?: string;
  fields?: BigQueryTableField[];
}

export interface BigQueryTableMetadata {
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
  schema?: { fields?: BigQueryTableField[] };
}

export class BigQueryMaximumBytesBilledError extends Error {
  constructor() {
    super("BigQuery query exceeded its configured billed-byte limit");
    this.name = "BigQueryMaximumBytesBilledError";
  }
}

function isMaximumBytesBilledError(status: number, responseText: string) {
  if (status !== 400) return false;
  if (hasMaximumBytesBilledMessage([responseText])) return true;
  try {
    const response = JSON.parse(responseText) as {
      error?: {
        message?: unknown;
        errors?: Array<{ message?: unknown }>;
      };
    };
    return hasMaximumBytesBilledMessage([
      response.error?.message,
      ...(response.error?.errors ?? []).map((error) => error.message),
    ]);
  } catch {
    // coercion-ok: Invalid bodies without the exact cap marker stay generic errors thrown by the caller.
    return false;
  }
}

function hasMaximumBytesBilledMessage(messages: readonly unknown[]) {
  return messages.some(
    (message) =>
      typeof message === "string" &&
      /query exceeded limit for bytes billed/i.test(message),
  );
}

export interface BigQueryTableSummary {
  projectId?: string;
  datasetId?: string;
  tableId?: string;
  type?: string;
  friendlyName?: string;
  labels?: Record<string, string>;
}

export async function bigQueryGet<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = "";
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      detail = parsed.error?.message ?? "";
    } catch {
      // coercion-ok: a non-JSON error body is reported verbatim in the error thrown below.
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

export function flattenBigQueryFields(
  fields: BigQueryTableField[] | undefined,
  prefix = "",
): Array<{
  name: string;
  type?: string;
  mode?: string;
  description?: string;
}> {
  if (!fields?.length) return [];
  return fields.flatMap((field) => {
    const name = prefix ? `${prefix}.${field.name}` : field.name;
    return [
      {
        name,
        type: field.type,
        mode: field.mode,
        description: field.description,
      },
      ...flattenBigQueryFields(field.fields, name),
    ];
  });
}

export async function listBigQueryTables(
  projectId: string,
  datasetId: string,
  limit: number,
  signal?: AbortSignal,
): Promise<BigQueryTableSummary[]> {
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables`,
  );
  url.searchParams.set("maxResults", String(Math.min(limit, 1000)));
  const result = await bigQueryGet<{
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
  }>(url.toString(), signal);
  return (result.tables ?? []).map((table) => ({
    projectId: table.tableReference?.projectId,
    datasetId: table.tableReference?.datasetId,
    tableId: table.tableReference?.tableId,
    type: table.type,
    friendlyName: table.friendlyName,
    labels: table.labels,
  }));
}

const TABLE_METADATA_TTL_MS = 10 * 60_000;
const MAX_TABLE_METADATA_ENTRIES = 300;
const tableMetadataCache = new Map<
  string,
  { metadata: BigQueryTableMetadata; expiresAt: number }
>();

/** Table metadata for schema search and failed-query recovery. Cached
 *  in-process for ten minutes per credential scope and table; only a
 *  successful fetch is cached. `fresh` skips the cached copy but still
 *  replaces it. */
export async function getBigQueryTableMetadata(
  ref: { projectId: string; datasetId: string; tableId: string },
  signal?: AbortSignal,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<BigQueryTableMetadata> {
  const key = `${credentialCacheScope("BIGQUERY_PROJECT_ID")}\n${ref.projectId}.${ref.datasetId}.${ref.tableId}`;
  const hit = tableMetadataCache.get(key);
  if (!fresh && hit && hit.expiresAt > Date.now()) return hit.metadata;
  const metadata = await bigQueryGet<BigQueryTableMetadata>(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(ref.projectId)}/datasets/${encodeURIComponent(ref.datasetId)}/tables/${encodeURIComponent(ref.tableId)}`,
    signal,
  );
  tableMetadataCache.delete(key);
  if (tableMetadataCache.size >= MAX_TABLE_METADATA_ENTRIES) {
    const oldest = tableMetadataCache.keys().next().value;
    if (oldest !== undefined) tableMetadataCache.delete(oldest);
  }
  tableMetadataCache.set(key, {
    metadata,
    expiresAt: Date.now() + TABLE_METADATA_TTL_MS,
  });
  return metadata;
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
const CACHE_CANCEL_TIMEOUT_MS = 5_000;
const JOB_SUBMISSION_TIMEOUT_MS = 10_000;

const l1Cache = new Map<string, L1Entry>();

interface CacheFence {
  generation: number;
  fenceToken: string | null;
  refreshInProgress: boolean;
  refreshForced: boolean;
}

function getCacheKey(
  sql: string,
  projectId: string,
  cacheScope: string,
): string {
  // Scope by caller as well as project so a warm server process cannot serve
  // cached warehouse results across tenants that happen to query the same
  // project/table names.
  // Isolate fenced cache rows from old instances that still write unconditionally.
  return `v2:${createHash("sha256")
    .update(`${cacheScope}\n${projectId}\n${sql}`)
    .digest("hex")}`;
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
      sql: "SELECT generation, fence_token, refresh_in_progress, refresh_forced, refresh_started_at FROM bigquery_cache WHERE key = $1",
      args: [key],
    });
    if (!rows.length) {
      return {
        generation: 0,
        fenceToken: null,
        refreshInProgress: false,
        refreshForced: false,
      };
    }

    const entry = rows[0] as {
      generation: unknown;
      fence_token: unknown;
      refresh_in_progress: unknown;
      refresh_forced: unknown;
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
    const refreshForced = entry.refresh_forced === true;
    if (!refreshInProgress) {
      return {
        generation,
        fenceToken,
        refreshInProgress: false,
        refreshForced,
      };
    }

    if (typeof entry.refresh_started_at !== "string") {
      throw new Error("BigQuery cache refresh timestamp is missing");
    }
    const refreshStartedAt = Date.parse(entry.refresh_started_at);
    if (!Number.isFinite(refreshStartedAt)) {
      throw new Error("BigQuery cache refresh timestamp is invalid");
    }
    if (Date.now() - refreshStartedAt <= STALE_REFRESH_MS) {
      return {
        generation,
        fenceToken,
        refreshInProgress: true,
        refreshForced,
      };
    }

    // A terminated request must not leave cache queries blocked indefinitely.
    const released = await db.execute({
      sql: "UPDATE bigquery_cache SET refresh_in_progress = FALSE, refresh_forced = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $2 AND fence_token IS NOT DISTINCT FROM $5 AND refresh_in_progress = TRUE AND refresh_started_at = $3 AND refresh_started_at < $4 RETURNING key",
      args: [
        key,
        generation,
        entry.refresh_started_at,
        new Date(Date.now() - STALE_REFRESH_MS).toISOString(),
        fenceToken,
      ],
    });
    if (released.rows.length) {
      return {
        generation,
        fenceToken,
        refreshInProgress: false,
        refreshForced: false,
      };
    }
  }
  throw new Error("BigQuery cache refresh state changed repeatedly");
}

async function beginCacheQuery(
  key: string,
  sql: string,
  forced: boolean,
): Promise<CacheFence | null> {
  const now = new Date().toISOString();
  const fenceToken = randomUUID();
  const staleBefore = new Date(Date.now() - STALE_REFRESH_MS).toISOString();
  const { rows } = await getDbExec().execute({
    sql: "INSERT INTO bigquery_cache (key, sql, result, bytes_processed, created_at, expires_at, generation, fence_token, refresh_in_progress, refresh_started_at, refresh_forced) VALUES ($1, $2, '{}', 0, $3, $3, 1, $5, TRUE, $3, $6) ON CONFLICT (key) DO UPDATE SET sql = EXCLUDED.sql, generation = bigquery_cache.generation + 1, fence_token = EXCLUDED.fence_token, refresh_in_progress = TRUE, refresh_started_at = EXCLUDED.refresh_started_at, refresh_forced = EXCLUDED.refresh_forced WHERE bigquery_cache.refresh_in_progress = FALSE OR bigquery_cache.refresh_started_at < $4 RETURNING generation, fence_token",
    args: [key, sql, now, staleBefore, fenceToken, forced],
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
  return {
    generation,
    fenceToken,
    refreshInProgress: true,
    refreshForced: forced,
  };
}

async function getL2(key: string): Promise<QueryResult | null> {
  const db = getDbExec();
  const { rows } = await db.execute({
    sql: "SELECT result FROM bigquery_cache WHERE key = $1 AND expires_at > $2",
    args: [key, new Date().toISOString()],
  });
  if (!rows.length) return null;
  const raw = (rows[0] as { result: string }).result;
  return JSON.parse(raw) as QueryResult;
}

async function finishCacheQuery(
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
      sql: "UPDATE bigquery_cache SET sql = $2, result = $3, bytes_processed = $4, created_at = $5, expires_at = $6, generation = generation + 1, refresh_in_progress = FALSE, refresh_forced = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $7 AND fence_token = $8 AND refresh_in_progress = TRUE RETURNING generation, fence_token",
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
    if (Math.random() < 0.01) {
      try {
        await db.execute({
          // Reclaim abandoned leases without deleting rows owned by active queries.
          sql: "DELETE FROM bigquery_cache WHERE (expires_at <= $1 AND refresh_in_progress = FALSE) OR (refresh_in_progress = TRUE AND refresh_started_at < $2)",
          args: [
            now.toISOString(),
            new Date(now.getTime() - STALE_REFRESH_MS).toISOString(),
          ],
        });
      } catch (err) {
        console.warn("[bigquery] Expired cache cleanup failed:", err);
      }
    }
    return {
      ...fence,
      generation,
      refreshInProgress: false,
      refreshForced: false,
    };
  } catch (err) {
    console.warn("[bigquery] Cache query write failed:", err);
    return null;
  }
}

async function releaseCacheQuery(
  key: string,
  fence: CacheFence,
): Promise<void> {
  try {
    await getDbExec().execute({
      sql: "UPDATE bigquery_cache SET refresh_in_progress = FALSE, refresh_forced = FALSE, refresh_started_at = NULL WHERE key = $1 AND generation = $2 AND fence_token = $3 AND refresh_in_progress = TRUE",
      args: [key, fence.generation, fence.fenceToken],
    });
  } catch (err) {
    console.warn("[bigquery] Cache query release failed:", err);
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
    const fence = await beginCacheQuery(key, sql, true);
    if (fence) return { fence };

    const activeFence = await getCacheFence(key);
    if (!activeFence.refreshInProgress) continue;

    const completedFence = await waitForCacheRefresh(key, activeFence, signal);
    if (
      activeFence.refreshForced &&
      completedFence.generation > activeFence.generation
    ) {
      const result = await getL2(key);
      if (result) return { result };
    }
  }
}

async function acquireCacheQuery(
  key: string,
  sql: string,
  signal?: AbortSignal,
): Promise<{ fence: CacheFence } | { result: QueryResult }> {
  while (true) {
    throwIfAborted(signal);
    const activeFence = await getCacheFence(key);
    const cached = await getL2(key);
    if (cached) return { result: cached };

    if (!activeFence.refreshInProgress) {
      const fence = await beginCacheQuery(key, sql, false);
      if (fence) return { fence };
      continue;
    }

    await waitForCacheRefresh(key, activeFence, signal);
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
  maxBytesBilled?: number;
}

interface BigQueryField {
  name: string;
  type: string;
  mode?: string;
  fields?: BigQueryField[];
}

interface BigQueryGetQueryResultsResponse {
  schema?: { fields?: BigQueryField[] };
  rows?: { f: { v: unknown }[] }[];
  totalRows?: string;
  jobComplete?: boolean;
  totalBytesProcessed?: string;
  errors?: Array<{ message?: string }>;
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
  location?: string,
): Promise<boolean> {
  const locationQuery = location
    ? `?location=${encodeURIComponent(location)}`
    : "";
  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs/${jobId}/cancel${locationQuery}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(CACHE_CANCEL_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  return response.ok;
}

async function findQueryJobLocation(
  projectId: string,
  jobId: string,
  token: string,
  createdAfter: number,
): Promise<string | undefined> {
  const signal = AbortSignal.timeout(CACHE_CANCEL_TIMEOUT_MS);
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      minCreationTime: String(createdAfter),
      maxResults: "1000",
      projection: "MINIMAL",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs?${params}`,
      {
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `BigQuery job location lookup failed (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      jobs?: { jobReference?: { jobId?: string; location?: string } }[];
      nextPageToken?: string;
    };
    const job = data.jobs?.find(
      (candidate) => candidate.jobReference?.jobId === jobId,
    );
    if (job?.jobReference?.location) return job.jobReference.location;
    pageToken = data.nextPageToken;
  } while (pageToken);
  return undefined;
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

export interface DryRunQueryResult {
  error: string | null;
  timedOut?: true;
  /** Absent when BigQuery's dry-run response carried no schema. */
  schema?: { name: string; type: string }[];
  /** Absent when BigQuery's dry-run response carried no byte estimate. */
  totalBytesProcessed?: number;
}

async function readDryRunStatistics(
  res: Response,
): Promise<Pick<DryRunQueryResult, "schema" | "totalBytesProcessed">> {
  let job: {
    statistics?: {
      totalBytesProcessed?: string | number;
      query?: {
        totalBytesProcessed?: string | number;
        schema?: { fields?: { name?: unknown; type?: unknown }[] };
      };
    };
  };
  try {
    job = await res.json();
  } catch {
    // coercion-ok: a dry run that succeeded without a readable body is validated SQL with no schema or byte estimate, and both fields stay absent.
    return {};
  }
  const stats = job?.statistics;
  const fields = stats?.query?.schema?.fields;
  const bytes = Number(
    stats?.totalBytesProcessed ?? stats?.query?.totalBytesProcessed,
  );
  return {
    ...(Array.isArray(fields)
      ? {
          schema: fields.flatMap((field) =>
            typeof field?.name === "string"
              ? [{ name: field.name, type: String(field.type ?? "") }]
              : [],
          ),
        }
      : {}),
    ...(Number.isFinite(bytes) ? { totalBytesProcessed: bytes } : {}),
  };
}

export async function dryRunQuery(
  sql: string,
  options: DryRunQueryOptions = {},
): Promise<string | null> {
  return (await dryRunQuerySchema(sql, options)).error;
}

export async function dryRunQuerySchema(
  sql: string,
  options: DryRunQueryOptions = {},
): Promise<DryRunQueryResult> {
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

    if (res.ok) return { error: null, ...(await readDryRunStatistics(res)) };

    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
      };
      const msg = parsed.error?.message?.trim();
      if (msg) return { error: msg };
      // coercion-ok: malformed BigQuery error bodies use the status fallback below.
    } catch {
      // Fall through
    }
    return { error: `BigQuery validation failed (${res.status})` };
  } catch (error) {
    if (timedOut) return { error: timeoutMessage, timedOut: true };
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
  const maxBytesBilled = options.maxBytesBilled ?? 750_000_000_000;
  if (
    !Number.isSafeInteger(maxBytesBilled) ||
    maxBytesBilled < 1 ||
    maxBytesBilled > 750_000_000_000
  ) {
    throw new Error(
      "BigQuery maximum bytes billed is outside the allowed range",
    );
  }
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
  try {
    if (forceRefresh) {
      const acquired = await acquireForcedRefresh(
        cacheKey,
        cacheableSql,
        signal,
      );
      if ("result" in acquired) return { ...acquired.result, cached: true };
      cacheFence = acquired.fence;
      l1Cache.delete(cacheKey);
    } else {
      // Validate shared generation before L1 so another instance's refresh invalidates local entries.
      cacheFence = await getCacheFence(cacheKey);
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
      const acquired = await acquireCacheQuery(cacheKey, cacheableSql, signal);
      if ("result" in acquired) return { ...acquired.result, cached: true };
      cacheFence = acquired.fence;
      l1Cache.delete(cacheKey);
    }
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    console.warn(
      "[bigquery] Cache coordination failed; running query without cache:",
      error,
    );
    cacheFence = null;
  }

  let jobId: string | null = null;
  let jobLocation: string | undefined;
  let jobCreatedAfter = 0;
  let jobSubmissionResponseReceived = false;
  let token: string | null = null;
  let cancelJob = false;
  try {
    token = await getAccessToken();
    throwIfAborted(signal);
    jobId = `agent_native_${randomUUID().replace(/-/g, "")}`;
    jobCreatedAfter = Date.now();
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs`;

    // Keep submission alive long enough to read the job location for cancellation.
    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(JOB_SUBMISSION_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobReference: { projectId, jobId },
        configuration: {
          query: {
            query: cacheableSql,
            useLegacySql: false,
            maximumBytesBilled: String(maxBytesBilled),
            ...(forceRefresh ? { useQueryCache: false } : {}),
          },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (isMaximumBytesBilledError(res.status, text)) {
        jobId = null;
        throw new BigQueryMaximumBytesBilledError();
      }
      throw new Error(`BigQuery API error ${res.status}: ${text}`);
    }

    const insertedJob = (await res.json()) as {
      jobReference?: { jobId?: string; location?: string };
    };
    if (
      insertedJob.jobReference?.jobId &&
      insertedJob.jobReference.jobId !== jobId
    ) {
      throw new Error("BigQuery did not accept the requested job ID");
    }
    jobLocation = insertedJob.jobReference?.location;
    jobSubmissionResponseReceived = true;

    const locationQuery = jobLocation
      ? `?location=${encodeURIComponent(jobLocation)}`
      : "";
    const resultsUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}${locationQuery}`;
    let data: BigQueryGetQueryResultsResponse = { jobComplete: false };
    let attempts = 0;
    while (!data.jobComplete && attempts < 60) {
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
        if (isMaximumBytesBilledError(pollRes.status, text)) {
          jobId = null;
          throw new BigQueryMaximumBytesBilledError();
        }
        throw new Error(`BigQuery poll error ${pollRes.status}: ${text}`);
      }
      data = (await pollRes.json()) as BigQueryGetQueryResultsResponse;
      attempts++;
      if (
        data.jobComplete &&
        hasMaximumBytesBilledMessage(
          data.errors?.map((error) => error.message) ?? [],
        )
      ) {
        jobId = null;
        throw new BigQueryMaximumBytesBilledError();
      }
      if (!data.jobComplete && attempts < 60) {
        await waitForPollInterval(signal);
      }
    }

    if (!data.jobComplete) {
      cancelJob = true;
      throw new Error("BigQuery query timed out after 60 seconds");
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

    if (cacheFence) {
      const persisted = await finishCacheQuery(
        cacheKey,
        cacheableSql,
        result,
        cacheFence,
      );
      if (persisted) setL1(cacheKey, result, persisted);
      else await releaseCacheQuery(cacheKey, cacheFence);
    }

    return result;
  } catch (error) {
    if (jobId) cancelJob = true;
    if (cancelJob && jobId && token) {
      if (!jobSubmissionResponseReceived) {
        try {
          jobLocation = await findQueryJobLocation(
            projectId,
            jobId,
            token,
            jobCreatedAfter,
          );
        } catch {
          console.warn(
            "[bigquery] Could not resolve job location before cancellation.",
          );
        }
      }
      try {
        const cancelled = await cancelQueryJob(
          projectId,
          jobId,
          token,
          jobLocation,
        );
        if (!cancelled) {
          console.warn(
            "[bigquery] BigQuery job cancellation was not confirmed.",
          );
        }
      } catch {
        console.warn("[bigquery] BigQuery job cancellation request failed.");
      }
    }
    if (cacheFence) {
      await releaseCacheQuery(cacheKey, cacheFence);
    }
    throw error;
  }
}
