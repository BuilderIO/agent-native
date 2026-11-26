import { createHash, randomUUID } from "crypto";

import { lexAgentSql } from "@agent-native/core/agent-sql";
import { getDbExec } from "@agent-native/core/db";
import { retainRequestDbPoolScope } from "@agent-native/core/db/request-pool-context";

import { DASHBOARD_SQL_VALIDATION_TIMEOUT_MS } from "../../shared/dashboard-report-timeouts.js";
import type { SourceGenerationResult } from "../../shared/source-generation.js";
import type { BigQueryUsageAccounting } from "../../shared/sql-query-contract";
import type { BigQueryAgentReconciler } from "./bigquery-agent-budget";
import {
  admissionLapsed,
  bigQueryJobGate,
  conservativeBillableEstimate,
  OutsideAgentBigQueryRefusalError,
  type BigQueryBillableEstimate,
  type OutsideAgentBigQueryAdmission,
  type OutsideAgentBigQueryGate,
} from "./bigquery-agent-context";
import {
  newBigQueryJobUsage,
  persistBigQueryJobUsage,
  finalizeBigQueryJobUsage,
  readBigQueryJobBilling,
  type BigQueryJobBilling,
  type BigQueryJobUsage,
} from "./bigquery-usage";
import { resolveCredential } from "./credentials";
import {
  credentialCacheScope,
  requireRequestCredentialContext,
  type CredentialContext,
} from "./credentials-context";
import {
  getBigQueryAccess,
  getBigQueryAccessToken,
  raceWithAbort,
} from "./gcloud";
import { assertReadOnlySql } from "./read-only-sql";

async function getProjectContext(signal?: AbortSignal): Promise<{
  projectId: string;
  cacheScope: string;
  ctx: CredentialContext;
}> {
  const ctx = requireRequestCredentialContext("BIGQUERY_PROJECT_ID");
  const projectId = await raceWithAbort(
    resolveCredential("BIGQUERY_PROJECT_ID", ctx),
    signal,
  );
  throwIfAborted(signal);
  if (!projectId) throw new Error("BIGQUERY_PROJECT_ID not configured");
  return {
    projectId,
    cacheScope: cacheScopeForContext(ctx),
    ctx,
  };
}

function cacheScopeForContext(ctx: CredentialContext): string {
  return credentialCacheScope("BIGQUERY_PROJECT_ID", ctx);
}

export async function getBigQueryProjectId(
  signal?: AbortSignal,
): Promise<string> {
  const { projectId } = await getProjectContext(signal);
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
  /** Epoch milliseconds, as a string. */
  lastModifiedTime?: string;
  timePartitioning?: unknown;
  clustering?: unknown;
  externalDataConfiguration?: unknown;
  biglakeConfiguration?: unknown;
  cloneDefinition?: unknown;
  snapshotDefinition?: unknown;
  schema?: { fields?: BigQueryTableField[] };
}

export type BigQueryBackendReason =
  | "access_denied"
  | "invalid_query"
  | "not_found"
  | "quota_exceeded"
  | "rate_limited"
  | "backend_error"
  | "resources_exceeded"
  | "timeout"
  | "other";

const BIGQUERY_BACKEND_REASONS: Readonly<
  Record<string, BigQueryBackendReason>
> = {
  accessDenied: "access_denied",
  invalidQuery: "invalid_query",
  notFound: "not_found",
  quotaExceeded: "quota_exceeded",
  rateLimitExceeded: "rate_limited",
  jobRateLimitExceeded: "rate_limited",
  backendError: "backend_error",
  internalError: "backend_error",
  resourcesExceeded: "resources_exceeded",
  jobTimeout: "timeout",
};

const REPEATED_JOB_FAILURE_REASONS = new Set([
  "invalidQuery",
  "resourcesExceeded",
  "responseTooLarge",
]);

function safeBigQueryReason(reason: unknown): BigQueryBackendReason {
  return typeof reason === "string"
    ? (BIGQUERY_BACKEND_REASONS[reason] ?? "other")
    : "other";
}

function safeBigQueryReasonCode(reason: unknown): string | null {
  return typeof reason === "string" && /^[A-Za-z]{1,40}$/.test(reason)
    ? reason
    : null;
}

function rawBigQueryReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        errors?: Array<{ reason?: unknown }>;
        details?: Array<{ reason?: unknown }>;
      };
    };
    const reason =
      parsed.error?.errors?.find((entry) => entry.reason)?.reason ??
      parsed.error?.details?.find((entry) => entry.reason)?.reason;
    return typeof reason === "string" ? reason : null;
  } catch {
    // coercion-ok: an unparseable body has no reason, which callers read as unknown.
    return null;
  }
}

function bigQueryReasonFromResponse(body: string): BigQueryBackendReason {
  return safeBigQueryReason(rawBigQueryReason(body));
}

export class BigQueryBackendError extends Error {
  readonly operation: "submit" | "poll" | "job";
  readonly backendStatus: number | null;
  readonly backendReason: BigQueryBackendReason;
  readonly providerDetail!: string | null;

  constructor(
    operation: "submit" | "poll" | "job",
    backendStatus: number | null,
    backendReason: BigQueryBackendReason,
    providerDetail: string | null = null,
  ) {
    const operationLabel = operation === "submit" ? "API" : operation;
    super(
      `BigQuery ${operationLabel} error${backendStatus === null ? "" : ` ${backendStatus}`}: ${backendReason}`,
    );
    this.name = "BigQueryBackendError";
    this.operation = operation;
    this.backendStatus = backendStatus;
    this.backendReason = backendReason;
    Object.defineProperty(this, "providerDetail", {
      value: providerDetail,
      enumerable: false,
    });
  }
}

function bigQueryProviderDetailFromResponse(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: unknown;
        errors?: Array<{ message?: unknown }>;
      };
    };
    const detail =
      parsed.error?.message ??
      parsed.error?.errors?.find((entry) => typeof entry.message === "string")
        ?.message;
    return typeof detail === "string" ? detail.trim().slice(0, 4_000) : null;
  } catch {
    // coercion-ok: provider detail is optional; backend status and reason remain typed.
    return null;
  }
}

export class BigQueryQueryTimeoutError extends Error {
  readonly backendStatus = null;
  readonly backendReason = "timeout" as const;

  constructor() {
    super("BigQuery query timed out");
    this.name = "BigQueryQueryTimeoutError";
  }
}

export class BigQueryMaximumBytesBilledError extends Error {
  readonly backendStatus: number | null;
  readonly backendReason = "quota_exceeded" as const;

  constructor(backendStatus: number | null = null) {
    super("BigQuery query exceeded its configured billed-byte limit");
    this.name = "BigQueryMaximumBytesBilledError";
    this.backendStatus = backendStatus;
  }
}

export class BigQueryJobNotClaimedError extends Error {
  constructor() {
    super("BigQuery query was not allowed to start a job");
    this.name = "BigQueryJobNotClaimedError";
  }
}

// Only documented input/authorization rejections prove no job was created.
// Other 4xx reasons can describe already-created jobs; 5xx/transport errors are ambiguous.
// https://docs.cloud.google.com/bigquery/docs/error-messages
function isDefiniteJobSubmissionRejection(
  status: number,
  body: string,
): boolean {
  const expectedStatus: Readonly<Record<string, number>> = {
    invalid: 400,
    invalidQuery: 400,
    accessDenied: 403,
    billingNotEnabled: 403,
  };
  try {
    const parsed = JSON.parse(body) as {
      jobReference?: unknown;
      error?: { code?: unknown; errors?: unknown };
    };
    if (parsed.jobReference !== undefined) return false;
    if (parsed.error?.code !== undefined && parsed.error.code !== status)
      return false;
    const errors = parsed.error?.errors;
    return (
      Array.isArray(errors) &&
      errors.length > 0 &&
      errors.every(
        (entry: unknown) =>
          entry !== null &&
          typeof entry === "object" &&
          "reason" in entry &&
          typeof entry.reason === "string" &&
          expectedStatus[entry.reason] === status,
      )
    );
  } catch {
    // coercion-ok: Unparseable errors are not confirmed rejections; the caller keeps submission unknown and throws the provider error.
    return false;
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

/** A metadata read that BigQuery answered with an error status. */
export class BigQueryMetadataError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BigQueryMetadataError";
    this.status = status;
  }
}

export async function bigQueryGet<T>(
  url: string,
  signal?: AbortSignal,
  frozenToken?: string,
): Promise<T> {
  const token =
    frozenToken ?? (await getBigQueryAccessToken(signal ? { signal } : {}));
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal,
  });

  if (!res.ok) {
    const text = await untilAborted(res.text(), signal);
    let detail = "";
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      detail = parsed.error?.message ?? "";
    } catch {
      // coercion-ok: a non-JSON error body is reported verbatim in the error thrown below.
    }
    throw new BigQueryMetadataError(
      res.status,
      detail || `BigQuery metadata request failed (${res.status}): ${text}`,
    );
  }

  return (await untilAborted(res.json(), signal)) as T;
}

