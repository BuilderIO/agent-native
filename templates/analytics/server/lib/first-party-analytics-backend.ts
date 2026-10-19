import { randomUUID } from "node:crypto";

import {
  lexAgentSql,
  readAgentSqlQuery,
  rewriteAgentSqlQuerySources,
  type AgentSqlDialect,
  type AgentSqlToken,
} from "@agent-native/core/agent-sql";
import { getDbExec } from "@agent-native/core/db";
import { getOrgSetting } from "@agent-native/core/settings";

import type { SourceGenerationUnavailableReason } from "../../shared/source-generation.js";
import type {
  FirstPartyEventsModelSkipReason,
  FirstPartyEventsSource,
} from "../../shared/sql-query-contract.js";
import {
  BigQueryQueryTimeoutError,
  getBigQueryProjectId,
  runQuery,
  type BigQueryTableRef,
} from "./bigquery.js";
import { requireRequestCredentialContext } from "./credentials-context.js";
import { firstPartyEventPushdownPredicates } from "./first-party-analytics-pushdown.js";
import { validateAnalyticsSqlFunctions } from "./first-party-analytics-sql-policy.js";
import type { AnalyticsQueryResult } from "./first-party-analytics.js";
import {
  fetchGoogleWithRetry,
  getBigQueryAccessToken,
  raceWithAbort,
} from "./gcloud.js";
import {
  getScopedSettingRecord,
  putScopedSettingRecord,
} from "./scoped-settings.js";
import { resolveSourceGeneration } from "./source-generation.js";

export const FIRST_PARTY_ANALYTICS_BACKEND_SETTING =
  "first-party-analytics-backend";

export type FirstPartyAnalyticsSink = "postgres" | "dual" | "bigquery";

export interface FirstPartyAnalyticsBackendConfig {
  sink: FirstPartyAnalyticsSink;
  table: string | null;
  backfillCursor?: string | null;
  backfillCompleted?: boolean;
  /**
   * A deduplicated, warehouse-built model of the product events in `table`,
   * as project.dataset.table. Saving without it keeps the stored value.
   */
  modelTable?: string | null;
}

export interface ResolvedFirstPartyAnalyticsBackend extends FirstPartyAnalyticsBackendConfig {
  /**
   * Where `sink` came from. An unrecognized stored value still routes reads
   * and writes to Postgres, but it is not the same state as an absent setting
   * and must stay visible to whoever reports the backend.
   */
  sinkSetting: "absent" | "recognized" | "unrecognized";
}

export interface FirstPartyAnalyticsBackfillCursor {
  receivedAt: string;
  id: string;
}

export interface FirstPartyAnalyticsScope {
  userEmail: string;
  orgId: string | null;
  credentialScope?: "org";
}

/**
 * Stored panel SQL is valid PostgreSQL but has no BigQuery equivalent. This is
 * not a query failure: the panel cannot run for this scope until its SQL or the
 * scope's sink changes, so retrying is pointless and callers render an
 * explanatory state instead. `construct` names the exact syntax that has no
 * mapping, and is the only part safe to show a user.
 */
export class FirstPartyAnalyticsUnsupportedSqlError extends Error {
  readonly construct: string;

  constructor(construct: string, message: string) {
    super(message);
    this.name = "FirstPartyAnalyticsUnsupportedSqlError";
    this.construct = construct;
  }
}

interface FirstPartyAnalyticsBackendSetting {
  sink?: unknown;
  table?: unknown;
  backfillCursor?: unknown;
  backfillCompleted?: unknown;
  model?: unknown;
}

function settingModelTable(model: unknown): string | null {
  if (!model || typeof model !== "object") return null;
  const table = (model as { table?: unknown }).table;
  return typeof table === "string" && table.trim() ? table.trim() : null;
}

interface FirstPartyAnalyticsEventRow {
  id: string;
  publicKeyId: string;
  eventName: string;
  userId: string | null;
  anonymousId: string | null;
  userKey: string | null;
  sessionId: string | null;
  timestamp: string;
  eventDate: string | null;
  receivedAt: string;
  url: string | null;
  path: string | null;
  hostname: string | null;
  referrer: string | null;
  app: string | null;
  template: string | null;
  signedIn: string | null;
  properties: string;
  context: string;
  ownerEmail: string;
  orgId: string | null;
}

const TABLE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROJECT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]{4,61}[A-Za-z0-9]$/;
const BACKEND_CONFIG_CACHE_TTL_MS = 30_000;
const MAX_BACKFILL_BATCH_SIZE = 750;
const MAX_INSERT_BATCH_SIZE = 200;
const MAX_DEDICATED_INSERT_BATCH_SIZE = 500;
const MAX_DEDICATED_INSERT_CONCURRENCY = 4;
const MAX_INSERT_REQUEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_BACKFILL_LOOKBACK_DAYS = 60;
const MIN_BACKFILL_LOOKBACK_DAYS = 30;
const MAX_BACKFILL_LOOKBACK_DAYS = 60;
const DEFAULT_BACKFILL_SKIP_EVENTS = ["http.response"];
const MAX_BACKFILL_SKIP_EVENTS = 32;
const BACKFILL_LOOKBACK_DAYS_ENV = "ANALYTICS_BIGQUERY_BACKFILL_LOOKBACK_DAYS";
const BACKFILL_SKIP_EVENTS_ENV = "ANALYTICS_BIGQUERY_BACKFILL_SKIP_EVENTS";

export interface FirstPartyAnalyticsBackfillOptions {
  lookbackDays?: number;
  skipEventNames?: string[];
  now?: () => string;
  rangeStart?: FirstPartyAnalyticsBackfillCursor | null;
  rangeEnd?: FirstPartyAnalyticsBackfillCursor | null;
  rangeEndInclusive?: boolean;
}

export interface FirstPartyAnalyticsInsertOptions {
  maxRowsPerRequest?: number;
  maxConcurrentRequests?: number;
}

export interface FirstPartyAnalyticsInsertResult {
  acceptedIds: string[];
  rejectedIds: string[];
  error: string | null;
}

const backendConfigCache = new Map<
  string,
  { config: ResolvedFirstPartyAnalyticsBackend; expiresAt: number }
>();

function backendScopeKey(scope: FirstPartyAnalyticsScope): string {
  return `${scope.orgId ? `o:${scope.orgId}` : "u:"}${scope.userEmail}:${scope.credentialScope ?? "default"}`;
}

function parseTableRef(
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
        : [fallbackProjectId, "analytics", "first_party_analytics_events_raw"];

  if (
    !PROJECT_ID_PATTERN.test(projectId) ||
    !TABLE_ID_PATTERN.test(datasetId) ||
    !TABLE_ID_PATTERN.test(tableId)
  ) {
    throw new Error(
      "The first-party BigQuery table must be dataset.table or project.dataset.table",
    );
  }

  return {
    projectId,
    datasetId,
    tableId,
    fullyQualified: `${projectId}.${datasetId}.${tableId}`,
  };
}

function sinkSettingState(
  value: unknown,
): ResolvedFirstPartyAnalyticsBackend["sinkSetting"] {
  if (value === undefined || value === null) return "absent";
  return normalizeSink(value) === value ? "recognized" : "unrecognized";
}

function normalizeSink(value: unknown): FirstPartyAnalyticsSink {
  return value === "dual" || value === "bigquery" ? value : "postgres";
}

export async function getFirstPartyAnalyticsBackend(
  scope: FirstPartyAnalyticsScope,
  signal?: AbortSignal,
): Promise<ResolvedFirstPartyAnalyticsBackend> {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  const cacheKey = backendScopeKey(scope);
  const cached = backendConfigCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const settingRead =
    scope.credentialScope === "org"
      ? scope.orgId
        ? getOrgSetting(scope.orgId, FIRST_PARTY_ANALYTICS_BACKEND_SETTING)
        : null
      : getScopedSettingRecord(
          { email: scope.userEmail, orgId: scope.orgId },
          FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
        );
  const setting = (await raceWithAbort(
    Promise.resolve(settingRead),
    signal,
  )) as FirstPartyAnalyticsBackendSetting | null;
  const config = {
    sink: normalizeSink(setting?.sink),
    sinkSetting: sinkSettingState(setting?.sink),
    table: typeof setting?.table === "string" ? setting.table : null,
    backfillCursor:
      typeof setting?.backfillCursor === "string"
        ? setting.backfillCursor
        : null,
    backfillCompleted: setting?.backfillCompleted === true,
    modelTable: settingModelTable(setting?.model),
  };
  backendConfigCache.set(cacheKey, {
    config,
    expiresAt: Date.now() + BACKEND_CONFIG_CACHE_TTL_MS,
  });
  return config;
}

export async function saveFirstPartyAnalyticsBackend(
  scope: FirstPartyAnalyticsScope,
  config: FirstPartyAnalyticsBackendConfig,
): Promise<void> {
  const settingScope = { email: scope.userEmail, orgId: scope.orgId };
  const modelTable =
    config.modelTable !== undefined
      ? config.modelTable
      : settingModelTable(
          (
            (await getScopedSettingRecord(
              settingScope,
              FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
            )) as FirstPartyAnalyticsBackendSetting | null
          )?.model,
        );
  await putScopedSettingRecord(
    settingScope,
    FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
    {
      sink: config.sink,
      ...(modelTable ? { model: { table: modelTable } } : {}),
      ...(config.table ? { table: config.table } : {}),
      ...(config.backfillCursor !== undefined
        ? { backfillCursor: config.backfillCursor }
        : {}),
      ...(config.backfillCompleted !== undefined
        ? { backfillCompleted: config.backfillCompleted }
        : {}),
      updatedAt: new Date().toISOString(),
    },
  );
  backendConfigCache.delete(backendScopeKey(scope));
}

/**
 * Point first-party reads at an events model, or back at the raw table with
 * null. Only the model changes; the sink and backfill state stay as stored.
 */
export async function saveFirstPartyEventsModelTable(
  scope: FirstPartyAnalyticsScope,
  modelTable: string | null,
): Promise<void> {
  const settingScope = { email: scope.userEmail, orgId: scope.orgId };
  const stored = ((await getScopedSettingRecord(
    settingScope,
    FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
  )) ?? {}) as Record<string, unknown>;
  const { model: _previous, ...rest } = stored;
  await putScopedSettingRecord(
    settingScope,
    FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
    {
      ...rest,
      ...(modelTable ? { model: { table: modelTable } } : {}),
      updatedAt: new Date().toISOString(),
    },
  );
  backendConfigCache.delete(backendScopeKey(scope));
}

export function resetFirstPartyAnalyticsBackendCacheForTests(): void {
  backendConfigCache.clear();
}

export async function getFirstPartyAnalyticsTable(
  configuredTable?: string | null,
  signal?: AbortSignal,
): Promise<BigQueryTableRef> {
  const projectId = await getBigQueryProjectId(signal);
  return parseTableRef(configuredTable, projectId);
}

function tableName(table: BigQueryTableRef, suffix: string): string {
  return `${table.projectId}.${table.datasetId}.${table.tableId}${suffix}`;
}

function firstPartyAnalyticsRawTable(table: BigQueryTableRef): string {
  return table.fullyQualified;
}

