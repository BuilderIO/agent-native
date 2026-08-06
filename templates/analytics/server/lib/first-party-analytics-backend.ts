import { getDbExec } from "@agent-native/core/db";

import {
  getBigQueryProjectId,
  runQuery,
  type BigQueryTableRef,
} from "./bigquery.js";
import { requireRequestCredentialContext } from "./credentials-context.js";
import { getAccessToken } from "./gcloud.js";
import {
  getScopedSettingRecord,
  putScopedSettingRecord,
} from "./scoped-settings.js";

export const FIRST_PARTY_ANALYTICS_BACKEND_SETTING =
  "first-party-analytics-backend";

export type FirstPartyAnalyticsSink = "postgres" | "dual" | "bigquery";

export interface FirstPartyAnalyticsBackendConfig {
  sink: FirstPartyAnalyticsSink;
  table: string | null;
  backfillCursor?: string | null;
  backfillCompleted?: boolean;
}

export interface FirstPartyAnalyticsScope {
  userEmail: string;
  orgId: string | null;
}

interface FirstPartyAnalyticsBackendSetting {
  sink?: unknown;
  table?: unknown;
  backfillCursor?: unknown;
  backfillCompleted?: unknown;
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
const FIRST_PARTY_QUERY_TABLES = [
  "analytics_events",
  "analytics_event_daily_rollups",
  "analytics_user_days",
] as const;
const BACKEND_CONFIG_CACHE_TTL_MS = 30_000;

const backendConfigCache = new Map<
  string,
  { config: FirstPartyAnalyticsBackendConfig; expiresAt: number }
>();

function backendScopeKey(scope: FirstPartyAnalyticsScope): string {
  return `${scope.orgId ? `o:${scope.orgId}` : "u:"}${scope.userEmail}`;
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

function normalizeSink(value: unknown): FirstPartyAnalyticsSink {
  return value === "dual" || value === "bigquery" ? value : "postgres";
}

export async function getFirstPartyAnalyticsBackend(
  scope: FirstPartyAnalyticsScope,
): Promise<FirstPartyAnalyticsBackendConfig> {
  const cacheKey = backendScopeKey(scope);
  const cached = backendConfigCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const setting = (await getScopedSettingRecord(
    { email: scope.userEmail, orgId: scope.orgId },
    FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
  )) as FirstPartyAnalyticsBackendSetting | null;
  const config = {
    sink: normalizeSink(setting?.sink),
    table: typeof setting?.table === "string" ? setting.table : null,
    backfillCursor:
      typeof setting?.backfillCursor === "string"
        ? setting.backfillCursor
        : null,
    backfillCompleted: setting?.backfillCompleted === true,
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
  await putScopedSettingRecord(
    { email: scope.userEmail, orgId: scope.orgId },
    FIRST_PARTY_ANALYTICS_BACKEND_SETTING,
    {
      sink: config.sink,
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

export function resetFirstPartyAnalyticsBackendCacheForTests(): void {
  backendConfigCache.clear();
}

export async function getFirstPartyAnalyticsTable(
  configuredTable?: string | null,
): Promise<BigQueryTableRef> {
  const projectId = await getBigQueryProjectId();
  return parseTableRef(configuredTable, projectId);
}

function tableName(table: BigQueryTableRef, suffix: string): string {
  return `${table.projectId}.${table.datasetId}.${table.tableId}${suffix}`;
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

async function insertBatch(
  table: BigQueryTableRef,
  token: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${table.projectId}/datasets/${table.datasetId}/tables/${table.tableId}/insertAll`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        skipInvalidRows: false,
        ignoreUnknownValues: false,
        rows: rows.map((row) => ({
          insertId: typeof row.id === "string" ? row.id : undefined,
          json: row,
        })),
      }),
    },
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
  if (result.insertErrors?.length) {
    const detail = result.insertErrors
      .flatMap((entry) => entry.errors ?? [])
      .map((entry) => entry.message)
      .filter((message): message is string => Boolean(message))
      .slice(0, 3)
      .join("; ");
    throw new Error(
      `BigQuery rejected ${result.insertErrors.length} event row(s)${detail ? `: ${detail}` : ""}`,
    );
  }
}

export async function insertFirstPartyAnalyticsRows(
  rows: Array<FirstPartyAnalyticsEventRow | Record<string, unknown>>,
  configuredTable?: string | null,
): Promise<number> {
  if (!rows.length) return 0;
  requireRequestCredentialContext("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const [table, token] = await Promise.all([
    getFirstPartyAnalyticsTable(configuredTable),
    getAccessToken(),
  ]);
  const payloadRows = rows.map(firstPartyEventRowToBigQuery);
  for (let offset = 0; offset < payloadRows.length; offset += 50) {
    await insertBatch(table, token, payloadRows.slice(offset, offset + 50));
  }
  return payloadRows.length;
}

function sqlLiteral(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function bindSqlArguments(sql: string, args: Array<string | null>): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    const value = args[index++];
    if (value === undefined) {
      throw new Error("First-party BigQuery query has too few bind arguments");
    }
    return sqlLiteral(value);
  });
}

function qualifyQuerySources(sql: string, table: BigQueryTableRef): string {
  const physical = firstPartyAnalyticsPhysicalTables(table);
  const sourceMap: Record<string, string> = {
    analytics_events: physical.events,
    analytics_event_daily_rollups: physical.dailyRollups,
    analytics_user_days: physical.userDays,
  };
  const sourcePattern = FIRST_PARTY_QUERY_TABLES.join("|");
  return sql.replace(
    new RegExp(`\\b(from|join)\\s+(${sourcePattern})\\b`, "gi"),
    (_match, keyword: string, logicalName: string) =>
      `${keyword} \`${sourceMap[logicalName.toLowerCase()] ?? logicalName}\``,
  );
}

export function renderFirstPartyAnalyticsBigQuerySql(
  scopedSql: string,
  args: Array<string | null>,
  table: BigQueryTableRef,
): string {
  // The Postgres/SQLite scope builder uses a text fallback for nullable event
  // dates. BigQuery's event_date is a DATE, and the fallback is unnecessary
  // because the sink normalizes it before insert.
  const normalizedScopeSql = scopedSql.replace(
    /\(COALESCE\(NULLIF\(event_date, ''\), substr\(timestamp, 1, 10\)\) <= \?\)/g,
    "(event_date <= ?)",
  );
  return qualifyQuerySources(bindSqlArguments(normalizedScopeSql, args), table);
}

export async function queryFirstPartyAnalyticsInBigQuery(
  scopedSql: string,
  args: Array<string | null>,
  table: BigQueryTableRef,
): Promise<{
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
}> {
  const result = await runQuery(
    `SELECT * FROM (${renderFirstPartyAnalyticsBigQuerySql(scopedSql, args, table)}) AS first_party_analytics_query LIMIT 5000`,
  );
  return { rows: result.rows, schema: result.schema };
}

export async function assertFirstPartyAnalyticsBigQueryReady(
  configuredTable?: string | null,
): Promise<{ table: BigQueryTableRef; rowCount: number }> {
  const table = await getFirstPartyAnalyticsTable(configuredTable);
  const result = await runQuery(
    `SELECT COUNT(*) AS row_count FROM \`${table.projectId}.${table.datasetId}.${table.tableId}\``,
  );
  const rowCount = Number(result.rows[0]?.row_count ?? 0);
  return { table, rowCount: Number.isFinite(rowCount) ? rowCount : 0 };
}

export async function getFirstPartyAnalyticsBigQueryMetrics(
  scope: FirstPartyAnalyticsScope,
  configuredTable?: string | null,
): Promise<{
  eventCount: number;
  dailyRollupRows: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
}> {
  const table = await getFirstPartyAnalyticsTable(configuredTable);
  const physical = firstPartyAnalyticsPhysicalTables(table);
  const ownerEmail = sqlLiteral(scope.userEmail);
  const today = sqlLiteral(new Date().toISOString().slice(0, 10));
  const tenantFilter = scope.orgId
    ? `(org_id = ${sqlLiteral(scope.orgId)} OR (org_id IS NULL AND owner_email = ${ownerEmail}))`
    : `(org_id IS NULL AND owner_email = ${ownerEmail})`;
  const result = await runQuery(`
    WITH scoped_events AS (
      SELECT *
      FROM \`${physical.events}\`
      WHERE ${tenantFilter} AND event_date <= ${today}
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
  `);
  const row = result.rows[0] ?? {};
  const numberValue = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const dateValue = (value: unknown): string | null => {
    if (typeof value === "string" && value) return value.slice(0, 10);
    return null;
  };
  return {
    eventCount: numberValue(row.event_count),
    dailyRollupRows: numberValue(row.daily_rollup_rows),
    firstEventDate: dateValue(row.first_event_date),
    lastEventDate: dateValue(row.last_event_date),
  };
}

export interface FirstPartyAnalyticsBackfillBatch {
  nextCursor: string | null;
  copied: number;
  complete: boolean;
}

function backfillScopeSql(scope: FirstPartyAnalyticsScope): {
  sql: string;
  args: string[];
} {
  if (scope.orgId) {
    return {
      sql: `WHERE (org_id = ? OR (org_id IS NULL AND owner_email = ?)) AND id > ? ORDER BY id LIMIT ?`,
      args: [scope.orgId, scope.userEmail],
    };
  }
  return {
    sql: `WHERE org_id IS NULL AND owner_email = ? AND id > ? ORDER BY id LIMIT ?`,
    args: [scope.userEmail],
  };
}

export async function backfillFirstPartyAnalyticsBatch(
  scope: FirstPartyAnalyticsScope,
  cursor: string | null,
  limit: number,
  configuredTable?: string | null,
): Promise<FirstPartyAnalyticsBackfillBatch> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
  const db = getDbExec();
  const scoped = backfillScopeSql(scope);
  const result = await db.execute({
    sql: `SELECT * FROM analytics_events ${scoped.sql}`,
    args: [...scoped.args, cursor ?? "", boundedLimit],
    timeoutMs: 20_000,
    maxAttempts: 1,
  });
  const rows = result.rows as Record<string, unknown>[];
  if (!rows.length) {
    return { nextCursor: cursor, copied: 0, complete: true };
  }
  await insertFirstPartyAnalyticsRows(rows, configuredTable);
  const lastId = rows[rows.length - 1]?.id;
  if (typeof lastId !== "string" || !lastId) {
    throw new Error("First-party analytics backfill row is missing its id");
  }
  return {
    nextCursor: lastId,
    copied: rows.length,
    complete: rows.length < boundedLimit,
  };
}