function untilAborted<T>(read: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return read;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    if (signal.aborted) {
      onAbort();
      read.catch(() => undefined);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    read.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
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
  return (await listBigQueryTablesPage(projectId, datasetId, limit, { signal }))
    .tables;
}

export async function listBigQueryTablesPage(
  projectId: string,
  datasetId: string,
  limit: number,
  { pageToken, signal }: { pageToken?: string; signal?: AbortSignal } = {},
): Promise<{
  tables: BigQueryTableSummary[];
  nextPageToken?: string;
  totalItems?: number;
}> {
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables`,
  );
  url.searchParams.set("maxResults", String(Math.min(limit, 1000)));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
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
    nextPageToken?: string;
    totalItems?: number;
  }>(url.toString(), signal);
  return {
    tables: (result.tables ?? []).map((table) => ({
      projectId: table.tableReference?.projectId,
      datasetId: table.tableReference?.datasetId,
      tableId: table.tableReference?.tableId,
      type: table.type,
      friendlyName: table.friendlyName,
      labels: table.labels,
    })),
    ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    ...(typeof result.totalItems === "number"
      ? { totalItems: result.totalItems }
      : {}),
  };
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
  { fresh = false, token }: { fresh?: boolean; token?: string } = {},
): Promise<BigQueryTableMetadata> {
  const key = `${cacheScopeForContext(requireRequestCredentialContext("BIGQUERY_PROJECT_ID"))}\n${ref.projectId}.${ref.datasetId}.${ref.tableId}`;
  const hit = tableMetadataCache.get(key);
  if (!fresh && token === undefined && hit && hit.expiresAt > Date.now()) {
    return hit.metadata;
  }
  const metadata = await bigQueryGet<BigQueryTableMetadata>(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(ref.projectId)}/datasets/${encodeURIComponent(ref.datasetId)}/tables/${encodeURIComponent(ref.tableId)}`,
    signal,
    token,
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

async function getProjectInfo(signal?: AbortSignal): Promise<{
  projectId: string;
  cacheScope: string;
  appEventsTable: BigQueryTableRef;
}> {
  const { projectId, cacheScope, ctx } = await getProjectContext(signal);
  return {
    projectId,
    cacheScope,
    appEventsTable: await getAppEventsTable(projectId, ctx, signal),
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
  signal?: AbortSignal,
): Promise<BigQueryTableRef> {
  const configured =
    (await raceWithAbort(
      resolveCredential("ANALYTICS_BIGQUERY_EVENTS_TABLE", ctx),
      signal,
    )) ||
    (await raceWithAbort(
      resolveCredential("BIGQUERY_APP_EVENTS_TABLE", ctx),
      signal,
    ));
  throwIfAborted(signal);
  return parseBigQueryTableRef(configured, fallbackProjectId);
}

async function resolveTablePlaceholder(
  sql: string,
  projectId?: string,
  appEventsTable?: BigQueryTableRef,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  if (!projectId || !appEventsTable) {
    const info = await getProjectInfo(signal);
    projectId ??= info.projectId;
    appEventsTable ??= info.appEventsTable;
  }
  throwIfAborted(signal);
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
const AGENT_SETTLEMENT_TIMEOUT_MS = 1_500;

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
  // Old cache rows may contain zero substituted for missing provider byte metadata.
  return `v3:${createHash("sha256")
    .update(`${cacheScope}\n${projectId}\n${sql}`)
    .digest("hex")}`;
}

const TIME_ZONE_LITERAL = /^(['"])[A-Za-z0-9_+\-/:]+\1$/;

function calendarDateIn(timeZone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * Replace explicit `CURRENT_DATE(...)` calls with their evaluated date literal.
 * BigQuery never serves a query that calls CURRENT_DATE from its result cache,
 * and the literal also rolls the app cache key over at the date boundary.
 * Bare names and nonliteral time zones are left for BigQuery to evaluate.
 */
export function renderCurrentDateLiterals(
  sql: string,
  now: Date = new Date(),
): string {
  const tokens = lexAgentSql(sql, { dialect: "bigquery" });
  let rendered = "";
  let cursor = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      token.kind !== "word" ||
      token.value !== "current_date" ||
      tokens[index - 1]?.text === "." ||
      tokens[index + 1]?.text !== "("
    ) {
      continue;
    }
    let end = token.end;
    let timeZone = "UTC";
    let consumed = 0;
    if (tokens[index + 1]?.text === "(") {
      const argument = tokens[index + 2];
      if (argument?.text === ")") {
        end = argument.end;
        consumed = 2;
      } else if (
        argument?.kind === "string" &&
        TIME_ZONE_LITERAL.test(argument.text) &&
        tokens[index + 3]?.text === ")"
      ) {
        timeZone = argument.text.slice(1, -1);
        end = tokens[index + 3].end;
        consumed = 3;
      } else {
        continue;
      }
    }
    const date = calendarDateIn(timeZone, now);
    if (!date) continue;
    rendered += `${sql.slice(cursor, token.start)}DATE '${date}'`;
    cursor = end;
    index += consumed;
  }
  return rendered + sql.slice(cursor);
}

function getQuerySnapshot(
  sql: string,
  now: Date,
  preserveCurrentDate: boolean,
) {
  const query = preserveCurrentDate ? sql : renderCurrentDateLiterals(sql, now);
  const tokens = lexAgentSql(query, { dialect: "bigquery" });
  let hasBareCurrentDate = false;
  let hasUnresolvedCall = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      token.kind !== "word" ||
      token.value !== "current_date" ||
      tokens[index - 1]?.text === "."
    ) {
      continue;
    }
    if (tokens[index + 1]?.text === "(") hasUnresolvedCall = true;
    else hasBareCurrentDate = true;
  }
  return {
    query,
    // Bare CURRENT_DATE and identifiers share a token; keep their SQL intact.
    cacheIdentity: hasBareCurrentDate
      ? `${query}\n/* agent-native-utc-date:${now.toISOString().slice(0, 10)} */`
      : query,
    hasUnresolvedCall,
  };
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
  return reusableCacheHit(entry.result);
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

async function getCacheFence(
  key: string,
  trace?: BigQueryQueryTrace,
): Promise<CacheFence> {
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
      if (trace) trace.staleLockCleared = true;
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

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

async function getL2(key: string): Promise<QueryResult | null> {
  const db = getDbExec();
  const { rows } = await db.execute({
    sql: "SELECT result, created_at FROM bigquery_cache WHERE key = $1 AND expires_at > $2",
    args: [key, new Date().toISOString()],
  });
  if (!rows.length) return null;
  const entry = rows[0] as { result: string; created_at?: unknown };
  const result = JSON.parse(entry.result) as QueryResult;
  // Rows cached before fetchedAt was persisted fall back to the row's
  // created_at, when the app cached the result; an unreadable one stays absent
  // rather than becoming "now".
  const fetchedAt =
    toIsoTimestamp(result.fetchedAt) ?? toIsoTimestamp(entry.created_at);
  if (fetchedAt === undefined) {
    const { fetchedAt: _unreadable, ...rest } = result;
    return reusableCacheHit(rest);
  }
  return reusableCacheHit({ ...result, fetchedAt });
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
        // The legacy non-null column uses -1 for unknown; JSON keeps usage optional.
        result.bytesProcessed ?? -1,
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
  trace?: BigQueryQueryTrace,
): Promise<CacheFence> {
  let current = fence;
  traceStage(trace, "waiting_for_lock");
  if (trace) trace.lockWaitStartedAt = performance.now();
  try {
    while (current.refreshInProgress) {
      await waitForPollInterval(signal);
      current = await getCacheFence(key, trace);
    }
  } finally {
    if (trace && trace.lockWaitStartedAt !== null) {
      trace.lockWaitMs += performance.now() - trace.lockWaitStartedAt;
      trace.lockWaitStartedAt = null;
    }
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
  trace?: BigQueryQueryTrace,
): Promise<{ fence: CacheFence } | { result: QueryResult }> {
  while (true) {
    throwIfAborted(signal);
    const activeFence = await getCacheFence(key, trace);
    const cached = await getL2(key);
    if (cached) return { result: cached };

    if (!activeFence.refreshInProgress) {
      const fence = await beginCacheQuery(key, sql, false);
      if (fence) return { fence };
      continue;
    }

    await waitForCacheRefresh(key, activeFence, signal, trace);
  }
}

function queryBytesProcessed(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

export interface QueryResult {
  usageAccounting?: BigQueryUsageAccounting;
  rows: Record<string, unknown>[];
  totalRows: number;
  schema: { name: string; type: string }[];
  /** Absent when the provider omits usage or returns an invalid byte count. */
  bytesProcessed?: number;
  cached?: boolean;
  truncated?: boolean;
  partial?: boolean;
  warnings?: Array<{ message: string; reason?: string }>;
  /**
   * When the app first received this result from BigQuery; preserved across
   * app-cache hits. Not when the warehouse computed it: a provider cache hit
   * can return an older BigQuery result.
   */
  fetchedAt?: string;
  /** BigQuery getQueryResults `cacheHit` for the original request; absent means unknown. */
  providerCacheHit?: boolean;
  /** Source generation read before the original request; kept on cache hits. */
  sourceGeneration?: SourceGenerationResult;
}

export interface RunQueryOptions {
  signal?: AbortSignal;
  forceRefresh?: boolean;
  maxBytesBilled?: number;
  /**
   * Generation of the tables the SQL reads, resolved before the query runs.
   * It joins the cache key, so a new generation never matches an old row, and
   * is stored with the result as read.
   */
  sourceGeneration?: SourceGenerationResult;
  /**
   * Lets a later identical call collect this query's job instead of running
   * it again. The job is named after the query and its caller, so a repeat
   * attaches to it while it started within the last hour; and once this signal
   * has aborted, an unfinished job is left running (still capped by
   * maxBytesBilled) instead of cancelled. Ignored on a forced refresh.
   */
  resumeAfter?: AbortSignal;
  claimJob?: () => Promise<boolean>;
  onUncachedResult?: () => void;
  trace?: BigQueryQueryTrace;
}

export type BigQueryQueryStage =
  | "preparing"
  | "checking_cache"
  | "waiting_for_lock"
  | "authenticating"
  | "submitting"
  | "checking_existing_job"
  | "polling"
  | "saving"
  | "finished";

export interface BigQueryJobAttempt {
  job: "new" | "existing";
  slot: number | null;
  collectable?: boolean;
  state?: string | null;
  ageSeconds?: number | null;
  sameQuery?: boolean | null;
  queryDifference?: {
    at: number;
    existingLength: number;
    submittedLength: number;
  };
  failureReason?: BigQueryBackendReason | null;
  failureCode?: string | null;
  tooOld?: boolean;
  unreadable?: boolean;
}

export interface BigQueryQueryTrace {
  stage: BigQueryQueryStage;
  startedAt: number;
  stageStartedAt: number;
  lockWaitMs: number;
  lockWaitStartedAt: number | null;
  staleLockCleared: boolean;
  jobs: BigQueryJobAttempt[];
  polls: number;
}

export function newBigQueryQueryTrace(): BigQueryQueryTrace {
  const now = performance.now();
  return {
    stage: "preparing",
    startedAt: now,
    stageStartedAt: now,
    lockWaitMs: 0,
    lockWaitStartedAt: null,
    staleLockCleared: false,
    jobs: [],
    polls: 0,
  };
}

function traceStage(
  trace: BigQueryQueryTrace | undefined,
  stage: BigQueryQueryStage,
): void {
  if (!trace || trace.stage === stage) return;
  trace.stage = stage;
  trace.stageStartedAt = performance.now();
}

/** How long a result read while its source generation was unknown is reused. */
export const UNKNOWN_SOURCE_GENERATION_REUSE_MS = 60 * 60_000;
// A resumable job is collected only while this young, so an attached result
// is never older than the app cache would serve.
const RESUMABLE_JOB_MAX_AGE_MS = UNKNOWN_SOURCE_GENERATION_REUSE_MS;
// A query whose resumable job can't be collected runs under the next of these
// IDs, so its replacement can still be collected; past the last, a random one.
const RESUMABLE_JOB_IDS = 3;

function sourceGenerationCacheKey(result: SourceGenerationResult): string {
  return result.status === "ok"
    ? result.generation
    : `unknown:${result.sources.map((source) => source.tableId).join(",")}`;
}

function reusableCacheHit(hit: QueryResult | null): QueryResult | null {
  if (!hit || hit.sourceGeneration?.status !== "unavailable") return hit;
  const fetchedAt = Date.parse(hit.fetchedAt ?? "");
  return Number.isFinite(fetchedAt) &&
    Date.now() - fetchedAt < UNKNOWN_SOURCE_GENERATION_REUSE_MS
    ? hit
    : null;
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
  pageToken?: string;
  jobComplete?: boolean;
  totalBytesProcessed?: string;
  cacheHit?: boolean;
  errorResult?: { message?: string; reason?: string };
  errors?: Array<{ message?: string; reason?: string }>;
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
  timeoutMs: number = CACHE_CANCEL_TIMEOUT_MS,
  bound?: AbortSignal,
): Promise<boolean> {
  const locationQuery = location
    ? `?location=${encodeURIComponent(location)}`
    : "";
  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs/${jobId}/cancel${locationQuery}`,
    {
      method: "POST",
      signal: bound
        ? AbortSignal.any([AbortSignal.timeout(timeoutMs), bound])
        : AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  return response.ok;
}

function resumableJobId(
  cacheKey: string,
  ownerEmail: string,
  maxBytesBilled: number,
  index: number,
  outsideAgent: boolean,
): string {
  return `agent_native_r_${createHash("sha256")
    .update(
      `${cacheKey}\n${ownerEmail}\n${maxBytesBilled}\n${index}${outsideAgent ? "\noutside-agent" : ""}`,
    )
    .digest("hex")}`;
}

function isDuplicateJobRejection(status: number, body: string): boolean {
  if (status !== 409) return false;
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: Array<{ reason?: unknown }> };
    };
    return (
      parsed.error?.errors?.some((entry) => entry.reason === "duplicate") ===
      true
    );
  } catch {
    // coercion-ok: an unparseable 409 is not a known duplicate; the caller throws it as a backend error.
    return false;
  }
}

/** BigQuery names a duplicate job as `project:LOCATION.jobId`. */
function duplicateJobLocation(body: string, jobId: string): string | undefined {
  return new RegExp(`:([A-Za-z0-9-]+)\\.${jobId}(?![A-Za-z0-9_-])`).exec(
    body,
  )?.[1];
}

/**
 * Whether the job a resumable submission collided with can be collected: it
 * ran this same SQL, started within RESUMABLE_JOB_MAX_AGE_MS, and has not
 * failed or been cancelled. Throws when the job can't be read, since that
 * doesn't show it can't be collected.
 */
async function resumableJobState(
  projectId: string,
  jobId: string,
  token: string,
  sql: string,
  knownLocation: string | undefined,
  signal?: AbortSignal,
): Promise<{
  collectable: boolean;
  repeatsFailure?: boolean;
  location: string | undefined;
  attempt: Omit<BigQueryJobAttempt, "slot">;
}> {
  const createdAfter = Date.now() - RESUMABLE_JOB_MAX_AGE_MS;
  try {
    let location = knownLocation;
    if (!location) {
      const listed = await findQueryJob(projectId, jobId, token, createdAfter);
      if (listed.kind === "unreadable") {
        throw new Error("BigQuery job location lookup failed");
      }
      location = listed.kind === "found" ? listed.location : undefined;
    }
    // Every job of the last hour is listed, so this one is older.
    if (!location)
      return {
        collectable: false,
        location: undefined,
        attempt: { job: "existing", collectable: false, tooOld: true },
      };
    const params = new URLSearchParams({
      fields:
        "jobReference,configuration(query(query)),status,statistics(creationTime)",
      location,
    });
    const timeout = AbortSignal.timeout(CACHE_CANCEL_TIMEOUT_MS);
    const response = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs/${jobId}?${params}`,
      {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new BigQueryBackendError(
        "job",
        response.status,
        bigQueryReasonFromResponse(text),
        bigQueryProviderDetailFromResponse(text),
      );
    }
    const job = (await response.json()) as {
      jobReference?: { jobId?: string; location?: string };
      configuration?: { query?: { query?: string } };
      status?: { state?: unknown; errorResult?: { reason?: unknown } };
      statistics?: { creationTime?: string };
    };
    const createdAt = Number(job.statistics?.creationTime);
    if (job.jobReference?.jobId !== jobId || !Number.isFinite(createdAt)) {
      throw new BigQueryBackendError("job", null, "other");
    }
    const existingQuery = job.configuration?.query?.query;
    const sameQuery =
      typeof existingQuery === "string" ? existingQuery === sql : null;
    const failed = Boolean(job.status?.errorResult);
    const recentSameQuery = sameQuery === true && createdAt >= createdAfter;
    const collectable = recentSameQuery && !failed;
    const failureReason = job.status?.errorResult?.reason;
    return {
      collectable,
      repeatsFailure:
        recentSameQuery &&
        typeof failureReason === "string" &&
        REPEATED_JOB_FAILURE_REASONS.has(failureReason),
      location: job.jobReference.location ?? location,
      attempt: {
        job: "existing",
        collectable,
        state: typeof job.status?.state === "string" ? job.status.state : null,
        ageSeconds: Math.round((Date.now() - createdAt) / 1000),
        sameQuery,
        ...(typeof existingQuery === "string" && !sameQuery
          ? {
              queryDifference: {
                at: firstDifference(existingQuery, sql),
                existingLength: existingQuery.length,
                submittedLength: sql.length,
              },
            }
          : {}),
        failureReason: failed
          ? safeBigQueryReason(job.status?.errorResult?.reason)
          : null,
        ...(failed
          ? {
              failureCode: safeBigQueryReasonCode(
                job.status?.errorResult?.reason,
              ),
            }
          : {}),
        ...(createdAt < createdAfter ? { tooOld: true } : {}),
      },
    };
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
}

function firstDifference(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length && a[index] === b[index]) index++;
  return index;
}

type BigQueryJobListing =
  | { kind: "found"; location: string | undefined }
  | { kind: "absent" }
  | { kind: "unreadable" };

type JobListPage = { jobIds: Map<string, string | undefined>; next?: string };

function readJobListPage(data: unknown): JobListPage | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const page = data as Record<string, unknown>;
  if (page.kind !== "bigquery#jobList") return null;
  if (
    page.unreachable !== undefined &&
    (!Array.isArray(page.unreachable) || page.unreachable.length > 0)
  ) {
    return null;
  }
  if (
    page.nextPageToken !== undefined &&
    (typeof page.nextPageToken !== "string" || !page.nextPageToken)
  ) {
    return null;
  }
  if (page.jobs !== undefined && !Array.isArray(page.jobs)) return null;
  const jobIds = new Map<string, string | undefined>();
  for (const entry of (page.jobs ?? []) as unknown[]) {
    const reference =
      entry && typeof entry === "object"
        ? (entry as { jobReference?: unknown }).jobReference
        : undefined;
    const id =
      reference && typeof reference === "object"
        ? (reference as { jobId?: unknown }).jobId
        : undefined;
    if (typeof id !== "string" || !id) return null;
    const location = (reference as { location?: unknown }).location;
    jobIds.set(
      id,
      typeof location === "string" && location ? location : undefined,
    );
  }
  return {
    jobIds,
    ...(typeof page.nextPageToken === "string"
      ? { next: page.nextPageToken }
      : {}),
  };
}

async function findQueryJob(
  projectId: string,
  jobId: string,
  token: string,
  createdAfter: number,
  callerSignal?: AbortSignal,
): Promise<BigQueryJobListing> {
  const timeout = AbortSignal.timeout(CACHE_CANCEL_TIMEOUT_MS);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeout])
    : timeout;
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      minCreationTime: String(createdAfter),
      maxResults: "1000",
      projection: "MINIMAL",
    });
    if (pageToken) params.set("pageToken", pageToken);
    let page: JobListPage | null;
    try {
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
      if (!response.ok) return { kind: "unreadable" };
      page = readJobListPage(await response.json());
    } catch (error) {
      throwIfAborted(callerSignal);
      if (!(error instanceof Error)) throw error;
      return { kind: "unreadable" };
    }
    if (!page) return { kind: "unreadable" };
    if (page.jobIds.has(jobId)) {
      return { kind: "found", location: page.jobIds.get(jobId) };
    }
    pageToken = page.next;
  } while (pageToken);
  return { kind: "absent" };
}