export function firstPartyAnalyticsPhysicalTables(table: BigQueryTableRef): {
  events: string;
  dailyRollups: string;
  userDays: string;
} {
  return {
    events: tableName(table, "_query"),
    dailyRollups: tableName(table, "_daily_rollups"),
    userDays: tableName(table, "_user_days"),
  };
}

const FIRST_PARTY_ANALYTICS_RAW_SCHEMA = [
  ["id", "STRING"],
  ["public_key_id", "STRING"],
  ["event_name", "STRING"],
  ["user_id", "STRING"],
  ["anonymous_id", "STRING"],
  ["user_key", "STRING"],
  ["session_id", "STRING"],
  ["timestamp", "TIMESTAMP"],
  ["event_date", "DATE"],
  ["received_at", "TIMESTAMP"],
  ["url", "STRING"],
  ["path", "STRING"],
  ["hostname", "STRING"],
  ["referrer", "STRING"],
  ["app", "STRING"],
  ["template", "STRING"],
  ["signed_in", "STRING"],
  ["properties", "STRING"],
  ["context", "STRING"],
  ["owner_email", "STRING"],
  ["org_id", "STRING"],
] as const;

export const ONBOARDING_JOURNEY_EVENT_SOURCE_COLUMNS = [
  "id",
  "org_id",
  "received_at",
  "event_date",
  "event_name",
  "user_id",
  "user_key",
  "session_id",
  "timestamp",
  "path",
  "app",
  "template",
  "properties",
  "owner_email",
] as const;

export const ONBOARDING_JOURNEY_RESPONSE_IDENTITY_SOURCE_COLUMNS = [
  "id",
  "org_id",
  "received_at",
  "event_date",
  "timestamp",
  "event_name",
  "user_id",
  "user_key",
  "session_id",
  "app",
  "template",
  "properties",
  "owner_email",
] as const;

export type FirstPartyAnalyticsEventsProjection = "onboarding_journey";
export type FirstPartyAnalyticsEventSourceProjection =
  | FirstPartyAnalyticsEventsProjection
  | "onboarding_journey_response_identity";

export const FIRST_PARTY_ANALYTICS_BACKFILL_COLUMNS = [
  "id",
  "public_key_id",
  "event_name",
  "user_id",
  "anonymous_id",
  "user_key",
  "session_id",
  "timestamp",
  "event_date",
  "received_at",
  "url",
  "path",
  "hostname",
  "referrer",
  "app",
  "template",
  "signed_in",
  "properties",
  "context",
  "owner_email",
  "org_id",
] as const;

const FIRST_PARTY_ANALYTICS_QUERY_SCHEMA = FIRST_PARTY_ANALYTICS_RAW_SCHEMA;
const FIRST_PARTY_ANALYTICS_DAILY_ROLLUP_SCHEMA = [
  ["id", "STRING"],
  ["tenant_key", "STRING"],
  ["owner_email", "STRING"],
  ["org_id", "STRING"],
  ["event_date", "DATE"],
  ["event_name", "STRING"],
  ["app", "STRING"],
  ["template", "STRING"],
  ["event_count", "INT64"],
] as const;
const FIRST_PARTY_ANALYTICS_USER_DAYS_SCHEMA = [
  ["id", "STRING"],
  ["tenant_key", "STRING"],
  ["owner_email", "STRING"],
  ["org_id", "STRING"],
  ["event_date", "DATE"],
  ["user_key", "STRING"],
] as const;

function sqlList(values: readonly string[]): string {
  return values.map((value) => sqlLiteral(value)).join(", ");
}

function firstPartyEventRowToBigQuery(
  row: FirstPartyAnalyticsEventRow | Record<string, unknown>,
): Record<string, unknown> {
  const record = row as Record<string, unknown>;
  const value = (camel: string, snake: string): unknown =>
    record[camel] ?? record[snake];
  return {
    id: value("id", "id"),
    public_key_id: value("publicKeyId", "public_key_id"),
    event_name: value("eventName", "event_name"),
    user_id: value("userId", "user_id"),
    anonymous_id: value("anonymousId", "anonymous_id"),
    user_key: value("userKey", "user_key"),
    session_id: value("sessionId", "session_id"),
    timestamp: value("timestamp", "timestamp"),
    event_date: value("eventDate", "event_date"),
    received_at: value("receivedAt", "received_at"),
    url: value("url", "url"),
    path: value("path", "path"),
    hostname: value("hostname", "hostname"),
    referrer: value("referrer", "referrer"),
    app: value("app", "app"),
    template: value("template", "template"),
    signed_in: value("signedIn", "signed_in"),
    properties: value("properties", "properties") ?? "{}",
    context: value("context", "context") ?? "{}",
    owner_email: value("ownerEmail", "owner_email"),
    org_id: value("orgId", "org_id"),
  };
}

interface InsertBatchResult {
  rejectedIndexes: number[];
  error: string | null;
}

interface InsertPayloadResult {
  acceptedRows: Record<string, unknown>[];
  rejectedRows: Record<string, unknown>[];
  error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function insertBatch(
  table: BigQueryTableRef,
  token: string,
  rows: Record<string, unknown>[],
): Promise<InsertBatchResult> {
  const response = await fetchGoogleWithRetry(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${table.projectId}/datasets/${table.datasetId}/tables/${table.tableId}/insertAll`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        skipInvalidRows: true,
        ignoreUnknownValues: false,
        rows: rows.map((row) => ({
          insertId: typeof row.id === "string" ? row.id : undefined,
          json: row,
        })),
      }),
    },
    "BigQuery insertAll",
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `BigQuery event insert failed (${response.status}): ${text}`,
    );
  }
  const result = (await response.json()) as {
    insertErrors?: Array<{
      index?: number;
      errors?: Array<{ message?: string }>;
    }>;
  };
  const insertErrors = Array.isArray(result.insertErrors)
    ? result.insertErrors
    : [];
  if (!insertErrors.length) return { rejectedIndexes: [], error: null };

  const rejectedIndexes = insertErrors.map((entry) => entry.index);
  if (
    rejectedIndexes.some(
      (index) =>
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= rows.length,
    ) ||
    new Set(rejectedIndexes).size !== rejectedIndexes.length
  ) {
    throw new Error("BigQuery returned row errors without valid row indexes");
  }

  const detail = insertErrors
    .flatMap((entry) => entry.errors ?? [])
    .map((entry) => entry.message)
    .filter((message): message is string => Boolean(message))
    .slice(0, 3)
    .join("; ");
  return {
    rejectedIndexes: rejectedIndexes.filter(
      (index): index is number => typeof index === "number",
    ),
    error: `BigQuery rejected ${insertErrors.length} event row(s)${detail ? `: ${detail}` : ""}`,
  };
}

function boundedInsertOption(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Math.min(value, maximum);
}

async function insertPayloadRows(
  table: BigQueryTableRef,
  token: string,
  payloadRows: Record<string, unknown>[],
  options: FirstPartyAnalyticsInsertOptions = {},
): Promise<InsertPayloadResult> {
  const maxRowsPerRequest = boundedInsertOption(
    options.maxRowsPerRequest,
    MAX_INSERT_BATCH_SIZE,
    MAX_DEDICATED_INSERT_BATCH_SIZE,
    "maxRowsPerRequest",
  );
  const maxConcurrentRequests = boundedInsertOption(
    options.maxConcurrentRequests,
    1,
    MAX_DEDICATED_INSERT_CONCURRENCY,
    "maxConcurrentRequests",
  );
  const batches: Record<string, unknown>[][] = [];
  const encoder = new TextEncoder();
  let currentBatch: Record<string, unknown>[] = [];
  let currentBytes = 2;
  for (const row of payloadRows) {
    const rowBytes = encoder.encode(
      JSON.stringify({
        insertId: typeof row.id === "string" ? row.id : undefined,
        json: row,
      }),
    ).byteLength;
    if (rowBytes + 2 > MAX_INSERT_REQUEST_BYTES) {
      throw new Error(
        "A first-party Analytics row exceeds the BigQuery request limit",
      );
    }
    if (
      currentBatch.length > 0 &&
      (currentBatch.length >= maxRowsPerRequest ||
        currentBytes + rowBytes + 1 > MAX_INSERT_REQUEST_BYTES)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 2;
    }
    currentBatch.push(row);
    currentBytes += rowBytes + 1;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  let nextBatch = 0;
  const rejectedRows = new Set<Record<string, unknown>>();
  const rejectionMessages: string[] = [];
  const worker = async (): Promise<void> => {
    while (true) {
      const batchIndex = nextBatch;
      nextBatch += 1;
      const batch = batches[batchIndex];
      if (!batch) return;
      const result = await insertBatch(table, token, batch);
      for (const index of result.rejectedIndexes) {
        rejectedRows.add(batch[index]!);
      }
      if (result.error) rejectionMessages.push(result.error);
    }
  };

  const workerResults = await Promise.allSettled(
    Array.from(
      { length: Math.min(maxConcurrentRequests, batches.length) },
      () => worker(),
    ),
  );
  const failedWorker = workerResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failedWorker) throw failedWorker.reason;

  return {
    acceptedRows: payloadRows.filter((row) => !rejectedRows.has(row)),
    rejectedRows: payloadRows.filter((row) => rejectedRows.has(row)),
    error: rejectionMessages[0] ?? null,
  };
}

function payloadRowId(row: Record<string, unknown>): string {
  if (typeof row.id !== "string" || !row.id) {
    throw new Error("First-party Analytics BigQuery row is missing its id");
  }
  return row.id;
}

async function reconcileInsertedPayloadRows(
  table: BigQueryTableRef,
  payloadRows: Record<string, unknown>[],
): Promise<InsertPayloadResult> {
  const ids = payloadRows.map(payloadRowId);
  const nonce = randomUUID();
  const result = await runQuery(
    `SELECT id FROM \`${table.fullyQualified}\`
      WHERE id IN (${ids.map(sqlLiteral).join(", ")})
        AND ${sqlLiteral(nonce)} IS NOT NULL`,
  );
  const acceptedIds = new Set(
    result.rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string"),
  );
  return {
    acceptedRows: payloadRows.filter((row) =>
      acceptedIds.has(payloadRowId(row)),
    ),
    rejectedRows: payloadRows.filter(
      (row) => !acceptedIds.has(payloadRowId(row)),
    ),
    error: null,
  };
}

async function insertPayloadRowsWithResults(
  table: BigQueryTableRef,
  token: string,
  payloadRows: Record<string, unknown>[],
  options: FirstPartyAnalyticsInsertOptions = {},
): Promise<InsertPayloadResult> {
  try {
    return await insertPayloadRows(table, token, payloadRows, options);
  } catch (error) {
    let reconciled: InsertPayloadResult;
    try {
      reconciled = await reconcileInsertedPayloadRows(table, payloadRows);
    } catch {
      throw error;
    }
    return {
      ...reconciled,
      error: errorMessage(error),
    };
  }
}

export async function createFirstPartyAnalyticsInserter(
  configuredTable?: string | null,
  options: FirstPartyAnalyticsInsertOptions = {},
): Promise<
  (
    rows: Array<FirstPartyAnalyticsEventRow | Record<string, unknown>>,
  ) => Promise<number>
> {
  requireRequestCredentialContext("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const table = await getFirstPartyAnalyticsTable(configuredTable);
  return async (rows) => {
    if (!rows.length) return 0;
    const token = await getBigQueryAccessToken({ preferServiceAccount: true });
    const payloadRows = rows.map(firstPartyEventRowToBigQuery);
    const result = await insertPayloadRowsWithResults(
      table,
      token,
      payloadRows,
      options,
    );
    if (result.rejectedRows.length) {
      throw new Error(
        result.error ??
          `BigQuery rejected ${result.rejectedRows.length} event row(s)`,
      );
    }
    return result.acceptedRows.length;
  };
}

async function insertFirstPartyAnalyticsRowsWithResultsInternal(
  rows: Array<FirstPartyAnalyticsEventRow | Record<string, unknown>>,
  configuredTable?: string | null,
  options: FirstPartyAnalyticsInsertOptions = {},
): Promise<InsertPayloadResult> {
  if (!rows.length) {
    return { acceptedRows: [], rejectedRows: [], error: null };
  }
  requireRequestCredentialContext("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const [table, token] = await Promise.all([
    getFirstPartyAnalyticsTable(configuredTable),
    getBigQueryAccessToken({ preferServiceAccount: true }),
  ]);
  const payloadRows = rows.map(firstPartyEventRowToBigQuery);
  return insertPayloadRowsWithResults(table, token, payloadRows, options);
}

export async function insertFirstPartyAnalyticsRowsWithResults(
  rows: Array<FirstPartyAnalyticsEventRow | Record<string, unknown>>,
  configuredTable?: string | null,
  options: FirstPartyAnalyticsInsertOptions = {},
): Promise<FirstPartyAnalyticsInsertResult> {
  const result = await insertFirstPartyAnalyticsRowsWithResultsInternal(
    rows,
    configuredTable,
    options,
  );
  return {
    acceptedIds: result.acceptedRows.map(payloadRowId),
    rejectedIds: result.rejectedRows.map(payloadRowId),
    error: result.error,
  };
}

export async function insertFirstPartyAnalyticsRows(
  rows: Array<FirstPartyAnalyticsEventRow | Record<string, unknown>>,
  configuredTable?: string | null,
  options: FirstPartyAnalyticsInsertOptions = {},
): Promise<number> {
  const result = await insertFirstPartyAnalyticsRowsWithResults(
    rows,
    configuredTable,
    options,
  );
  if (result.rejectedIds.length) {
    throw new Error(
      result.error ??
        `BigQuery rejected ${result.rejectedIds.length} event row(s)`,
    );
  }
  return result.acceptedIds.length;
}

function sqlLiteral(value: string | null): string {
  if (value === null) return "NULL";
  const escapes: Record<string, string> = {
    "\\": "\\\\",
    "'": "\\'",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\b": "\\b",
    "\f": "\\f",
  };
  return `'${value.replace(
    /[\\'\x00-\x1f\x7f]/g,
    (character) =>
      escapes[character] ??
      `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  )}'`;
}

