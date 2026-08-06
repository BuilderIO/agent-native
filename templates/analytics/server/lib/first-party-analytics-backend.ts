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

interface FirstPartyAnalyticsBackfillCursor {
  receivedAt: string;
  id: string;
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

function maskSqlLiterals(sql: string): string {
  const chars = [...sql];
  let inLiteral = false;
  for (let index = 0; index < chars.length; index++) {
    if (chars[index] !== "'") continue;
    if (!inLiteral) {
      inLiteral = true;
      chars[index] = " ";
      continue;
    }
    if (chars[index + 1] === "'") {
      chars[index] = " ";
      chars[index + 1] = " ";
      index++;
      continue;
    }
    chars[index] = " ";
    inLiteral = false;
  }
  for (let index = 0; index < chars.length; index++) {
    if (inLiteral) chars[index] = " ";
  }
  return chars.join("");
}

function rewriteOutsideSqlLiterals(
  sql: string,
  rewrite: (code: string) => string,
): string {
  let result = "";
  let cursor = 0;
  while (cursor < sql.length) {
    const literalStart = sql.indexOf("'", cursor);
    if (literalStart === -1) {
      result += rewrite(sql.slice(cursor));
      break;
    }
    result += rewrite(sql.slice(cursor, literalStart));
    let literalEnd = literalStart + 1;
    while (literalEnd < sql.length) {
      if (sql[literalEnd] !== "'") {
        literalEnd++;
        continue;
      }
      if (sql[literalEnd + 1] === "'") {
        literalEnd += 2;
        continue;
      }
      literalEnd++;
      break;
    }
    result += sql.slice(literalStart, literalEnd);
    cursor = literalEnd;
  }
  return result;
}

function findMatchingSqlParen(sql: string, openIndex: number): number {
  let depth = 0;
  let inLiteral = false;
  for (let index = openIndex; index < sql.length; index++) {
    const char = sql[index];
    if (char === "'") {
      if (inLiteral && sql[index + 1] === "'") {
        index++;
        continue;
      }
      inLiteral = !inLiteral;
      continue;
    }
    if (inLiteral) continue;
    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelSqlArgs(value: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let inLiteral = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "'") {
      if (inLiteral && value[index + 1] === "'") {
        index++;
        continue;
      }
      inLiteral = !inLiteral;
      continue;
    }
    if (inLiteral) continue;
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
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
      throw new Error(
        `First-party BigQuery query does not support PostgreSQL ${normalizedType} casts`,
      );
    }

    let operandEnd = match.index;
    while (operandEnd > 0 && /\s/.test(result[operandEnd - 1] ?? "")) {
      operandEnd--;
    }
    let operandStart = operandEnd;
    if (result[operandEnd - 1] === ")") {
      let depth = 0;
      for (let index = operandEnd - 1; index >= 0; index--) {
        if (result[index] === ")") depth++;
        if (result[index] !== "(") continue;
        depth--;
        if (depth === 0) {
          operandStart = index;
          break;
        }
      }
    } else {
      while (
        operandStart > 0 &&
        /[A-Za-z0-9_.$]/.test(result[operandStart - 1] ?? "")
      ) {
        operandStart--;
      }
    }
    if (operandStart === operandEnd) {
      throw new Error(
        "First-party BigQuery query has an invalid PostgreSQL cast",
      );
    }
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
  let translated = replacePostgresCastsInCode(value.trim());
  translated = translated
    .replace(/\bnow\s*\(\s*\)/gi, "CURRENT_TIMESTAMP()")
    .replace(/\bCURRENT_DATE\b(?!\s*\()/gi, "CURRENT_DATE()")
    .replace(/\bCURRENT_TIMESTAMP\b(?!\s*\()/gi, "CURRENT_TIMESTAMP()");
  translated = replaceBigQueryDateArithmetic(translated);
  return translated.trim();
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

function translatePostgresJsonOperators(sql: string): string {
  return sql.replace(
    /\b([A-Za-z_][A-Za-z0-9_.]*)\s*::\s*jsonb\s*->>\s*'([^']+)'/gi,
    (_match, expression: string, key: string) =>
      `JSON_VALUE(${expression}, '$.${key}')`,
  );
}

function translateFirstPartyAnalyticsBigQuerySql(sql: string): string {
  let translated = translatePostgresJsonOperators(sql);
  translated = translated.replace(
    /\bINTERVAL\s*'(\d+)\s+(day|days|week|weeks|month|months)'/gi,
    (_match, amount: string, unit: string) =>
      `INTERVAL ${amount} ${unit.replace(/s$/i, "").toUpperCase()}`,
  );
  translated = rewriteSqlFunctionCalls(translated, "date_trunc", (args) => {
    if (args.length !== 2 || !/^'week'$/i.test(args[0] ?? "")) {
      throw new Error(
        "First-party BigQuery query only supports PostgreSQL date_trunc('week', ...) expressions",
      );
    }
    return `DATE_TRUNC(CAST(${translatePostgresDateExpression(args[1] ?? "")} AS DATE), WEEK(MONDAY))`;
  });
  translated = rewriteSqlFunctionCalls(translated, "to_char", (args) => {
    if (args.length !== 2 || !/^'YYYY-MM-DD'$/i.test(args[1] ?? "")) {
      throw new Error(
        "First-party BigQuery query only supports PostgreSQL to_char(..., 'YYYY-MM-DD') expressions",
      );
    }
    return `FORMAT_DATE('%Y-%m-%d', CAST(${translatePostgresDateExpression(args[0] ?? "")} AS DATE))`;
  });
  translated = rewriteSqlFunctionCalls(translated, "chr", (args) => {
    if (args.length !== 1) {
      throw new Error("First-party BigQuery query has an invalid chr call");
    }
    return `CHR(${args[0]})`;
  });
  let previous = "";
  while (previous !== translated) {
    previous = translated;
    translated = rewriteSqlFunctionCalls(translated, "split_part", (args) => {
      const index = Number(args[2]);
      if (args.length !== 3 || !Number.isInteger(index) || index < 1) {
        throw new Error(
          "First-party BigQuery query only supports split_part with a positive integer index",
        );
      }
      return `SPLIT(${args[0]}, ${args[1]})[SAFE_OFFSET(${index - 1})]`;
    });
  }
  translated = rewriteOutsideSqlLiterals(translated, (code) => {
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
  ];
  const incompatible = unsupported.find(([pattern]) => pattern.test(code));
  if (incompatible) {
    throw new Error(
      `First-party analytics query uses unsupported PostgreSQL syntax (${incompatible[1]}) after BigQuery translation`,
    );
  }
  return translated;
}

function qualifyQuerySources(sql: string, table: BigQueryTableRef): string {
  const physical = firstPartyAnalyticsPhysicalTables(table);
  const sourceMap: Record<string, string> = {
    // Event predicates are injected by scopedAnalyticsSql. Use the raw table
    // here so those predicates run before the retry-deduplication window.
    analytics_events: firstPartyAnalyticsRawTable(table),
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

function addPartitionPrunedEventDeduplication(
  sql: string,
  table: BigQueryTableRef,
): string {
  const quote = String.fromCharCode(96);
  const source =
    "SELECT * FROM " +
    quote +
    firstPartyAnalyticsRawTable(table) +
    quote +
    " WHERE";
  let result = "";
  let cursor = 0;
  while (cursor < sql.length) {
    const sourceIndex = sql.indexOf(source, cursor);
    if (sourceIndex === -1) return result + sql.slice(cursor);
    const predicateStart = sourceIndex + source.length;
    let depth = 0;
    let inLiteral = false;
    let predicateEnd = sql.length;
    for (let index = predicateStart; index < sql.length; index++) {
      const char = sql[index];
      if (char === "'") {
        if (inLiteral && sql[index + 1] === "'") {
          index++;
          continue;
        }
        inLiteral = !inLiteral;
        continue;
      }
      if (inLiteral) continue;
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
      if (depth === 0 && /^UNION\s+ALL\b/i.test(sql.slice(index))) {
        predicateEnd = index;
        break;
      }
    }
    result +=
      sql.slice(cursor, predicateEnd) +
      " QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY received_at DESC) = 1";
    cursor = predicateEnd;
  }
  return result;
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
  const translated =
    translateFirstPartyAnalyticsBigQuerySql(normalizedScopeSql);
  const bound = bindSqlArguments(translated, args);
  return addPartitionPrunedEventDeduplication(
    qualifyQuerySources(bound, table),
    table,
  );
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
  const result = await runQuery(
    "SELECT COUNT(*) AS row_count FROM " + quote + table.fullyQualified + quote,
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

function backfillScopeSql(
  scope: FirstPartyAnalyticsScope,
  cursor: FirstPartyAnalyticsBackfillCursor,
): {
  sql: string;
  args: string[];
} {
  const cursorSql = "(received_at > ? OR (received_at = ? AND id > ?))";
  const orderLimitSql = "ORDER BY received_at ASC, id ASC LIMIT ?";
  if (scope.orgId) {
    return {
      sql: `SELECT * FROM (
        SELECT * FROM analytics_events
        WHERE org_id = ? AND ${cursorSql}
        UNION ALL
        SELECT * FROM analytics_events
        WHERE org_id IS NULL AND owner_email = ? AND ${cursorSql}
      ) AS scoped_events ${orderLimitSql}`,
      args: [
        scope.orgId,
        cursor.receivedAt,
        cursor.receivedAt,
        cursor.id,
        scope.userEmail,
        cursor.receivedAt,
        cursor.receivedAt,
        cursor.id,
      ],
    };
  }
  return {
    sql: `SELECT * FROM analytics_events
      WHERE org_id IS NULL AND owner_email = ? AND ${cursorSql}
      ${orderLimitSql}`,
    args: [scope.userEmail, cursor.receivedAt, cursor.receivedAt, cursor.id],
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
  const parsedCursor = parseBackfillCursor(cursor);
  const scoped = backfillScopeSql(scope, parsedCursor);
  const result = await db.execute({
    sql: scoped.sql,
    args: [...scoped.args, boundedLimit],
    timeoutMs: 20_000,
    maxAttempts: 1,
  });
  const rows = result.rows as Record<string, unknown>[];
  if (!rows.length) {
    return {
      nextCursor: serializeBackfillCursor(parsedCursor),
      copied: 0,
      complete: true,
    };
  }
  await insertFirstPartyAnalyticsRows(rows, configuredTable);
  const lastId = rows[rows.length - 1]?.id;
  if (typeof lastId !== "string" || !lastId) {
    throw new Error("First-party analytics backfill row is missing its id");
  }
  const lastReceivedAt =
    rows[rows.length - 1]?.received_at ?? rows[rows.length - 1]?.receivedAt;
  if (typeof lastReceivedAt !== "string" || !lastReceivedAt) {
    throw new Error(
      "First-party analytics backfill row is missing its received_at",
    );
  }
  return {
    nextCursor: serializeBackfillCursor({
      receivedAt: lastReceivedAt,
      id: lastId,
    }),
    copied: rows.length,
    complete: rows.length < boundedLimit,
  };
}