export function createBigQueryAgentReconciler(
  token: string,
  principal: { credentialScope: string; credentialFingerprint: string | null },
): BigQueryAgentReconciler {
  return {
    credentialScope: principal.credentialScope,
    credentialFingerprint: principal.credentialFingerprint,
    async observe(job, signal, { mayConfirmAbsence }) {
      const read = await readBigQueryJobBilling(job, token, signal);
      if (read.kind !== "not_found" || job.location) return read;
      const createdAt = Date.parse(job.createdAt);
      if (!Number.isFinite(createdAt)) return read;
      const listed = await findQueryJob(
        job.projectId,
        job.jobId,
        token,
        createdAt - 60_000,
        signal,
      );
      if (listed.kind === "found") {
        return listed.location
          ? readBigQueryJobBilling(
              { ...job, location: listed.location },
              token,
              signal,
            )
          : { kind: "unreadable" };
      }
      if (listed.kind === "unreadable") return { kind: "unreadable" };
      return mayConfirmAbsence ? { kind: "absent" } : read;
    },
  };
}

export async function createRequestBigQueryAgentReconciler(
  signal?: AbortSignal,
): Promise<BigQueryAgentReconciler> {
  const { token, principal } = await getBigQueryAccess(
    signal ? { signal } : {},
  );
  return createBigQueryAgentReconciler(token, {
    credentialScope: cacheScopeForContext(
      requireRequestCredentialContext("BIGQUERY_PROJECT_ID"),
    ),
    credentialFingerprint: principal,
  });
}