function normalizePostgresSql(sql: string): string {
  let cursor = 0;
  let result = "";
  const tokens = lexAgentSql(sql, { dialect: "postgres" });
  const typedLiteralPrefixes = new Set([
    "date",
    "time",
    "datetime",
    "timestamp",
  ]);
  for (const [index, token] of tokens.entries()) {
    if (token.kind === "string" && !token.text.startsWith("'")) {
      const prefix = token.text.startsWith("$")
        ? "dollar-quoted"
        : token.text[0];
      throw new FirstPartyAnalyticsUnsupportedSqlError(
        `a PostgreSQL ${prefix} string literal`,
        `First-party BigQuery query does not support PostgreSQL ${prefix} string literals`,
      );
    }
    const previous = tokens[index - 1];
    if (
      token.kind === "string" &&
      previous?.kind === "word" &&
      previous.end === token.start
    ) {
      if (!typedLiteralPrefixes.has(previous.text.toLowerCase())) {
        throw new FirstPartyAnalyticsUnsupportedSqlError(
          "a string literal without a preceding separator",
          "First-party BigQuery query requires a separator before string literals",
        );
      }
      result += " ";
    }
    // PostgreSQL nests block comments; GoogleSQL does not. Remove the skipped
    // spans before translating so inner comment terminators cannot expose SQL.
    result +=
      sql.slice(cursor, token.start).replace(/[^\t\n\r\f ]/g, " ") + token.text;
    cursor = token.end;
  }
  return result + sql.slice(cursor).replace(/[^\t\n\r\f ]/g, " ");
}