async function dryRunBillableEstimate(
  sql: string,
  signal?: AbortSignal,
): Promise<BigQueryBillableEstimate> {
  try {
    const result = await dryRunQuerySchema(sql, signal ? { signal } : {});
    if (result.error !== null) {
      return { status: "unavailable", reason: "dry_run_failed" };
    }
    return conservativeBillableEstimate(result);
  } catch (error) {
    throwIfAborted(signal);
    console.warn("[bigquery] Outside-agent dry-run estimate unavailable", {
      errorType: error instanceof Error ? error.name : "non_error",
    });
    return { status: "unavailable", reason: "dry_run_failed" };
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

const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;

function canonicalDecimal(text: string): string {
  const negative = text.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? text.slice(1) : text).split(
    ".",
  );
  const digits = whole.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  const sign = negative && (digits !== "0" || decimals) ? "-" : "";
  return `${sign}${digits}${decimals ? `.${decimals}` : ""}`;
}

function exactCell(value: string, upper: string): number | string {
  if (upper === "FLOAT" || upper === "FLOAT64") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (!DECIMAL_TEXT.test(value)) return value;
  const n = Number(value);
  if (!Number.isFinite(n) || String(n) !== canonicalDecimal(value)) {
    return value;
  }
  return Number.isInteger(n) && !Number.isSafeInteger(n) ? value : n;
}

function coerceCell(value: unknown, type: string, exact = false): unknown {
  if (value == null) return value;
  const upper = type.toUpperCase();
  if (NUMERIC_BQ_TYPES.has(upper) && typeof value === "string") {
    if (exact) return exactCell(value, upper);
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
  { exactNumbers = false }: { exactNumbers?: boolean } = {},
): Record<string, unknown>[] {
  const fieldAt = new Map(fields.map((field, index) => [index, field]));
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    row.f.forEach((cell, i) => {
      const field = fieldAt.get(i);
      if (!field) {
        throw new Error(
          "BigQuery returned a cell its result schema does not name.",
        );
      }
      obj[field.name] = coerceCell(cell.v, field.type, exactNumbers);
    });
    return obj;
  });
}

export interface DryRunQueryOptions {
  signal?: AbortSignal;
  wrapPreparationErrors?: boolean;
}

export class BigQueryDryRunPreparationError extends Error {
  /** True when the failure was missing BigQuery credentials or project. */
  readonly notConfigured: boolean;

  constructor(options: { notConfigured?: boolean } = {}) {
    super("BigQuery dry-run request preparation failed");
    this.name = "BigQueryDryRunPreparationError";
    this.notConfigured = options.notConfigured === true;
  }
}

const BIGQUERY_NOT_CONFIGURED_PATTERN =
  /GOOGLE_APPLICATION_CREDENTIALS_JSON not configured|BIGQUERY_PROJECT_ID|service account|Token exchange failed/i;

export interface DryRunQueryResult {
  error: string | null;
  timedOut?: true;
  /** HTTP status of a failed dry-run request; 400 means BigQuery rejected the SQL. */
  status?: number;
  reason?: string;
  /** Absent when BigQuery's dry-run response carried no schema. */
  schema?: { name: string; type: string }[];
  /** Absent when BigQuery's dry-run response carried no byte estimate. */
  totalBytesProcessed?: number;
  exactBytesProcessed?: number | "malformed";
  statementType?: string;
  referencedTables?: BigQueryReferencedTable[] | "malformed";
  referencedRoutines?: BigQueryReferencedRoutine[] | "malformed";
}

export interface BigQueryReferencedRoutine {
  projectId: string;
  datasetId: string;
  routineId: string;
}

export interface BigQueryReferencedTable {
  projectId: string;
  datasetId: string;
  tableId: string;
}

function exactByteCount(value: unknown): number | "malformed" | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^\d+$/.test(text)) return "malformed";
  const bytes = Number(text);
  return Number.isSafeInteger(bytes) ? bytes : "malformed";
}

function referencedTablesFrom(
  value: unknown,
): BigQueryReferencedTable[] | "malformed" | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return "malformed";
  const tables: BigQueryReferencedTable[] = [];
  for (const entry of value as Array<Record<string, unknown> | null>) {
    if (
      typeof entry?.projectId !== "string" ||
      typeof entry.datasetId !== "string" ||
      typeof entry.tableId !== "string"
    ) {
      return "malformed";
    }
    tables.push({
      projectId: entry.projectId,
      datasetId: entry.datasetId,
      tableId: entry.tableId,
    });
  }
  return tables;
}

function referencedRoutinesFrom(
  value: unknown,
): BigQueryReferencedRoutine[] | "malformed" | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return "malformed";
  const routines: BigQueryReferencedRoutine[] = [];
  for (const entry of value as Array<Record<string, unknown> | null>) {
    if (
      typeof entry?.projectId !== "string" ||
      typeof entry.datasetId !== "string" ||
      typeof entry.routineId !== "string"
    ) {
      return "malformed";
    }
    routines.push({
      projectId: entry.projectId,
      datasetId: entry.datasetId,
      routineId: entry.routineId,
    });
  }
  return routines;
}

async function readDryRunStatistics(
  res: Response,
  signal?: AbortSignal,
): Promise<
  Pick<
    DryRunQueryResult,
    | "schema"
    | "totalBytesProcessed"
    | "exactBytesProcessed"
    | "statementType"
    | "referencedTables"
    | "referencedRoutines"
  >
> {
  let job: {
    statistics?: {
      totalBytesProcessed?: string | number;
      query?: {
        totalBytesProcessed?: string | number;
        statementType?: unknown;
        referencedTables?: unknown;
        referencedRoutines?: unknown;
        schema?: { fields?: { name?: unknown; type?: unknown }[] };
      };
    };
  };
  try {
    job = await untilAborted(res.json(), signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    // coercion-ok: a dry run that succeeded without a readable body is validated SQL with no schema or byte estimate, and both fields stay absent.
    return {};
  }
  const stats = job?.statistics;
  const fields = stats?.query?.schema?.fields;
  const rawBytes =
    stats?.totalBytesProcessed ?? stats?.query?.totalBytesProcessed;
  const bytes = Number(rawBytes);
  const exactBytes = exactByteCount(rawBytes);
  const referencedTables = referencedTablesFrom(stats?.query?.referencedTables);
  const referencedRoutines = referencedRoutinesFrom(
    stats?.query?.referencedRoutines,
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
    ...(exactBytes !== undefined ? { exactBytesProcessed: exactBytes } : {}),
    ...(typeof stats?.query?.statementType === "string"
      ? { statementType: stats.query.statementType }
      : {}),
    ...(referencedTables !== undefined ? { referencedTables } : {}),
    ...(referencedRoutines !== undefined ? { referencedRoutines } : {}),
  };
}

/**
 * BigQuery's verdict on the SQL: null when it is valid, else the error. A dry
 * run that could not reach a verdict throws instead: a timeout, rejected
 * credentials, a rate limit, or a BigQuery server error.
 */
export async function dryRunQuery(
  sql: string,
  options: DryRunQueryOptions = {},
): Promise<string | null> {
  const result = await dryRunQuerySchema(sql, options);
  const status = result.status ?? 0;
  if (result.timedOut || status === 401 || status === 429 || status >= 500) {
    throw new Error(result.error ?? "BigQuery validation failed");
  }
  return result.error;
}

export async function dryRunQuerySchema(
  sql: string,
  options: DryRunQueryOptions = {},
): Promise<DryRunQueryResult> {
  if (options.signal?.aborted) {
    throw new Error("BigQuery validation was cancelled before it started");
  }
  let projectId: string;
  let resolvedSql: string;
  let token: string;
  try {
    const info = await getProjectInfo(options.signal);
    projectId = info.projectId;
    resolvedSql = await resolveTablePlaceholder(
      sql,
      projectId,
      info.appEventsTable,
      options.signal,
    );
    token = await getBigQueryAccessToken({ signal: options.signal });
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    if (options.wrapPreparationErrors) {
      throw new BigQueryDryRunPreparationError({
        notConfigured:
          error instanceof Error &&
          BIGQUERY_NOT_CONFIGURED_PATTERN.test(error.message),
      });
    }
    throw error;
  }
  return sendDryRun(
    { projectId, location: null, token },
    resolvedSql,
    options.signal,
  );
}

export async function dryRunFrozenQuery(
  access: FrozenBigQueryAccess,
  sql: string,
  signal: AbortSignal,
): Promise<DryRunQueryResult> {
  if (signal.aborted) {
    throw new Error("BigQuery validation was cancelled before it started");
  }
  return sendDryRun(access, sql, signal);
}

export interface FrozenBigQueryAccess {
  projectId: string;
  location: string | null;
  token: string;
}

async function sendDryRun(
  { projectId, location, token }: FrozenBigQueryAccess,
  resolvedSql: string,
  signal: AbortSignal | undefined,
): Promise<DryRunQueryResult> {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs`;

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
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
        ...(location ? { jobReference: { projectId, location } } : {}),
        configuration: {
          dryRun: true,
          query: { query: resolvedSql, useLegacySql: false },
        },
      }),
      signal: controller.signal,
    });
    const res = await Promise.race([request, timeout]);

    if (res.ok) {
      return {
        error: null,
        ...(await readDryRunStatistics(res, controller.signal)),
      };
    }

    const text = await untilAborted(res.text(), controller.signal);
    const reason = rawBigQueryReason(text);
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
      };
      const msg = parsed.error?.message?.trim();
      if (msg) {
        return {
          error: msg,
          status: res.status,
          ...(reason ? { reason } : {}),
        };
      }
      // coercion-ok: malformed BigQuery error bodies use the status fallback below.
    } catch {
      // Fall through
    }
    return {
      error: `BigQuery validation failed (${res.status})`,
      status: res.status,
      ...(reason ? { reason } : {}),
    };
  } catch (error) {
    if (timedOut) return { error: timeoutMessage, timedOut: true };
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
    if (timer !== undefined) clearTimeout(timer);
  }
}

class BigQueryDateRolloverError extends Error {}

export async function runQuery(
  sql: string,
  options: RunQueryOptions = {},
): Promise<QueryResult> {
  // Acquire the lease before a panel can stop awaiting this query. Finalization
  // may otherwise begin after its request has already closed the pool.
  let start: (() => void) | undefined;
  const work = new Promise<QueryResult>((resolve, reject) => {
    start = () => {
      void runQueryWithDateRetry(sql, options).then(resolve, reject);
    };
  });
  const retained = retainRequestDbPoolScope(work);
  start?.();
  return retained;
}

async function runQueryWithDateRetry(
  sql: string,
  options: RunQueryOptions,
): Promise<QueryResult> {
  try {
    return await runQueryAttempt(sql, options, false);
  } catch (error) {
    throwIfAborted(options.signal);
    if (!(error instanceof BigQueryDateRolloverError)) throw error;
    return runQueryAttempt(sql, options, true);
  }
}

async function runQueryAttempt(
  sql: string,
  options: RunQueryOptions,
  preserveCurrentDate: boolean,
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
  const { signal, trace } = options;
  throwIfAborted(signal);
  const { projectId, cacheScope, appEventsTable } =
    await getProjectInfo(signal);
  const resolvedSql = await resolveTablePlaceholder(
    sql,
    projectId,
    appEventsTable,
    signal,
  );
  const snapshot = getQuerySnapshot(
    resolvedSql,
    new Date(),
    preserveCurrentDate,
  );
  const cacheableSql = snapshot.query;
  const assertDateUnchanged = () => {
    throwIfAborted(signal);
    if (
      !preserveCurrentDate &&
      getQuerySnapshot(resolvedSql, new Date(), false).cacheIdentity !==
        snapshot.cacheIdentity
    ) {
      throw new BigQueryDateRolloverError();
    }
  };
  const checkedCacheHit = (result: QueryResult): QueryResult => {
    assertDateUnchanged();
    traceStage(trace, "finished");
    return { ...result, cached: true };
  };
  const cacheKey = getCacheKey(
    options.sourceGeneration
      ? `${snapshot.cacheIdentity}
${sourceGenerationCacheKey(options.sourceGeneration)}`
      : snapshot.cacheIdentity,
    projectId,
    cacheScope,
  );
  const forceRefresh = options.forceRefresh === true;
  let cacheFence: CacheFence | null = null;
  traceStage(trace, "checking_cache");
  // Unresolved zones can change date at a boundary the app cannot compute.
  if (!preserveCurrentDate && !snapshot.hasUnresolvedCall) {
    try {
      if (forceRefresh) {
        const acquired = await acquireForcedRefresh(
          cacheKey,
          cacheableSql,
          signal,
        );
        if ("result" in acquired) return checkedCacheHit(acquired.result);
        cacheFence = acquired.fence;
        l1Cache.delete(cacheKey);
      } else {
        // Validate shared generation before L1 so another instance's refresh invalidates local entries.
        const currentFence = await getCacheFence(cacheKey, trace);
        const l1Hit = getL1(
          cacheKey,
          currentFence.generation,
          currentFence.fenceToken,
        );
        if (l1Hit) {
          return checkedCacheHit(l1Hit);
        }
        const l2Hit = await getL2(cacheKey);
        if (l2Hit) {
          const hit = checkedCacheHit(l2Hit);
          setL1(cacheKey, l2Hit, currentFence);
          return hit;
        }
        const acquired = await acquireCacheQuery(
          cacheKey,
          cacheableSql,
          signal,
          trace,
        );
        if ("result" in acquired) return checkedCacheHit(acquired.result);
        cacheFence = acquired.fence;
        l1Cache.delete(cacheKey);
      }
    } catch (error) {
      if (
        error instanceof BigQueryDateRolloverError ||
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
  }

  let usage: BigQueryJobUsage | null = null;
  let usageStarted = false;
  let usageAccounting: BigQueryUsageAccounting | undefined;
  let completedResult: QueryResult | undefined;
  let jobId: string | null = null;
  let jobLocation: string | undefined;
  let jobCreatedAfter = 0;
  let jobSubmissionResponseReceived = false;
  let token: string | null = null;
  let cancelJob = false;
  let attachedJob = false;
  // Only where the app cache could also serve the result, so the SQL means
  // the same thing whenever in its window the job ran.
  const resumable =
    options.resumeAfter !== undefined &&
    !forceRefresh &&
    !preserveCurrentDate &&
    !snapshot.hasUnresolvedCall;
  let resumableId: string | null = null;
  let agentGate: OutsideAgentBigQueryGate | undefined;
  let agentAdmission: OutsideAgentBigQueryAdmission | undefined;
  try {
    if (options.claimJob && !(await options.claimJob())) {
      throw new BigQueryJobNotClaimedError();
    }
    traceStage(trace, "authenticating");
    agentGate = bigQueryJobGate();
    let principal: string | null = null;
    const accessOptions = signal ? { signal } : {};
    if (agentGate) {
      ({ token, principal } = await getBigQueryAccess(accessOptions));
    } else {
      token = await getBigQueryAccessToken(accessOptions);
    }
    assertDateUnchanged();
    const credentialContext = requireRequestCredentialContext(
      "BIGQUERY_PROJECT_ID",
    );
    let resumableIndex = 0;
    const nextResumableId = () =>
      resumable && resumableIndex < RESUMABLE_JOB_IDS
        ? resumableJobId(
            cacheKey,
            credentialContext.userEmail,
            maxBytesBilled,
            resumableIndex,
            agentGate !== undefined,
          )
        : null;
    resumableId = nextResumableId();
    // A resumable submission whose job already exists collects that job; when
    // it can't be collected, the query runs again under the next ID.
    for (;;) {
      traceStage(trace, "submitting");
      const slot = resumableId ? resumableIndex + 1 : null;
      const nextJobId =
        resumableId ?? `agent_native_${randomUUID().replace(/-/g, "")}`;
      if (agentGate) {
        jobId = null;
        usage = null;
        const estimateSql = cacheableSql;
        const sender = {
          credentialScope: cacheScopeForContext(credentialContext),
          credentialFingerprint: principal,
        };
        agentAdmission = await agentGate.admit({
          projectId,
          jobId: nextJobId,
          ...sender,
          exclusive: resumableId === null,
          capBytes: agentGate.jobCapFor(maxBytesBilled),
          estimate: () => dryRunBillableEstimate(estimateSql, signal),
          reconciler: createBigQueryAgentReconciler(token, sender),
        });
      }
      jobId = nextJobId;
      jobCreatedAfter = resumableId
        ? Date.now() - RESUMABLE_JOB_MAX_AGE_MS
        : Date.now();
      usage = newBigQueryJobUsage(projectId, jobId, credentialContext);
      usageStarted = await persistBigQueryJobUsage(usage);
      if (agentAdmission && admissionLapsed(agentAdmission)) {
        jobId = null;
        usage.submissionState = "rejected";
        throw new OutsideAgentBigQueryRefusalError({
          code: "admission_expired",
        });
      }
      const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/jobs`;
      const submissionTimeoutController = new AbortController();
      const submissionTimeoutAbortSignal = submissionTimeoutController.signal;
      const submissionTimeoutError = new BigQueryQueryTimeoutError();
      const submissionTimeout = setTimeout(() => {
        submissionTimeoutController.abort(submissionTimeoutError);
      }, JOB_SUBMISSION_TIMEOUT_MS);

      let insertedJob:
        | { jobReference?: { jobId?: string; location?: string } }
        | undefined;
      let duplicateResponse: string | undefined;
      try {
        const res = await fetch(url, {
          method: "POST",
          signal: signal
            ? AbortSignal.any([signal, submissionTimeoutAbortSignal])
            : submissionTimeoutAbortSignal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jobReference: { projectId, jobId },
            configuration: {
              ...(usage.workload === "alert"
                ? { labels: { agent_native_workload: "alert" } }
                : {}),
              query: {
                query: cacheableSql,
                useLegacySql: false,
                maximumBytesBilled: String(
                  agentAdmission?.reservedBytes ?? maxBytesBilled,
                ),
                ...(forceRefresh ? { useQueryCache: false } : {}),
              },
              // A job left running stops once it is too old to collect, so
              // it never runs beside its replacement.
              ...(jobId === resumableId
                ? { jobTimeoutMs: String(RESUMABLE_JOB_MAX_AGE_MS) }
                : {}),
            },
          }),
        });

        if (!res.ok) {
          usage.submissionState = "unknown";
          const text = await res.text();
          if (
            jobId === resumableId &&
            isDuplicateJobRejection(res.status, text)
          ) {
            duplicateResponse = text;
          } else {
            if (isMaximumBytesBilledError(res.status, text)) {
              usage.submissionState = "rejected";
              jobId = null;
              if (agentAdmission) await agentGate?.rejected(agentAdmission);
              throw new BigQueryMaximumBytesBilledError(res.status);
            }
            if (isDefiniteJobSubmissionRejection(res.status, text)) {
              usage.submissionState = "rejected";
              jobId = null;
              if (agentAdmission) await agentGate?.rejected(agentAdmission);
            }
            throw new BigQueryBackendError(
              "submit",
              res.status,
              bigQueryReasonFromResponse(text),
              bigQueryProviderDetailFromResponse(text),
            );
          }
        } else {
          insertedJob = (await res.json()) as {
            jobReference?: { jobId?: string; location?: string };
          };
        }
        if (submissionTimeoutController.signal.aborted) {
          throw submissionTimeoutError;
        }
      } catch (error) {
        if (
          submissionTimeoutController.signal.aborted &&
          submissionTimeoutController.signal.reason ===
            submissionTimeoutError &&
          (error === submissionTimeoutError ||
            (error instanceof Error && error.name === "AbortError"))
        ) {
          throw submissionTimeoutError;
        }
        throw error;
      } finally {
        clearTimeout(submissionTimeout);
      }
      if (duplicateResponse === undefined) {
        if (
          insertedJob?.jobReference?.jobId &&
          insertedJob.jobReference.jobId !== jobId
        ) {
          throw new Error("BigQuery did not accept the requested job ID");
        }
        jobLocation = insertedJob?.jobReference?.location;
        trace?.jobs.push({ job: "new", slot });
        break;
      }
      traceStage(trace, "checking_existing_job");
      const knownLocation = duplicateJobLocation(duplicateResponse, jobId);
      let existing: Awaited<ReturnType<typeof resumableJobState>>;
      try {
        existing = await resumableJobState(
          projectId,
          jobId,
          token,
          cacheableSql,
          knownLocation,
          signal,
        );
      } catch (error) {
        trace?.jobs.push(
          signal?.aborted
            ? { job: "existing", slot }
            : { job: "existing", slot, unreadable: true },
        );
        // Another call's job: it keeps running for a later call to collect.
        jobLocation = knownLocation;
        jobId = null;
        throw error;
      }
      trace?.jobs.push({ ...existing.attempt, slot });
      if (existing.collectable) {
        jobLocation = existing.location;
        attachedJob = true;
        break;
      }
      if (existing.repeatsFailure) {
        jobLocation = existing.location;
        jobId = null;
        throw new BigQueryBackendError(
          "job",
          null,
          existing.attempt.failureReason ?? "other",
        );
      }
      usage.location = existing.location;
      await finalizeBigQueryJobUsage(usage, token, usageStarted, signal);
      if (agentGate && agentAdmission) {
        const admission = agentAdmission;
        const bearer = token;
        await agentGate.settle(admission, () =>
          readBigQueryJobBilling(
            {
              projectId: admission.projectId,
              jobId: admission.jobId,
              location: existing.location ?? null,
            },
            bearer,
            AbortSignal.timeout(AGENT_SETTLEMENT_TIMEOUT_MS),
          ),
        );
      }
      resumableIndex += 1;
      resumableId = nextResumableId();
    }
    jobSubmissionResponseReceived = true;
    usage.submissionState = "accepted";
    usage.location = jobLocation;
    if (agentAdmission)
      await agentGate?.submitted(agentAdmission, "accepted", jobLocation);

    const locationQuery = jobLocation
      ? `?location=${encodeURIComponent(jobLocation)}`
      : "";
    const resultsUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}${locationQuery}`;
    let data: BigQueryGetQueryResultsResponse = { jobComplete: false };
    let attempts = 0;
    traceStage(trace, "polling");
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
          throw new BigQueryMaximumBytesBilledError(pollRes.status);
        }
        throw new BigQueryBackendError(
          "poll",
          pollRes.status,
          bigQueryReasonFromResponse(text),
          bigQueryProviderDetailFromResponse(text),
        );
      }
      data = (await pollRes.json()) as BigQueryGetQueryResultsResponse;
      attempts++;
      if (trace) trace.polls = attempts;
      if (
        data.jobComplete &&
        hasMaximumBytesBilledMessage(
          data.errors?.map((error) => error.message) ?? [],
        )
      ) {
        jobId = null;
        throw new BigQueryMaximumBytesBilledError();
      }
      // getQueryResults errors may be warnings; successful results include schema or totalRows.
      const failedJob =
        data.errorResult ??
        (data.errors?.length &&
        data.schema === undefined &&
        data.totalRows === undefined
          ? data.errors[0]
          : undefined);
      if (data.jobComplete && failedJob) {
        throw new BigQueryBackendError(
          "job",
          null,
          safeBigQueryReason(failedJob.reason),
          failedJob.message ?? null,
        );
      }
      if (!data.jobComplete && attempts < 60) {
        await waitForPollInterval(signal);
      }
    }

    if (!data.jobComplete) {
      cancelJob = true;
      throw new BigQueryQueryTimeoutError();
    }

    const fetchedAt = new Date().toISOString();
    const fields = data.schema?.fields ?? [];
    const schema = fields.map((f) => ({
      name: f.name,
      type: f.type,
    }));

    const rows = data.rows ? rowsToObjects(data.rows, fields) : [];
    const bytesProcessed = queryBytesProcessed(data.totalBytesProcessed);
    usage.bytesProcessed =
      typeof data.totalBytesProcessed === "string" &&
      /^\d+$/.test(data.totalBytesProcessed)
        ? data.totalBytesProcessed
        : null;
    usage.providerCacheHit =
      typeof data.cacheHit === "boolean" ? data.cacheHit : null;

    const reportedTotal = Number.parseInt(data.totalRows ?? "", 10);
    const hasReportedTotal =
      data.totalRows !== undefined &&
      Number.isSafeInteger(reportedTotal) &&
      reportedTotal >= 0;
    const totalRows = hasReportedTotal ? reportedTotal : rows.length;

    const result: QueryResult = {
      rows,
      totalRows,
      schema,
      bytesProcessed,
      fetchedAt,
      ...(options.sourceGeneration
        ? { sourceGeneration: options.sourceGeneration }
        : {}),
      ...(typeof data.cacheHit === "boolean"
        ? { providerCacheHit: data.cacheHit }
        : {}),
      ...(data.pageToken || !hasReportedTotal || totalRows > rows.length
        ? { truncated: true }
        : {}),
      ...(data.errors?.length
        ? {
            partial: true,
            warnings: data.errors.slice(0, 20).map((warning) => ({
              message: (
                warning.message ?? "BigQuery returned a query warning"
              ).slice(0, 4_000),
              ...(warning.reason ? { reason: warning.reason } : {}),
            })),
          }
        : {}),
    };

    // Cache the original job identity without implying a new billable job or
    // claiming that deferred finalization has already persisted its metadata.
    result.usageAccounting = {
      projectId: usage.projectId,
      jobId: usage.jobId,
      status: usageStarted ? "pending" : "unavailable",
    };

    traceStage(trace, "saving");
    let keptInCache = false;
    if (cacheFence) {
      if (result.partial) {
        await releaseCacheQuery(cacheKey, cacheFence);
      } else {
        const persisted = await finishCacheQuery(
          cacheKey,
          cacheableSql,
          result,
          cacheFence,
        );
        if (persisted) {
          setL1(cacheKey, result, persisted);
          keptInCache = true;
        } else await releaseCacheQuery(cacheKey, cacheFence);
      }
    }
    if (!keptInCache) options.onUncachedResult?.();

    // The cached copy stays unflagged: every read of it sets `cached: true`.
    completedResult = { ...result, cached: false };
    traceStage(trace, "finished");
  } catch (error) {
    if (agentAdmission && jobId && !jobSubmissionResponseReceived)
      await agentGate?.submitted(agentAdmission, "unknown");
    if (jobId) cancelJob = true;
    // Stopped for time, a resumable job keeps running for the next call.
    if (jobId !== null && jobId === resumableId && options.resumeAfter?.aborted)
      cancelJob = false;
    // Another call started a job this one attached to, and may collect it too.
    if (attachedJob) cancelJob = false;
    if (cancelJob && jobId && token) {
      if (!jobSubmissionResponseReceived) {
        const listed = await findQueryJob(
          projectId,
          jobId,
          token,
          jobCreatedAfter,
        );
        if (listed.kind === "found") jobLocation = listed.location;
        else if (listed.kind === "unreadable") {
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
  } finally {
    if (agentGate && agentAdmission && token) {
      const admission = agentAdmission;
      const bearer = token;
      await agentGate.settle(admission, () =>
        readBigQueryJobBilling(
          {
            projectId: admission.projectId,
            jobId: admission.jobId,
            location: jobLocation ?? null,
          },
          bearer,
          AbortSignal.timeout(AGENT_SETTLEMENT_TIMEOUT_MS),
        ),
      );
    }
    if (usage && token) {
      usage.location = jobLocation;
      if (usage.submissionState === "attempted")
        usage.submissionState = "unknown";
      usageAccounting = await finalizeBigQueryJobUsage(
        usage,
        token,
        usageStarted,
        signal,
      );
    }
  }
  return {
    ...completedResult,
    ...(usageAccounting ? { usageAccounting } : {}),
  };
}

export type BoundedBigQueryJobFailureCode =
  | "query_bytes_cap_exceeded"
  | "query_quota_exceeded"
  | "query_failed";

export type BoundedBigQueryJobOutcome =
  | {
      status: "completed";
      rows: Record<string, unknown>[];
      schema: { name: string; type: string }[];
      truncation: "rows" | "bytes" | null;
      location: string | undefined;
      providerCacheHit: boolean | null;
      bytesProcessed: number | null;
    }
  | {
      status: "not_submitted";
      reason: "deadline" | "admission_lapsed" | "day_changed";
    }
  | {
      status: "rejected";
      code: BoundedBigQueryJobFailureCode;
      message: string;
    }
  | {
      status: "failed";
      code: BoundedBigQueryJobFailureCode;
      message: string;
      location: string | undefined;
    }
  | {
      status: "uncertain";
      reason: "timeout" | "submission_unknown" | "poll_unreadable";
      location: string | undefined;
      cancelRequested: boolean;
      cancelConfirmed: boolean;
    };

const BOUNDED_JOB_LOOKUP_TIMEOUT_MS = 2_000;
const BOUNDED_JOB_CANCEL_TIMEOUT_MS = 2_000;
const BOUNDED_JOB_SERVER_TIMEOUT_MS = 10 * 60_000;
const QUOTA_REASONS = new Set([
  "quotaExceeded",
  "rateLimitExceeded",
  "jobRateLimitExceeded",
]);
const TERMINAL_JOB_REASONS = new Set(["jobBackendError", "jobInternalError"]);

function failureCode(
  reason: BigQueryBackendReason,
  message: string,
): BoundedBigQueryJobFailureCode {
  if (hasMaximumBytesBilledMessage([message]))
    return "query_bytes_cap_exceeded";
  return reason === "quota_exceeded" || reason === "rate_limited"
    ? "query_quota_exceeded"
    : "query_failed";
}

function parseResults(text: string): BigQueryGetQueryResultsResponse | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as BigQueryGetQueryResultsResponse)
      : null;
  } catch {
    // coercion-ok: null is "unreadable" here, and every caller turns it into a typed failure.
    return null;
  }
}

export async function runBoundedBigQueryJob(input: {
  projectId: string;
  jobId: string;
  location?: string | null;
  sql: string;
  maximumBytesBilled: number;
  token: string;
  signal: AbortSignal;
  cleanupSignal?: AbortSignal;
  maxRows: number;
  maxResultBytes: number;
  submitBy: number;
  admittedOnUtcDay: string;
  labels?: Record<string, string>;
}): Promise<BoundedBigQueryJobOutcome> {
  const { projectId, jobId, token, signal } = input;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const bounded = (ms: number) =>
    input.cleanupSignal
      ? AbortSignal.any([AbortSignal.timeout(ms), input.cleanupSignal])
      : AbortSignal.timeout(ms);
  let location: string | undefined = input.location ?? undefined;
  let cancelRequested = false;
  let cancelConfirmed = false;
  const uncertain = async (
    reason: "timeout" | "submission_unknown" | "poll_unreadable",
  ): Promise<BoundedBigQueryJobOutcome> => {
    if (reason !== "submission_unknown") {
      cancelRequested = true;
      try {
        cancelConfirmed = await cancelQueryJob(
          projectId,
          jobId,
          token,
          location,
          BOUNDED_JOB_CANCEL_TIMEOUT_MS,
          input.cleanupSignal,
        );
      } catch {
        // coercion-ok: a cancel that did not land is reported as requested and unconfirmed.
        console.warn("[bigquery] Bounded job cancellation was not confirmed.");
      }
    }
    return {
      status: "uncertain",
      reason,
      location,
      cancelRequested,
      cancelConfirmed,
    };
  };
  const failed = (
    code: BoundedBigQueryJobFailureCode,
    message: string,
  ): BoundedBigQueryJobOutcome => ({
    status: "failed",
    code,
    message: message.slice(0, 4_000),
    location,
  });
  const lookUp = async (): Promise<BigQueryJobBilling> => {
    const read = await readBigQueryJobBilling(
      { projectId, jobId, location: location ?? null },
      token,
      bounded(BOUNDED_JOB_LOOKUP_TIMEOUT_MS),
    );
    if (read.kind === "found") location = read.location ?? location;
    return read;
  };
  const submit = () =>
    fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/jobs`,
      {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify({
          jobReference: {
            projectId,
            jobId,
            ...(input.location ? { location: input.location } : {}),
          },
          configuration: {
            query: {
              query: input.sql,
              useLegacySql: false,
              maximumBytesBilled: String(input.maximumBytesBilled),
            },
            jobTimeoutMs: String(BOUNDED_JOB_SERVER_TIMEOUT_MS),
            ...(input.labels ? { labels: input.labels } : {}),
          },
        }),
      },
    );

  for (let attempt = 0; ; attempt++) {
    const onlySend = attempt === 0;
    if (signal.aborted) {
      return onlySend
        ? { status: "not_submitted", reason: "deadline" }
        : uncertain("timeout");
    }
    if (admissionLapsed(input)) {
      return onlySend
        ? { status: "not_submitted", reason: "admission_lapsed" }
        : uncertain("submission_unknown");
    }
    if (new Date().toISOString().slice(0, 10) !== input.admittedOnUtcDay) {
      return onlySend
        ? { status: "not_submitted", reason: "day_changed" }
        : uncertain("submission_unknown");
    }
    let res: Response;
    let text: string;
    try {
      res = await submit();
      text = await untilAborted(res.text(), signal);
    } catch (error) {
      if (signal.aborted) return uncertain("timeout");
      if (!(error instanceof Error)) throw error;
      const found = await lookUp();
      if (found.kind === "found") break;
      if (found.kind === "not_found" && onlySend) continue;
      return uncertain("submission_unknown");
    }
    if (res.ok) {
      let inserted: { jobReference?: { jobId?: string; location?: string } } =
        {};
      try {
        inserted = JSON.parse(text) as typeof inserted;
      } catch {
        // coercion-ok: an accepted insert with an unreadable body keeps the frozen location; polls confirm the job.
      }
      if (
        inserted.jobReference?.jobId !== undefined &&
        inserted.jobReference.jobId !== jobId
      ) {
        return uncertain("submission_unknown");
      }
      location = inserted.jobReference?.location ?? location;
      break;
    }
    if (isDuplicateJobRejection(res.status, text)) {
      location = duplicateJobLocation(text, jobId) ?? location;
      break;
    }
    const message =
      bigQueryProviderDetailFromResponse(text) ??
      `BigQuery refused the job (${res.status}).`;
    if (
      onlySend &&
      (isMaximumBytesBilledError(res.status, text) ||
        isDefiniteJobSubmissionRejection(res.status, text))
    ) {
      return {
        status: "rejected",
        code: isMaximumBytesBilledError(res.status, text)
          ? "query_bytes_cap_exceeded"
          : failureCode(bigQueryReasonFromResponse(text), message),
        message,
      };
    }
    if (signal.aborted) return uncertain("timeout");
    const found = await lookUp();
    if (found.kind === "found") break;
    if (
      onlySend &&
      found.kind === "not_found" &&
      QUOTA_REASONS.has(rawBigQueryReason(text) ?? "")
    ) {
      return { status: "rejected", code: "query_quota_exceeded", message };
    }
    return uncertain("submission_unknown");
  }

  const pageUrl = (pageToken?: string) => {
    const params = new URLSearchParams({
      maxResults: String(input.maxRows + 1),
      timeoutMs: "5000",
    });
    if (location) params.set("location", location);
    if (pageToken) params.set("pageToken", pageToken);
    return `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries/${encodeURIComponent(jobId)}?${params}`;
  };
  const settleUnreadablePoll = async (): Promise<
    BoundedBigQueryJobOutcome | "running"
  > => {
    const read = await lookUp();
    if (read.kind !== "found") return uncertain("poll_unreadable");
    if (read.state !== "DONE") return "running";
    if (read.errorReason !== null) {
      const message =
        read.errorMessage ??
        `BigQuery job ${jobId} failed (${read.errorReason}).`;
      return failed(
        failureCode(safeBigQueryReason(read.errorReason), message),
        message,
      );
    }
    return failed(
      "query_failed",
      `BigQuery job ${jobId} finished, but its results could not be read, so no rows are returned.`,
    );
  };
  let data: BigQueryGetQueryResultsResponse = { jobComplete: false };
  const rows: Record<string, unknown>[] = [];
  let bytes = 2;
  const keep = (
    page: BigQueryGetQueryResultsResponse["rows"],
  ): "rows" | "bytes" | null => {
    for (const row of rowsToObjects(page ?? [], data.schema?.fields ?? [], {
      exactNumbers: true,
    })) {
      if (rows.length === input.maxRows) return "rows";
      bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
      if (bytes > input.maxResultBytes) return "bytes";
      rows.push(row);
    }
    return null;
  };
  const incomplete = (total: number, seen: number) =>
    failed(
      "query_failed",
      `BigQuery reported ${total} rows for job ${jobId} but its result pages held ${seen}, so no rows are returned. Ask again.`,
    );
  let truncation: "rows" | "bytes" | null = null;
  try {
    while (!data.jobComplete) {
      if (signal.aborted) return uncertain("timeout");
      const res = await fetch(pageUrl(), { signal, headers });
      const text = await untilAborted(res.text(), signal);
      const parsed = res.ok ? parseResults(text) : null;
      if (!parsed) {
        const message =
          bigQueryProviderDetailFromResponse(text) ??
          `BigQuery job error (${res.status}).`;
        if (isMaximumBytesBilledError(res.status, text)) {
          return failed("query_bytes_cap_exceeded", message);
        }
        if (TERMINAL_JOB_REASONS.has(rawBigQueryReason(text) ?? "")) {
          return failed(
            "query_failed",
            `BigQuery job ${jobId} failed: ${message}`,
          );
        }
        const settled = await settleUnreadablePoll();
        if (settled !== "running") return settled;
        await waitForPollInterval(signal);
        continue;
      }
      data = parsed;
      const jobError =
        data.errorResult ??
        (data.jobComplete &&
        data.errors?.length &&
        data.schema === undefined &&
        data.totalRows === undefined
          ? data.errors[0]
          : undefined);
      if (data.jobComplete && jobError) {
        const message = jobError.message ?? "BigQuery job failed.";
        return failed(
          failureCode(safeBigQueryReason(jobError.reason), message),
          message,
        );
      }
    }
    const total = exactByteCount(data.totalRows);
    if (typeof total !== "number") {
      return failed(
        "query_failed",
        `BigQuery job ${jobId} finished without a readable row count, so no rows are returned. Ask again.`,
      );
    }
    let seen = data.rows?.length ?? 0;
    if (seen > total) return incomplete(total, seen);
    truncation = keep(data.rows);
    let pageToken = data.pageToken;
    const consumed = new Set<string>();
    while (truncation === null && seen < total) {
      if (!pageToken) return incomplete(total, seen);
      if (consumed.has(pageToken)) {
        return failed(
          "query_failed",
          `BigQuery repeated a result page for job ${jobId} before its ${total} rows were read, so no rows are returned. Ask again.`,
        );
      }
      consumed.add(pageToken);
      if (signal.aborted) return uncertain("timeout");
      const res = await fetch(pageUrl(pageToken), { signal, headers });
      const text = await untilAborted(res.text(), signal);
      const page = res.ok ? parseResults(text) : null;
      if (!page) {
        const message =
          bigQueryProviderDetailFromResponse(text) ??
          `BigQuery answered ${res.status}.`;
        return failed(
          failureCode(bigQueryReasonFromResponse(text), message),
          `BigQuery job ${jobId} finished, but a page of its results could not be read (${message}), so no rows are returned.`,
        );
      }
      if (
        page.totalRows !== undefined &&
        exactByteCount(page.totalRows) !== total
      ) {
        return failed(
          "query_failed",
          `BigQuery reported different row counts for job ${jobId} across its result pages, so no rows are returned. Ask again.`,
        );
      }
      const count = page.rows?.length ?? 0;
      if (count === 0) return incomplete(total, seen);
      seen += count;
      if (seen > total) return incomplete(total, seen);
      truncation = keep(page.rows);
      pageToken = page.pageToken;
    }
    if (truncation === null && seen !== total) return incomplete(total, seen);
  } catch {
    if (signal.aborted) return uncertain("timeout");
    return uncertain("poll_unreadable");
  }

  const fields = data.schema?.fields ?? [];
  const processed = exactByteCount(data.totalBytesProcessed);
  return {
    status: "completed",
    rows,
    schema: fields.map((field) => ({ name: field.name, type: field.type })),
    truncation,
    location,
    providerCacheHit: typeof data.cacheHit === "boolean" ? data.cacheHit : null,
    bytesProcessed: typeof processed === "number" ? processed : null,
  };
}