function bindSqlArguments(sql: string, args: Array<string | null>): string {
  let nextPositionalIndex = 0;
  let cursor = 0;
  let result = "";
  for (const token of lexAgentSql(sql, { dialect: "postgres" })) {
    result += sql.slice(cursor, token.start);
    if (token.kind === "string") {
      result += sqlLiteral(token.text.slice(1, -1).replace(/''/g, "'"));
    } else if (token.kind === "quoted-identifier") {
      if (/[`\\]/.test(token.value)) {
        throw new FirstPartyAnalyticsUnsupportedSqlError(
          "a PostgreSQL identifier containing a backtick or backslash",
          "First-party BigQuery query cannot translate identifiers containing backticks or backslashes",
        );
      }
      result += `\`${token.value}\``;
    } else if (token.kind === "parameter") {
      const placeholder = token.text;
      const explicitIndex = /^\$(\d+)$/.exec(placeholder)?.[1];
      const bindIndex = explicitIndex
        ? Number(explicitIndex) - 1
        : nextPositionalIndex++;
      if (!Number.isInteger(bindIndex) || bindIndex < 0) {
        throw new Error(
          `First-party BigQuery query has an invalid bind ${placeholder}`,
        );
      }
      const value = args[bindIndex];
      if (value === undefined) {
        throw new Error(
          "First-party BigQuery query has too few bind arguments",
        );
      }
      result += sqlLiteral(value);
    } else {
      result += token.text;
    }
    cursor = token.end;
  }
  return result + sql.slice(cursor);
}

function assertBigQuerySourceProvenance(
  postgresSql: string,
  bigQuerySql: string,
): void {
  const postgresQuery = readAgentSqlQuery(postgresSql, { dialect: "postgres" });
  const bigQuery = readAgentSqlQuery(bigQuerySql, { dialect: "bigquery" });
  const fold = (name: string) =>
    name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const cteNames = new Map<string, string>();
  let cteCollision = false;
  for (const cte of postgresQuery.ctes) {
    const key = fold(cte.name);
    const previous = cteNames.get(key);
    if (previous !== undefined && previous !== cte.name) cteCollision = true;
    cteNames.set(key, cte.name);
  }
  const changedSource = postgresQuery.sources.some((source, index) => {
    const converted = bigQuery.sources[index];
    return (
      !converted ||
      source.cte !== converted.cte ||
      source.quoted !== converted.quoted ||
      source.name !== (source.quoted ? converted.name : fold(converted.name)) ||
      source.qualifiers.length !== converted.qualifiers.length ||
      source.qualifiers.some(
        (qualifier, part) => qualifier !== converted.qualifiers[part],
      )
    );
  });
  // BigQuery splits dotted quoted names and folds CTE bindings. Refuse any
  // conversion that could resolve a different relation before physical mapping.
  if (
    cteCollision ||
    changedSource ||
    postgresQuery.sources.length !== bigQuery.sources.length
  ) {
    throw new FirstPartyAnalyticsUnsupportedSqlError(
      "PostgreSQL source bindings that change in BigQuery",
      "First-party BigQuery query cannot preserve the PostgreSQL source bindings",
    );
  }
}

function maskSqlLiterals(
  sql: string,
  dialect: AgentSqlDialect = "postgres",
): string {
  const chars = sql.split("");
  for (const token of lexAgentSql(sql, { dialect })) {
    if (token.kind !== "string" && token.kind !== "quoted-identifier") continue;
    chars.fill(" ", token.start, token.end);
  }
  return chars.join("");
}

const SQL_LITERAL_PLACEHOLDER_PREFIX = "_fpa_lit_";

function rewriteWithMaskedSqlLiterals(
  sql: string,
  rewrite: (code: string) => string,
): string {
  if (sql.includes(SQL_LITERAL_PLACEHOLDER_PREFIX)) {
    throw new FirstPartyAnalyticsUnsupportedSqlError(
      `an identifier reserved for query translation (${SQL_LITERAL_PLACEHOLDER_PREFIX}*)`,
      `First-party BigQuery query cannot use identifiers starting with ${SQL_LITERAL_PLACEHOLDER_PREFIX}`,
    );
  }
  const literals: string[] = [];
  let masked = "";
  let cursor = 0;
  for (const token of lexAgentSql(sql, { dialect: "postgres" })) {
    if (token.kind !== "string" && token.kind !== "quoted-identifier") continue;
    masked += sql.slice(cursor, token.start);
    masked += `${SQL_LITERAL_PLACEHOLDER_PREFIX}${literals.length}_`;
    literals.push(token.text);
    cursor = token.end;
  }
  return rewrite(masked + sql.slice(cursor)).replace(
    new RegExp(`${SQL_LITERAL_PLACEHOLDER_PREFIX}(\\d+)_`, "g"),
    (whole, index: string) => literals[Number(index)] ?? whole,
  );
}

function findMatchingSqlParen(
  sql: string,
  openIndex: number,
  dialect: AgentSqlDialect = "postgres",
): number {
  let depth = 0;
  for (const token of lexAgentSql(sql, { dialect })) {
    if (token.start < openIndex || token.kind !== "punctuation") continue;
    if (token.text === "(") depth++;
    if (token.text === ")") {
      depth--;
      if (depth === 0) return token.start;
    }
  }
  return -1;
}

function splitTopLevelSqlArgs(
  value: string,
  dialect: AgentSqlDialect = "postgres",
): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  for (const token of lexAgentSql(value, { dialect })) {
    if (token.kind !== "punctuation") continue;
    if (token.text === "(") depth++;
    if (token.text === ")") depth--;
    if (token.text === "," && depth === 0) {
      args.push(value.slice(start, token.start).trim());
      start = token.end;
    }
  }
  args.push(value.slice(start).trim());
  return args;
}

function rewriteSqlFunctionCalls(
  sql: string,
  functionName: string,
  rewrite: (args: string[]) => string,
): string {
  const functionRe = new RegExp(`\\b${functionName}\\s*\\(`, "gi");
  const masked = maskSqlLiterals(sql);
  let cursor = 0;
  let result = "";
  let match = functionRe.exec(masked);
  while (match) {
    const openIndex = match.index + match[0].lastIndexOf("(");
    const closeIndex = findMatchingSqlParen(sql, openIndex);
    if (closeIndex === -1) {
      throw new Error(
        `First-party BigQuery query has an unterminated ${functionName} call`,
      );
    }
    result += sql.slice(cursor, match.index);
    result += rewrite(
      splitTopLevelSqlArgs(sql.slice(openIndex + 1, closeIndex)),
    );
    cursor = closeIndex + 1;
    functionRe.lastIndex = cursor;
    match = functionRe.exec(masked);
  }
  return match ? result : result + sql.slice(cursor);
}

function coerceDateComparisonOperands(sql: string): string {
  const dateField = "(?:event_date|cohort_date)";
  const qualifiedDateField = `(?:[A-Za-z_][A-Za-z0-9_]*\\.)?${dateField}`;
  const comparisonRe = new RegExp(
    `\\b${qualifiedDateField}\\s*(?:<=|>=|<>|=|<|>)\\s*`,
    "gi",
  );
  let cursor = 0;
  let result = "";
  const code = maskSqlLiterals(sql, "bigquery");
  let match = comparisonRe.exec(sql);
  while (match) {
    if (code[match.index] === " ") {
      match = comparisonRe.exec(sql);
      continue;
    }
    const operandStart = match.index + match[0].length;
    const formatMatch = /^FORMAT_DATE\s*\(/i.exec(sql.slice(operandStart));
    if (formatMatch) {
      const openIndex = operandStart + formatMatch[0].lastIndexOf("(");
      const closeIndex = findMatchingSqlParen(sql, openIndex, "bigquery");
      if (closeIndex === -1) {
        throw new Error(
          "First-party BigQuery query has an unterminated FORMAT_DATE call",
        );
      }
      const args = splitTopLevelSqlArgs(
        sql.slice(openIndex + 1, closeIndex),
        "bigquery",
      );
      if (args.length === 2 && /^'%Y-%m-%d'$/i.test(args[0] ?? "")) {
        result += sql.slice(cursor, operandStart) + (args[1] ?? "");
        cursor = closeIndex + 1;
        comparisonRe.lastIndex = cursor;
        match = comparisonRe.exec(sql);
        continue;
      }
    }
    const matchEnd = match.index + match[0].length;
    result += sql.slice(cursor, matchEnd);
    cursor = matchEnd;
    comparisonRe.lastIndex = cursor;
    match = comparisonRe.exec(sql);
  }
  result += sql.slice(cursor);
  const resultCode = maskSqlLiterals(result, "bigquery");
  return result.replace(
    new RegExp(
      `(\\b${qualifiedDateField}\\s*(?:<=|>=|<>|=|<|>)\\s*)'(\\d{4}-\\d{2}-\\d{2})'`,
      "gi",
    ),
    (whole, comparison: string, date: string, offset: number) =>
      resultCode[offset] === " " ? whole : `${comparison}DATE '${date}'`,
  );
}

function postgresCastOperandBounds(
  code: string,
  castIndex: number,
): { start: number; end: number } {
  let end = castIndex;
  while (end > 0 && /\s/.test(code[end - 1] ?? "")) {
    end--;
  }
  let start = end;
  if (code[end - 1] === ")") {
    let depth = 0;
    for (let index = end - 1; index >= 0; index--) {
      if (code[index] === ")") depth++;
      if (code[index] !== "(") continue;
      depth--;
      if (depth === 0) {
        start = index;
        break;
      }
    }
  }
  while (start > 0 && /[A-Za-z0-9_.$]/.test(code[start - 1] ?? "")) {
    start--;
  }
  if (start === end) {
    throw new FirstPartyAnalyticsUnsupportedSqlError(
      "a PostgreSQL cast with no readable operand",
      "First-party BigQuery query has an invalid PostgreSQL cast",
    );
  }
  return { start, end };
}

function replacePostgresCastsInCode(code: string): string {
  const castType = new RegExp(
    "::\\s*(date|timestamp|timestamptz|int|int2|int4|int8|integer|float|float4|float8|double\\s+precision|numeric|text|varchar|boolean|bool|json|jsonb)\\b",
    "gi",
  );
  let result = code;
  let match = castType.exec(result);
  while (match) {
    const normalizedType = match[1].toLowerCase().replace(/\s+/g, " ");
    const mappedType: Record<string, string> = {
      bool: "BOOL",
      boolean: "BOOL",
      date: "DATE",
      double: "FLOAT64",
      "double precision": "FLOAT64",
      float: "FLOAT64",
      float4: "FLOAT64",
      float8: "FLOAT64",
      int: "INT64",
      int2: "INT64",
      int4: "INT64",
      int8: "INT64",
      integer: "INT64",
      numeric: "NUMERIC",
      text: "STRING",
      timestamp: "TIMESTAMP",
      timestamptz: "TIMESTAMP",
      varchar: "STRING",
    };
    const targetType = mappedType[normalizedType];
    if (!targetType) {
      throw new FirstPartyAnalyticsUnsupportedSqlError(
        `a PostgreSQL ${normalizedType} cast`,
        `First-party BigQuery query does not support PostgreSQL ${normalizedType} casts`,
      );
    }

    const { start: operandStart, end: operandEnd } = postgresCastOperandBounds(
      result,
      match.index,
    );
    const operand = result.slice(operandStart, operandEnd).trim();
    const castEnd = match.index + match[0].length;
    result = `${result.slice(0, operandStart)}CAST(${operand} AS ${targetType})${result.slice(castEnd)}`;
    castType.lastIndex =
      operandStart + `CAST(${operand} AS ${targetType})`.length;
    match = castType.exec(result);
  }
  return result;
}

function translatePostgresDateExpression(value: string): string {
  return rewriteWithMaskedSqlLiterals(value.trim(), (code) => {
    let translated = replacePostgresCastsInCode(code);
    translated = translated
      .replace(/\bnow\s*\(\s*\)/gi, "CURRENT_TIMESTAMP()")
      .replace(/\bCURRENT_DATE\b(?!\s*\()/gi, "CURRENT_DATE()")
      .replace(/\bCURRENT_TIMESTAMP\b(?!\s*\()/gi, "CURRENT_TIMESTAMP()");
    return replaceBigQueryDateArithmetic(translated).trim();
  });
}

function replaceBigQueryDateArithmetic(code: string): string {
  const intervalExpression =
    /((?:[A-Za-z_][A-Za-z0-9_.]*\(\)|[A-Za-z_][A-Za-z0-9_.]*|CAST\([^()]+\s+AS\s+[A-Z0-9]+\)))\s*([+-])\s*INTERVAL\s+(\d+)\s+(DAY|WEEK|MONTH)\b/gi;
  let translated = code.replace(
    intervalExpression,
    (
      _match,
      operand: string,
      operator: string,
      amount: string,
      unit: string,
    ) => {
      const functionName = /CURRENT_TIMESTAMP|TIMESTAMP/i.test(operand)
        ? "TIMESTAMP"
        : "DATE";
      return `${functionName}_${operator === "+" ? "ADD" : "SUB"}(${operand}, INTERVAL ${amount} ${unit.toUpperCase()})`;
    },
  );
  const dateIntegerExpression =
    /((?:[A-Za-z_][A-Za-z0-9_]*\.)*(?:date|event_date|start_date|end_date|cohort_date)|CAST\([^()]+\s+AS\s+DATE\))\s*\+\s*([A-Za-z_][A-Za-z0-9_.]*)/gi;
  translated = translated.replace(
    dateIntegerExpression,
    (_match, dateExpression: string, offsetExpression: string) =>
      `DATE_ADD(${dateExpression}, INTERVAL ${offsetExpression} DAY)`,
  );
  return translated;
}

const BIGQUERY_DATE_TRUNC_PARTS: Record<string, string> = {
  day: "DAY",
  week: "WEEK(MONDAY)",
  month: "MONTH",
  quarter: "QUARTER",
  year: "YEAR",
};

function bigQueryJsonPath(key: string): string {
  const path = `$."${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  // Translation still carries PostgreSQL literals; the binder converts them
  // together after functions and casts have been rewritten.
  return `'${path.replace(/'/g, "''")}'`;
}

function translatePostgresJsonOperators(sql: string): string {
  const jsonExtract = /\s*::\s*jsonb?\s*->>\s*('(?:[^']|'')*')/gi;
  let result = sql;
  let match = jsonExtract.exec(result);
  while (match) {
    const code = maskSqlLiterals(result);
    const castIndex = match.index + match[0].indexOf("::");
    if (code[castIndex] !== ":") {
      match = jsonExtract.exec(result);
      continue;
    }
    const { start, end } = postgresCastOperandBounds(result, match.index);
    const operand = result.slice(start, end).trim();
    const key = (match[1] ?? "").slice(1, -1).replace(/''/g, "'");
    const replacement = `JSON_VALUE(${operand}, ${bigQueryJsonPath(key)})`;
    result =
      result.slice(0, start) +
      replacement +
      result.slice(match.index + match[0].length);
    jsonExtract.lastIndex = start + replacement.length;
    match = jsonExtract.exec(result);
  }
  return result;
}

function translateFirstPartyAnalyticsBigQuerySql(sql: string): string {
  let translated = translatePostgresJsonOperators(normalizePostgresSql(sql));
  translated = rewriteSqlFunctionCalls(translated, "coalesce", (args) => {
    const uniqueArgs: string[] = [];
    const seen = new Set<string>();
    for (const arg of args) {
      const normalized = arg.trim();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      uniqueArgs.push(arg);
    }
    return `COALESCE(${uniqueArgs.join(", ")})`;
  });
  const intervalCode = maskSqlLiterals(translated);
  translated = translated.replace(
    /\bINTERVAL\s*'(\d+)\s+(day|days|week|weeks|month|months)'/gi,
    (whole, amount: string, unit: string, offset: number) =>
      intervalCode[offset] === " "
        ? whole
        : `INTERVAL ${amount} ${unit.replace(/s$/i, "").toUpperCase()}`,
  );
  translated = rewriteSqlFunctionCalls(translated, "date_trunc", (args) => {
    const unit = /^'([a-z]+)'$/i.exec(args[0] ?? "")?.[1]?.toLowerCase();
    const datePart = unit ? BIGQUERY_DATE_TRUNC_PARTS[unit] : undefined;
    if (args.length !== 2 || !datePart) {
      throw new FirstPartyAnalyticsUnsupportedSqlError(
        `date_trunc(${args[0] ?? "?"}, ...)`,
        `First-party BigQuery query supports PostgreSQL date_trunc with ${Object.keys(BIGQUERY_DATE_TRUNC_PARTS).join(", ")}`,
      );
    }
    return `DATE_TRUNC(CAST(${translatePostgresDateExpression(args[1] ?? "")} AS DATE), ${datePart})`;
  });
  translated = rewriteSqlFunctionCalls(translated, "to_char", (args) => {
    if (args.length !== 2 || !/^'YYYY-MM-DD'$/i.test(args[1] ?? "")) {
      throw new FirstPartyAnalyticsUnsupportedSqlError(
        `to_char(..., ${args[1] ?? "?"})`,
        "First-party BigQuery query only supports PostgreSQL to_char(..., 'YYYY-MM-DD') expressions",
      );
    }
    return `FORMAT_DATE('%Y-%m-%d', CAST(${translatePostgresDateExpression(args[0] ?? "")} AS DATE))`;
  });
  translated = rewriteSqlFunctionCalls(translated, "chr", (args) => {
    if (args.length !== 1) {
      throw new FirstPartyAnalyticsUnsupportedSqlError(
        "a multi-argument chr(...) call",
        "First-party BigQuery query has an invalid chr call",
      );
    }
    return `CHR(${args[0]})`;
  });
  let previous = "";
  while (previous !== translated) {
    previous = translated;
    translated = rewriteSqlFunctionCalls(translated, "split_part", (args) => {
      const index = Number(args[2]);
      if (args.length !== 3 || !Number.isInteger(index) || index < 1) {
        throw new FirstPartyAnalyticsUnsupportedSqlError(
          "split_part(...) with a non-literal or non-positive index",
          "First-party BigQuery query only supports split_part with a positive integer index",
        );
      }
      return `SPLIT(${args[0]}, ${args[1]})[SAFE_OFFSET(${index - 1})]`;
    });
  }
  translated = rewriteWithMaskedSqlLiterals(translated, (code) => {
    let rewritten = replacePostgresCastsInCode(code);
    rewritten = rewritten
      .replace(/\bnow\s*\(\s*\)/gi, "CURRENT_TIMESTAMP()")
      .replace(/\bCURRENT_DATE\b(?!\s*\()/gi, "CURRENT_DATE()")
      .replace(/\bCURRENT_TIMESTAMP\b(?!\s*\()/gi, "CURRENT_TIMESTAMP()");
    return replaceBigQueryDateArithmetic(rewritten);
  });

  const code = maskSqlLiterals(translated);
  const unsupported: Array<[RegExp, string]> = [
    [/\bto_char\s*\(/i, "to_char"],
    [/\bdate_trunc\s*\(\s*'/i, "date_trunc"],
    [/\b(?:ILIKE|SIMILAR\s+TO)\b/i, "ILIKE/SIMILAR TO"],
    [
      /\b(?:LATERAL|generate_series|unnest|string_to_array)\b/i,
      "set-returning PostgreSQL functions",
    ],
    [/::\s*[A-Za-z_]/i, "PostgreSQL casts"],
    [/\bINTERVAL\s*'/i, "PostgreSQL interval literals"],
    [/\bAT\s+TIME\s+ZONE\b/i, "AT TIME ZONE"],
    [/\bFILTER\s*\(\s*WHERE\b/i, "FILTER (WHERE ...)"],
    [/\bDISTINCT\s+ON\b/i, "SELECT DISTINCT ON"],
    [/->>|->|#>>|@>/, "PostgreSQL JSON operators"],
  ];
  const incompatible = unsupported.find(([pattern]) => pattern.test(code));
  if (incompatible) {
    throw new FirstPartyAnalyticsUnsupportedSqlError(
      incompatible[1],
      `First-party analytics query uses unsupported PostgreSQL syntax (${incompatible[1]}) after BigQuery translation`,
    );
  }
  return translated;
}

/**
 * The events model projected back to the raw table's column names, so scoped
 * first-party SQL runs unchanged. The model omits `http.response`, is already
 * deduplicated by event id, carries `properties` as native JSON, and has no
 * `public_key_id` or `context`; `firstPartyEventsModelIneligibility` keeps
 * SQL that depends on any of those on the raw table. The missing columns are
 * left out rather than filled with NULL, so `SELECT *` cannot return a
 * plausible empty value for data the model never had.
 */
export function firstPartyEventsModelProjection(modelTable: string): string {
  return [
    "SELECT event_id AS id, event_name,",
    "user_email AS user_id, anonymous_id, user_key, session_id,",
    "event_at AS timestamp, event_date, received_at, page_url AS url,",
    "page_path AS path, page_hostname AS hostname, referrer_url AS referrer,",
    "app, template,",
    "CASE WHEN is_signed_in THEN 'true' WHEN NOT is_signed_in THEN 'false' END AS signed_in,",
    "properties,",
    "agent_native_account_owner_email AS owner_email,",
    "agent_native_account_id AS org_id",
    `FROM \`${modelTable}\``,
  ].join(" ");
}

// Only the extractors that return STRING (or ARRAY<STRING>) from both a STRING
// and a JSON argument: the raw table types `properties` as STRING and the
// model as JSON, so JSON_QUERY and its kin would change the result type.
const JSON_PATH_FUNCTIONS = new Set([
  "json_value",
  "json_extract_scalar",
  "json_value_array",
  "json_extract_string_array",
]);

export type FirstPartyEventsModelIneligibility = Extract<
  FirstPartyEventsModelSkipReason,
  | "reads_no_events"
  | "reads_raw_only_columns"
  | "reads_all_columns"
  | "reads_http_response"
  | "http_response_not_excluded"
  | "reads_properties_as_text"
>;

const HTTP_RESPONSE_LITERAL = /^['"]http\.response['"]$/i;
// Raw, triple-quoted, and escaped strings can spell http.response without
// matching it, so only a plain literal proves which event a filter names.
const PLAIN_STRING_LITERAL = /^(?:'[^'\\]*'|"[^"\\]*")$/;
const WHERE_END_KEYWORDS = new Set([
  "group",
  "having",
  "window",
  "qualify",
  "order",
  "limit",
  "union",
  "intersect",
  "except",
]);

function isWord(token: AgentSqlToken | undefined, word: string): boolean {
  return token?.kind === "word" && token.value === word;
}

function isEventNameColumn(
  tokens: AgentSqlToken[],
  index: number,
  sourceName: string,
): boolean {
  const token = tokens[index];
  if (
    (token?.kind !== "word" && token?.kind !== "quoted-identifier") ||
    token.value.toLowerCase() !== "event_name"
  ) {
    return false;
  }
  if (tokens[index - 1]?.text !== ".") return true;
  return tokens[index - 2]?.value.toLowerCase() === sourceName;
}

/**
 * Index just past an `event_name` conjunct that keeps `http.response` out:
 * `= 'event'`, `IN ('event', ...)`, or `!= 'http.response'`. -1 otherwise.
 */
function httpResponseExclusionEnd(
  tokens: AgentSqlToken[],
  index: number,
): number {
  const operator = tokens[index + 1];
  const literal = tokens[index + 2];
  if (operator?.text === "=" && literal?.kind === "string") {
    return PLAIN_STRING_LITERAL.test(literal.text) &&
      !HTTP_RESPONSE_LITERAL.test(literal.text)
      ? index + 3
      : -1;
  }
  if (
    (operator?.text === "!=" || operator?.text === "<>") &&
    literal?.kind === "string"
  ) {
    // String comparison is case-sensitive, so only the exact event name
    // excludes it; the case-insensitive match elsewhere only keeps SQL raw.
    return literal.text.slice(1, -1) === "http.response" &&
      PLAIN_STRING_LITERAL.test(literal.text)
      ? index + 3
      : -1;
  }
  if (!isWord(operator, "in") || literal?.text !== "(") return -1;
  let cursor = index + 3;
  for (;;) {
    const value = tokens[cursor];
    if (
      value?.kind !== "string" ||
      !PLAIN_STRING_LITERAL.test(value.text) ||
      HTTP_RESPONSE_LITERAL.test(value.text)
    ) {
      return -1;
    }
    const next = tokens[cursor + 1];
    if (next?.text === ")") return cursor + 2;
    if (next?.text !== ",") return -1;
    cursor += 2;
  }
}

/**
 * The model omits every `http.response` row, so a read can move to it only
 * when its own WHERE provably drops them: a top-level conjunct on
 * `event_name`, with no OR or NOT in that WHERE that could let them back in.
 * An unfiltered count or an `event_name` breakdown would otherwise lose those
 * rows without any sign the number changed.
 */
function eventsReadsIneligibility(
  sql: string,
): "reads_no_events" | "http_response_not_excluded" | null {
  const query = readAgentSqlQuery(sql, { dialect: "bigquery" });
  const { tokens } = query;
  const depths: number[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.text === ")") depth--;
    depths.push(depth);
    if (token.text === "(") depth++;
  }
  const tokenIndex = new Map(
    tokens.map((token, index) => [token.start, index]),
  );
  const eventsReads = query.sources.filter(
    (source) =>
      !source.cte &&
      source.qualifiers.length === 0 &&
      source.name.toLowerCase() === "analytics_events",
  );
  if (eventsReads.length === 0) return "reads_no_events";
  for (const source of eventsReads) {
    const start = tokenIndex.get(source.start);
    if (start === undefined) return "http_response_not_excluded";
    const level = depths[start];
    const sourceName = (source.alias?.name ?? source.name).toLowerCase();
    const atLevelEnd = (index: number) =>
      index >= tokens.length ||
      depths[index] < level ||
      (depths[index] === level &&
        tokens[index].kind === "word" &&
        WHERE_END_KEYWORDS.has(tokens[index].value));
    let where = start + 1;
    while (
      !atLevelEnd(where) &&
      !(depths[where] === level && isWord(tokens[where], "where"))
    ) {
      where++;
    }
    if (atLevelEnd(where)) return "http_response_not_excluded";
    let excluded = false;
    for (let index = where + 1; !atLevelEnd(index); index++) {
      const token = tokens[index];
      if (isWord(token, "or")) return "http_response_not_excluded";
      if (isWord(token, "not") && !isWord(tokens[index - 1], "is")) {
        return "http_response_not_excluded";
      }
      if (
        depths[index] !== level ||
        !isEventNameColumn(tokens, index, sourceName)
      ) {
        continue;
      }
      const column = tokens[index - 1]?.text === "." ? index - 2 : index;
      const before = tokens[column - 1];
      if (!isWord(before, "where") && !isWord(before, "and")) continue;
      const end = httpResponseExclusionEnd(tokens, index);
      if (end !== -1 && (atLevelEnd(end) || isWord(tokens[end], "and"))) {
        excluded = true;
      }
    }
    if (!excluded) return "http_response_not_excluded";
  }
  return null;
}

/** Why translated first-party BigQuery SQL must read the raw table, if it must. */
export function firstPartyEventsModelIneligibility(
  sql: string,
): FirstPartyEventsModelIneligibility | null {
  const tokens = lexAgentSql(sql, { dialect: "bigquery" });
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      token.kind === "string" &&
      HTTP_RESPONSE_LITERAL.test(token.text) &&
      // Excluding the events the model already omits is safe on the model.
      !(
        (tokens[index - 1]?.text === "!=" ||
          tokens[index - 1]?.text === "<>") &&
        tokens[index - 2]?.value === "event_name"
      )
    ) {
      return "reads_http_response";
    }
    // The model has fewer columns than the raw table and types `properties`
    // as JSON, so a wildcard would silently change the result's schema.
    if (
      token.text === "*" &&
      (tokens[index - 1]?.text === "." ||
        tokens[index - 1]?.text === "," ||
        isWord(tokens[index - 1], "select") ||
        isWord(tokens[index - 1], "distinct") ||
        isWord(tokens[index - 1], "all"))
    ) {
      return "reads_all_columns";
    }
    if (token.kind !== "word" && token.kind !== "quoted-identifier") continue;
    const name = token.value.toLowerCase();
    if (name === "public_key_id" || name === "context") {
      return "reads_raw_only_columns";
    }
    if (
      name === "properties" &&
      !(
        tokens[index - 1]?.text === "(" &&
        JSON_PATH_FUNCTIONS.has(tokens[index - 2]?.value.toLowerCase() ?? "")
      )
    ) {
      return "reads_properties_as_text";
    }
  }
  return eventsReadsIneligibility(sql);
}

function qualifyQuerySources(
  sql: string,
  table: BigQueryTableRef,
  eventsModelTable?: string,
): string {
  const physical = firstPartyAnalyticsPhysicalTables(table);
  const sourceMap: Record<string, string> = {
    analytics_events: firstPartyAnalyticsRawTable(table),
    analytics_event_daily_rollups: physical.dailyRollups,
    analytics_user_days: physical.userDays,
  };
  const query = readAgentSqlQuery(sql, { dialect: "bigquery" });
  return rewriteAgentSqlQuerySources(query, (source) => {
    const physicalName = sourceMap[source.name.toLowerCase()];
    if (source.cte || source.qualifiers.length > 0 || !physicalName) {
      return sql.slice(source.start, source.end);
    }
    if (eventsModelTable && source.name.toLowerCase() === "analytics_events") {
      return `(${firstPartyEventsModelProjection(eventsModelTable)})${source.alias ? "" : " AS analytics_events"}`;
    }
    return `\`${physicalName}\``;
  });
}

function onboardingEventDatePredicates(eventDateRange?: {
  startDate: string;
  endDate: string;
}): string[] {
  if (!eventDateRange) return [];
  for (const value of [eventDateRange.startDate, eventDateRange.endDate]) {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value
    ) {
      throw new Error("First-party event date bounds must be calendar dates");
    }
  }
  return [
    `event_date >= DATE '${eventDateRange.startDate}'`,
    `event_date <= DATE '${eventDateRange.endDate}'`,
  ];
}

function addPartitionPrunedEventDeduplication(
  sql: string,
  table: BigQueryTableRef,
  options: FirstPartyAnalyticsBigQueryRenderOptions = {},
): string {
  const quote = String.fromCharCode(96);
  const rawTableName = firstPartyAnalyticsRawTable(table);
  const rawSource = `${quote}${rawTableName}${quote}`;
  const projectionRequested =
    options.scopedEventsProjection === "onboarding_journey" ||
    options.scopedEventsSourceProjections !== undefined;
  const projectedColumnsPattern =
    ONBOARDING_JOURNEY_EVENT_SOURCE_COLUMNS.join("\\s*,\\s*");
  const responseIdentityColumnsPattern =
    ONBOARDING_JOURNEY_RESPONSE_IDENTITY_SOURCE_COLUMNS.join("\\s*,\\s*");
  const selectedColumnsPattern = projectionRequested
    ? `(?:\\*|${projectedColumnsPattern}|${responseIdentityColumnsPattern})`
    : "\\*";
  const sourcePattern = new RegExp(
    `\\bSELECT\\s+(${selectedColumnsPattern})\\s+FROM\\s+(${quote}[^${quote}]+${quote})\\s+WHERE\\b`,
    "gi",
  );
  const sourceSelectPattern = new RegExp(
    `^SELECT\\s+${selectedColumnsPattern}\\s+FROM\\b`,
    "i",
  );
  let result = "";
  let cursor = 0;
  let searchStart = 0;
  const code = maskSqlLiterals(sql, "bigquery");
  const tokens = projectionRequested
    ? lexAgentSql(sql, { dialect: "bigquery" })
    : [];
  const selectStarts = new Set(
    tokens
      .filter((token) => token.kind === "word" && token.value === "select")
      .map((token) => token.start),
  );
  const rawSourcePositions = tokens.flatMap((token, index) => {
    const next = tokens[index + 1];
    return token.kind === "word" &&
      (token.value === "from" || token.value === "join") &&
      next?.kind === "quoted-identifier" &&
      next.value === rawTableName
      ? [next.start]
      : [];
  });
  let rewrittenRawSources = 0;
  let journeyEventSources = 0;
  let responseIdentitySources = 0;
  while (cursor < sql.length) {
    sourcePattern.lastIndex = searchStart;
    const sourceMatch = sourcePattern.exec(sql);
    if (!sourceMatch) {
      result += sql.slice(cursor);
      break;
    }
    const sourceIndex = sourceMatch.index;
    searchStart = sourcePattern.lastIndex;
    const selectedColumns = sourceMatch[1]!
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const isResponseIdentitySource =
      projectionRequested &&
      selectedColumns ===
        ONBOARDING_JOURNEY_RESPONSE_IDENTITY_SOURCE_COLUMNS.join(", ");
    const isJourneyEventSource =
      projectionRequested &&
      selectedColumns === ONBOARDING_JOURNEY_EVENT_SOURCE_COLUMNS.join(", ");
    if (
      sourceMatch[2] !== rawSource ||
      (projectionRequested && !selectStarts.has(sourceIndex)) ||
      !sourceSelectPattern.test(code.slice(sourceIndex))
    ) {
      continue;
    }
    const predicateStart = sourcePattern.lastIndex;
    let depth = 0;
    let predicateEnd = sql.length;
    for (let index = predicateStart; index < sql.length; index++) {
      const char = code[index];
      if (char === "(") {
        depth++;
        continue;
      }
      if (char === ")") {
        if (depth === 0) {
          predicateEnd = index;
          break;
        }
        depth--;
        continue;
      }
      if (depth === 0 && /^UNION\s+ALL\b/i.test(code.slice(index))) {
        predicateEnd = index;
        break;
      }
    }
    // ponytail: insertAll is at-least-once; staging + MERGE is the upgrade path
    // for physical exactly-once if the warehouse contract requires it.
    const predicates = [
      ...onboardingEventDatePredicates(options.eventDateRange),
      ...firstPartyEventPushdownPredicates(sql, sourceIndex),
      ...(isJourneyEventSource ? ["event_name != 'http.response'"] : []),
    ].filter(
      (predicate, index, all) =>
        all.findIndex(
          (candidate) => candidate.toLowerCase() === predicate.toLowerCase(),
        ) === index,
    );
    // Combined org and owner scans must keep their independent latest receipts.
    const dedupPartition = options.scopedEventsSingleScan ? "id, org_id" : "id";
    result +=
      sql.slice(cursor, predicateEnd) +
      predicates.map((predicate) => ` AND (${predicate})`).join("") +
      ` QUALIFY ROW_NUMBER() OVER (PARTITION BY ${dedupPartition} ORDER BY received_at DESC) = 1` +
      (predicateEnd < sql.length ? " " : "");
    if (projectionRequested) rewrittenRawSources++;
    if (isJourneyEventSource) journeyEventSources++;
    if (isResponseIdentitySource) responseIdentitySources++;
    cursor = predicateEnd;
    searchStart = cursor;
  }
  const sourceProjections = Object.values(
    options.scopedEventsSourceProjections ?? {},
  );
  const expectedJourneyEventSources =
    options.scopedEventsSourceProjections === undefined
      ? 1
      : sourceProjections.filter(
          (projection) => projection === "onboarding_journey",
        ).length;
  const expectedResponseIdentitySources = sourceProjections.filter(
    (projection) => projection === "onboarding_journey_response_identity",
  ).length;
  if (
    projectionRequested &&
    rawSourcePositions.length > 0 &&
    (rewrittenRawSources !== rawSourcePositions.length ||
      journeyEventSources !== expectedJourneyEventSources ||
      responseIdentitySources !== expectedResponseIdentitySources)
  ) {
    throw new FirstPartyAnalyticsUnsupportedSqlError(
      "an unsupported onboarding journey event source projection",
      "First-party BigQuery query cannot safely apply the onboarding journey event projection and deduplication",
    );
  }
  return result;
}

export function assertFirstPartyAnalyticsBigQuerySql(sql: string): void {
  translateFirstPartyAnalyticsBigQuerySql(sql);
}

export interface FirstPartyAnalyticsBigQueryRenderOptions {
  eventDateRange?: { startDate: string; endDate: string };
  scopedEventsSingleScan?: boolean;
  scopedEventsProjection?: FirstPartyAnalyticsEventsProjection;
  scopedEventsSourceProjections?: Record<
    string,
    FirstPartyAnalyticsEventSourceProjection
  >;
  /** Read `analytics_events` from this events model instead of the raw table. */
  eventsModelTable?: string;
}

function firstPartyEventsModelProjectionRequested(
  options: FirstPartyAnalyticsBigQueryRenderOptions,
): boolean {
  return (
    options.eventDateRange !== undefined ||
    options.scopedEventsSingleScan === true ||
    options.scopedEventsProjection !== undefined ||
    options.scopedEventsSourceProjections !== undefined
  );
}

const MODEL_MISSING_SKIP_REASONS: Partial<
  Record<SourceGenerationUnavailableReason, FirstPartyEventsModelSkipReason>
> = {
  invalid_table_id: "model_invalid_table_id",
  not_found: "model_not_found",
  access_denied: "model_access_denied",
};

/**
 * Choose where a first-party query reads `analytics_events`: the events model
 * when one is configured and the query reads nothing the model lacks, the raw
 * table otherwise, with the reason the model was skipped.
 */
export function planFirstPartyEventsSource(
  sql: string,
  modelTable: string | null | undefined,
  options: FirstPartyAnalyticsBigQueryRenderOptions & {
    eventsSource?: "raw";
  } = {},
): FirstPartyEventsSource {
  if (!modelTable) return { source: "raw", modelSkipped: "not_configured" };
  if (options.eventsSource === "raw") {
    return { source: "raw", modelSkipped: "raw_requested" };
  }
  if (firstPartyEventsModelProjectionRequested(options)) {
    return { source: "raw", modelSkipped: "raw_projection" };
  }
  const ineligible = firstPartyEventsModelIneligibility(
    translateFirstPartyAnalyticsBigQuerySql(sql),
  );
  return ineligible
    ? { source: "raw", modelSkipped: ineligible }
    : { source: "model", table: modelTable };
}

export function renderFirstPartyAnalyticsBigQuerySql(
  scopedSql: string,
  args: Array<string | null>,
  table: BigQueryTableRef,
  options: FirstPartyAnalyticsBigQueryRenderOptions = {},
): string {
  // The Postgres scope builder uses a text fallback for nullable event
  // dates. BigQuery's event_date is a DATE, and the fallback is unnecessary
  // because the sink normalizes it before insert.
  const postgresSql = normalizePostgresSql(scopedSql);
  const scopeCode = maskSqlLiterals(postgresSql);
  const normalizedScopeSql = postgresSql.replace(
    /\(COALESCE\(NULLIF\(event_date, ''\), substr\(timestamp, 1, 10\)\) <= (\$\d+|\?)\)/g,
    (whole, placeholder: string, offset: number) =>
      scopeCode[offset] === " " ? whole : `(event_date <= ${placeholder})`,
  );
  const translated =
    translateFirstPartyAnalyticsBigQuerySql(normalizedScopeSql);
  const bound = bindSqlArguments(translated, args);
  assertBigQuerySourceProvenance(scopedSql, bound);
  validateAnalyticsSqlFunctions(
    readAgentSqlQuery(bound, { dialect: "bigquery" }),
    "bigquery",
  );
  if (options.eventsModelTable) {
    if (firstPartyEventsModelProjectionRequested(options)) {
      throw new Error(
        "First-party event projections and date bounds read the raw event table",
      );
    }
    // The model is already deduplicated, and its plain projection lets
    // BigQuery push the scope filters into its partitions.
    return coerceDateComparisonOperands(
      qualifyQuerySources(bound, table, options.eventsModelTable),
    );
  }
  return addPartitionPrunedEventDeduplication(
    coerceDateComparisonOperands(qualifyQuerySources(bound, table)),
    table,
    options,
  );
}

export function renderFirstPartyAnalyticsBigQueryRequestSql(
  scopedSql: string,
  args: Array<string | null>,
  table: BigQueryTableRef,
  options: FirstPartyAnalyticsBigQueryRenderOptions = {},
): string {
  return `SELECT * FROM (${renderFirstPartyAnalyticsBigQuerySql(scopedSql, args, table, options)}) AS first_party_analytics_query LIMIT 5000`;
}

export async function queryFirstPartyAnalyticsInBigQuery(
  scopedSql: string,
  args: Array<string | null>,
  table: BigQueryTableRef,
  options: Omit<
    FirstPartyAnalyticsBigQueryRenderOptions,
    "eventsModelTable"
  > & {
    /** From `planFirstPartyEventsSource`; the raw table when absent. */
    eventsSource?: FirstPartyEventsSource;
    maxBytesBilled?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<AnalyticsQueryResult> {
  const timeoutMs = options.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
  ) {
    throw new Error(
      "First-party BigQuery timeout is outside the allowed range",
    );
  }
  const timeoutSignal =
    timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
  const signal =
    options.signal && timeoutSignal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : (options.signal ?? timeoutSignal);
  let eventsSource = options.eventsSource;
  let result: Awaited<ReturnType<typeof runQuery>>;
  try {
    // Read the generation before the job, so rows are never labeled newer
    // than the model they read.
    const sourceGeneration =
      eventsSource?.source === "model"
        ? await resolveSourceGeneration([eventsSource.table], { signal })
        : undefined;
    // A failed lookup still reads the model under an unknown generation; only
    // a model that is not there to read sends the query to the raw table.
    const modelMissing =
      sourceGeneration?.status === "unavailable"
        ? MODEL_MISSING_SKIP_REASONS[sourceGeneration.reason]
        : undefined;
    if (modelMissing) {
      eventsSource = { source: "raw", modelSkipped: modelMissing };
    }
    result = await runQuery(
      renderFirstPartyAnalyticsBigQueryRequestSql(scopedSql, args, table, {
        eventDateRange: options.eventDateRange,
        scopedEventsSingleScan: options.scopedEventsSingleScan,
        scopedEventsProjection: options.scopedEventsProjection,
        scopedEventsSourceProjections: options.scopedEventsSourceProjections,
        ...(eventsSource?.source === "model"
          ? { eventsModelTable: eventsSource.table }
          : {}),
      }),
      {
        maxBytesBilled: options.maxBytesBilled,
        ...(signal ? { signal } : {}),
        ...(eventsSource?.source === "model" && sourceGeneration
          ? { sourceGeneration }
          : {}),
      },
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timeoutSignal?.aborted) throw new BigQueryQueryTimeoutError();
    throw error;
  }
  return {
    rows: result.rows,
    schema: result.schema,
    bytesProcessed: result.bytesProcessed,
    ...(eventsSource ? { eventsSource } : {}),
    ...(result.sourceGeneration !== undefined
      ? { sourceGeneration: result.sourceGeneration }
      : {}),
    ...(result.cached !== undefined ? { cached: result.cached } : {}),
    ...(result.providerCacheHit !== undefined
      ? { providerCacheHit: result.providerCacheHit }
      : {}),
    ...(result.fetchedAt !== undefined ? { fetchedAt: result.fetchedAt } : {}),
    ...(result.truncated !== undefined ? { truncated: result.truncated } : {}),
  };
}

export async function assertFirstPartyAnalyticsBigQueryReady(
  configuredTable?: string | null,
  options: { includeRowCount?: boolean } = {},
): Promise<{ table: BigQueryTableRef; rowCount: number }> {
  const table = await getFirstPartyAnalyticsTable(configuredTable);
  const expectedColumns = new Map<string, readonly string[]>([
    [table.tableId, FIRST_PARTY_ANALYTICS_RAW_SCHEMA.map(([name]) => name)],
    [
      table.tableId + "_query",
      FIRST_PARTY_ANALYTICS_QUERY_SCHEMA.map(([name]) => name),
    ],
    [
      table.tableId + "_daily_rollups",
      FIRST_PARTY_ANALYTICS_DAILY_ROLLUP_SCHEMA.map(([name]) => name),
    ],
    [
      table.tableId + "_user_days",
      FIRST_PARTY_ANALYTICS_USER_DAYS_SCHEMA.map(([name]) => name),
    ],
  ]);
  const tableNames = [...expectedColumns.keys()];
  const quote = String.fromCharCode(96);
  const informationSchema =
    quote +
    table.projectId +
    "." +
    table.datasetId +
    ".INFORMATION_SCHEMA" +
    quote;
  const tableMetadata = await runQuery(
    "SELECT table_name FROM " +
      informationSchema +
      ".TABLES WHERE table_name IN (" +
      sqlList(tableNames) +
      ")",
  );
  const presentTables = new Set(
    tableMetadata.rows
      .map((row) => row.table_name)
      .filter((value): value is string => typeof value === "string"),
  );
  const missingTables = tableNames.filter((name) => !presentTables.has(name));
  if (missingTables.length) {
    throw new Error(
      "First-party Analytics BigQuery is missing required tables or views: " +
        missingTables.join(", "),
    );
  }
  const columnMetadata = await runQuery(
    "SELECT table_name, column_name FROM " +
      informationSchema +
      ".COLUMNS WHERE table_name IN (" +
      sqlList(tableNames) +
      ")",
  );
  const presentColumns = new Map<string, Set<string>>();
  for (const row of columnMetadata.rows) {
    if (
      typeof row.table_name !== "string" ||
      typeof row.column_name !== "string"
    ) {
      continue;
    }
    const columns = presentColumns.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    presentColumns.set(row.table_name, columns);
  }
  const missingColumns: string[] = [];
  for (const [tableName, columns] of expectedColumns) {
    for (const column of columns) {
      if (!presentColumns.get(tableName)?.has(column)) {
        missingColumns.push(tableName + "." + column);
      }
    }
  }
  if (missingColumns.length) {
    throw new Error(
      "First-party Analytics BigQuery is missing required columns: " +
        missingColumns.join(", "),
    );
  }
  if (options.includeRowCount === false) {
    return { table, rowCount: 0 };
  }
  const result = await runQuery(
    "SELECT COUNT(*) AS row_count FROM " + quote + table.fullyQualified + quote,
  );
  const rowCount = Number(result.rows[0]?.row_count ?? 0);
  return { table, rowCount: Number.isFinite(rowCount) ? rowCount : 0 };
}

export async function getFirstPartyAnalyticsBigQueryMetrics(
  scope: FirstPartyAnalyticsScope,
  configuredTable?: string | null,
  options: {
    includeLegacyOwnerRows?: boolean;
    startDate?: string;
    endDate?: string;
    maxBytesBilled?: number;
  } = {},
): Promise<{
  eventCount: number;
  dailyRollupRows: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
}> {
  const table = await getFirstPartyAnalyticsTable(configuredTable);
  const ownerEmail = sqlLiteral(scope.userEmail);
  const endDate = options.endDate ?? new Date().toISOString().slice(0, 10);
  const includeLegacyOwnerRows = options.includeLegacyOwnerRows !== false;
  const tenantFilter = scope.orgId
    ? includeLegacyOwnerRows
      ? `(org_id = ${sqlLiteral(scope.orgId)} OR (org_id IS NULL AND owner_email = ${ownerEmail}))`
      : `(org_id = ${sqlLiteral(scope.orgId)})`
    : `(org_id IS NULL AND owner_email = ${ownerEmail})`;
  const startDateFilter = options.startDate
    ? ` AND event_date >= DATE ${sqlLiteral(options.startDate)}`
    : "";
  // Filtering the deduplicating view would still scan historical partitions.
  const result = await runQuery(
    `
    WITH scoped_events AS (
      SELECT event_date, event_name, app, template
      FROM \`${firstPartyAnalyticsRawTable(table)}\`
      WHERE ${tenantFilter}${startDateFilter}
        AND event_name IS DISTINCT FROM 'http.response'
        AND event_date <= DATE ${sqlLiteral(endDate)}
      QUALIFY ROW_NUMBER() OVER (PARTITION BY id, org_id ORDER BY received_at DESC) = 1
    )
    SELECT
      COUNT(*) AS event_count,
      COUNT(DISTINCT CONCAT(
        CAST(event_date AS STRING), '|', event_name, '|', COALESCE(app, ''),
        '|', COALESCE(template, '')
      )) AS daily_rollup_rows,
      MIN(event_date) AS first_event_date,
      MAX(event_date) AS last_event_date
    FROM scoped_events
  `,
    { maxBytesBilled: options.maxBytesBilled },
  );
  const row = result.rows[0] ?? {};
  const readValue = (...names: string[]): unknown => {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
    }
    return undefined;
  };
  const numberValue = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const dateValue = (value: unknown): string | null => {
    if (typeof value === "string" && value) return value.slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    if (value && typeof value === "object" && "value" in value) {
      return dateValue((value as { value?: unknown }).value);
    }
    return null;
  };
  return {
    eventCount: numberValue(readValue("event_count", "eventCount")),
    dailyRollupRows: numberValue(
      readValue("daily_rollup_rows", "dailyRollupRows"),
    ),
    firstEventDate: dateValue(readValue("first_event_date", "firstEventDate")),
    lastEventDate: dateValue(readValue("last_event_date", "lastEventDate")),
  };
}

export interface FirstPartyAnalyticsBackfillBatch {
  nextCursor: string | null;
  copied: number;
  complete: boolean;
}

function parseBackfillCursor(
  cursor: string | null,
): FirstPartyAnalyticsBackfillCursor {
  if (!cursor) return { receivedAt: "", id: "" };
  try {
    const parsed = JSON.parse(
      cursor,
    ) as Partial<FirstPartyAnalyticsBackfillCursor>;
    if (
      typeof parsed.receivedAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return { receivedAt: parsed.receivedAt, id: parsed.id };
    }
    // coercion-ok: legacy cursors restart from the beginning to prevent skipped dual-write events.
  } catch {
    // Legacy cursors were only event ids. Restart from the beginning so a
    // dual-write failure cannot leave an event below the new tuple cursor.
  }
  return { receivedAt: "", id: "" };
}

function serializeBackfillCursor(
  cursor: FirstPartyAnalyticsBackfillCursor,
): string {
  return JSON.stringify(cursor);
}

function boundedLookbackDays(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_BACKFILL_LOOKBACK_DAYS ||
    value > MAX_BACKFILL_LOOKBACK_DAYS
  ) {
    throw new Error(
      `BigQuery backfill lookback must be an integer between ${MIN_BACKFILL_LOOKBACK_DAYS} and ${MAX_BACKFILL_LOOKBACK_DAYS} days`,
    );
  }
  return value;
}

function configuredLookbackDays(requested: number | undefined): number {
  if (requested !== undefined) return boundedLookbackDays(requested);
  const raw = process.env[BACKFILL_LOOKBACK_DAYS_ENV]?.trim();
  if (!raw) return DEFAULT_BACKFILL_LOOKBACK_DAYS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) &&
    parsed >= MIN_BACKFILL_LOOKBACK_DAYS &&
    parsed <= MAX_BACKFILL_LOOKBACK_DAYS
    ? parsed
    : DEFAULT_BACKFILL_LOOKBACK_DAYS;
}

function configuredSkipEventNames(requested: string[] | undefined): string[] {
  const raw = requested
    ? requested
    : (
        process.env[BACKFILL_SKIP_EVENTS_ENV] ??
        DEFAULT_BACKFILL_SKIP_EVENTS.join(",")
      )
        .split(",")
        .map((name) => name.trim());
  const names = [...new Set(raw)].filter(Boolean);
  if (names.length > MAX_BACKFILL_SKIP_EVENTS) {
    throw new Error(
      `BigQuery backfill skips at most ${MAX_BACKFILL_SKIP_EVENTS} event names`,
    );
  }
  return names;
}

function backfillLookbackStart(now: string, lookbackDays: number): string {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid BigQuery backfill clock value: ${now}`);
  }
  date.setUTCDate(date.getUTCDate() - lookbackDays);
  return date.toISOString();
}

function backfillBranchSql(
  predicate: string,
  predicateArgs: string[],
  cursor: FirstPartyAnalyticsBackfillCursor,
  lookbackStart: string,
  skipEventNames: string[],
  rangeStart: FirstPartyAnalyticsBackfillCursor | null,
  rangeEnd: FirstPartyAnalyticsBackfillCursor | null,
  rangeEndInclusive: boolean,
  order: "ASC" | "DESC" = "ASC",
): {
  sql: string;
  args: unknown[];
} {
  const lowerCursor = cursor.receivedAt ? cursor : rangeStart;
  let nextParameter = predicateArgs.length + 1;
  const lookbackParameter = `$${nextParameter++}`;
  const defaultSkipEvents =
    skipEventNames.length === DEFAULT_BACKFILL_SKIP_EVENTS.length &&
    skipEventNames[0] === DEFAULT_BACKFILL_SKIP_EVENTS[0];
  const skipParameters = defaultSkipEvents
    ? []
    : skipEventNames.map(() => `$${nextParameter++}`);
  const rangeEndParameters = rangeEnd
    ? [`$${nextParameter++}`, `$${nextParameter++}`]
    : [];
  const cursorParameters = lowerCursor
    ? [`$${nextParameter++}`, `$${nextParameter++}`]
    : [];
  const limitParameter = `$${nextParameter++}`;
  const cursorSql = lowerCursor
    ? `(received_at, id) > (${cursorParameters[0]}, ${cursorParameters[1]})`
    : "";
  const cursorArgs = lowerCursor
    ? [lowerCursor.receivedAt, lowerCursor.id]
    : [];
  const rangeEndSql = rangeEnd
    ? `(received_at, id) ${rangeEndInclusive ? "<=" : "<"} (${rangeEndParameters[0]}, ${rangeEndParameters[1]})`
    : "";
  const rangeEndArgs = rangeEnd ? [rangeEnd.receivedAt, rangeEnd.id] : [];
  const skipSql =
    skipEventNames.length === DEFAULT_BACKFILL_SKIP_EVENTS.length &&
    skipEventNames[0] === DEFAULT_BACKFILL_SKIP_EVENTS[0]
      ? "event_name IS DISTINCT FROM 'http.response'"
      : skipEventNames.length
        ? `(event_name IS NULL OR event_name NOT IN (${skipParameters.join(", ")}))`
        : "";
  const filters = [
    `received_at >= ${lookbackParameter}`,
    skipSql,
    rangeEndSql,
  ].filter(Boolean);
  return {
    sql: `SELECT id, received_at
      FROM analytics_events
      WHERE ${predicate}
        AND ${filters.join("\n        AND ")}${cursorSql ? `\n        AND ${cursorSql}` : ""}
      ORDER BY received_at ${order}, id ${order} LIMIT ${limitParameter}`,
    args: [
      ...predicateArgs,
      lookbackStart,
      ...(skipSql === "event_name IS DISTINCT FROM 'http.response'"
        ? []
        : skipEventNames),
      ...rangeEndArgs,
      ...cursorArgs,
    ],
  };
}

export async function getFirstPartyAnalyticsBackfillHighWaterMark(
  scope: FirstPartyAnalyticsScope,
  options?: Pick<
    FirstPartyAnalyticsBackfillOptions,
    "lookbackDays" | "skipEventNames" | "now"
  >,
): Promise<FirstPartyAnalyticsBackfillCursor | null> {
  const db = getDbExec();
  const lookbackDays = configuredLookbackDays(options?.lookbackDays);
  const lookbackStart = backfillLookbackStart(
    options?.now?.() ?? new Date().toISOString(),
    lookbackDays,
  );
  const skipEventNames = configuredSkipEventNames(options?.skipEventNames);
  const branches = scope.orgId
    ? [
        { predicate: "org_id = $1", args: [scope.orgId] },
        {
          predicate: "org_id IS NULL AND owner_email = $1",
          args: [scope.userEmail],
        },
      ]
    : [
        {
          predicate: "org_id IS NULL AND owner_email = $1",
          args: [scope.userEmail],
        },
      ];
  const rows: Record<string, unknown>[] = [];
  for (const branch of branches) {
    const scoped = backfillBranchSql(
      branch.predicate,
      branch.args,
      { receivedAt: "", id: "" },
      lookbackStart,
      skipEventNames,
      null,
      null,
      false,
      "DESC",
    );
    const result = await db.execute({
      sql: scoped.sql,
      args: [...scoped.args, 1],
      timeoutMs: 20_000,
      maxAttempts: 1,
    });
    rows.push(...(result.rows as Record<string, unknown>[]));
  }
  rows.sort((left, right) => compareBackfillRows(right, left));
  return rows.length ? backfillRowCursor(rows[0]!) : null;
}

function backfillRowsByIdsSql(ids: string[]): {
  sql: string;
  args: string[];
} {
  return {
    sql: `SELECT ${FIRST_PARTY_ANALYTICS_BACKFILL_COLUMNS.join(", ")}
      FROM analytics_events
      WHERE id IN (${ids.map((_, index) => `$${index + 1}`).join(", ")})`,
    args: ids,
  };
}

const MAX_BIND_VARIABLES = 900;

function backfillRowCursor(
  row: Record<string, unknown>,
): FirstPartyAnalyticsBackfillCursor {
  const id = row.id;
  const receivedAt = row.received_at ?? row.receivedAt;
  if (typeof id !== "string" || !id) {
    throw new Error("First-party analytics backfill row is missing its id");
  }
  if (typeof receivedAt !== "string" || !receivedAt) {
    throw new Error(
      "First-party analytics backfill row is missing its received_at",
    );
  }
  return { receivedAt, id };
}

function compareBackfillRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftCursor = backfillRowCursor(left);
  const rightCursor = backfillRowCursor(right);
  return (
    leftCursor.receivedAt.localeCompare(rightCursor.receivedAt) ||
    leftCursor.id.localeCompare(rightCursor.id)
  );
}

export async function backfillFirstPartyAnalyticsBatch(
  scope: FirstPartyAnalyticsScope,
  cursor: string | null,
  limit: number,
  configuredTable?: string | null,
  options?: FirstPartyAnalyticsBackfillOptions,
): Promise<FirstPartyAnalyticsBackfillBatch> {
  const boundedLimit = Math.min(
    Math.max(Math.floor(limit), 1),
    MAX_BACKFILL_BATCH_SIZE,
  );
  const db = getDbExec();
  const parsedCursor = parseBackfillCursor(cursor);
  const lookbackDays = configuredLookbackDays(options?.lookbackDays);
  const lookbackStart = backfillLookbackStart(
    options?.now?.() ?? new Date().toISOString(),
    lookbackDays,
  );
  const skipEventNames = configuredSkipEventNames(options?.skipEventNames);
  const rangeStart = options?.rangeStart ?? null;
  const rangeEnd = options?.rangeEnd ?? null;
  const rangeEndInclusive = options?.rangeEndInclusive === true;
  const branches = scope.orgId
    ? [
        { predicate: "org_id = $1", args: [scope.orgId] },
        {
          predicate: "org_id IS NULL AND owner_email = $1",
          args: [scope.userEmail],
        },
      ]
    : [
        {
          predicate: "org_id IS NULL AND owner_email = $1",
          args: [scope.userEmail],
        },
      ];
  const rows: Record<string, unknown>[] = [];
  for (const branch of branches) {
    const scoped = backfillBranchSql(
      branch.predicate,
      branch.args,
      parsedCursor,
      lookbackStart,
      skipEventNames,
      rangeStart,
      rangeEnd,
      rangeEndInclusive,
    );
    const result = await db.execute({
      sql: scoped.sql,
      args: [...scoped.args, boundedLimit],
      timeoutMs: 20_000,
      maxAttempts: 1,
    });
    rows.push(...(result.rows as Record<string, unknown>[]));
  }
  rows.sort(compareBackfillRows);
  const selectedRows = rows.slice(0, boundedLimit);
  if (!selectedRows.length) {
    return {
      nextCursor: parsedCursor.receivedAt
        ? serializeBackfillCursor(parsedCursor)
        : null,
      copied: 0,
      complete: true,
    };
  }

  const selectedIds = selectedRows.map((row) => backfillRowCursor(row).id);
  const hydratedRows: Record<string, unknown>[] = [];
  for (
    let offset = 0;
    offset < selectedIds.length;
    offset += MAX_BIND_VARIABLES
  ) {
    const hydratedQuery = backfillRowsByIdsSql(
      selectedIds.slice(offset, offset + MAX_BIND_VARIABLES),
    );
    const hydratedResult = await db.execute({
      sql: hydratedQuery.sql,
      args: hydratedQuery.args,
      timeoutMs: 20_000,
      maxAttempts: 1,
    });
    hydratedRows.push(...(hydratedResult.rows as Record<string, unknown>[]));
  }
  const hydratedById = new Map(
    hydratedRows.map((row) => [backfillRowCursor(row).id, row]),
  );
  const selectedEvents = selectedIds.map((id) => {
    const row = hydratedById.get(id);
    if (!row) {
      throw new Error(
        `First-party analytics backfill row ${id} disappeared before hydration`,
      );
    }
    return row;
  });
  await insertFirstPartyAnalyticsRows(selectedEvents, configuredTable);
  const lastCursor = backfillRowCursor(selectedRows[selectedRows.length - 1]!);
  return {
    nextCursor: serializeBackfillCursor({
      receivedAt: lastCursor.receivedAt,
      id: lastCursor.id,
    }),
    copied: selectedEvents.length,
    complete: rows.length < boundedLimit,
  };
}
