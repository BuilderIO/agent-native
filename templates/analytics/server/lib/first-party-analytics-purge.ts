import { getDbExec } from "@agent-native/core/db";

export interface FirstPartyAnalyticsPurgeScope {
  userEmail: string;
  orgId: string;
}

export interface FirstPartyAnalyticsPostgresPurgeCounts {
  eventRows: number;
  dailyRollupRows: number;
  userDayRows: number;
}

export interface FirstPartyAnalyticsPurgeWindow {
  startReceivedAt: string;
  startEventDate: string;
}

type CountTable =
  | "analytics_events"
  | "analytics_event_daily_rollups"
  | "analytics_user_days";

type CountTimeColumn = "received_at" | "event_date";

const PURGE_BATCH_SIZE = 10_000;
const PURGE_BATCH_TIMEOUT_MS = 60_000;
const PURGE_COUNT_TIMEOUT_MS = 60_000;
const DELIVERY_QUEUE_TABLE = "analytics_bigquery_delivery_queue";

function pendingDeliveryFilter(enabled: boolean): string {
  if (!enabled) return "";
  return ` AND NOT EXISTS (
    SELECT 1
    FROM ${DELIVERY_QUEUE_TABLE} AS delivery_queue
    WHERE delivery_queue.event_id = analytics_events.id
      AND delivery_queue.delivered_at IS NULL
  )`;
}

async function deliveryQueueTableExists(): Promise<boolean> {
  const { rows } = await getDbExec().execute({
    sql: "SELECT to_regclass($1) AS table_name",
    args: [DELIVERY_QUEUE_TABLE],
    timeoutMs: PURGE_COUNT_TIMEOUT_MS,
    maxAttempts: 1,
  });
  const value = (rows[0] as { table_name?: unknown } | undefined)?.table_name;
  if (value === null) return false;
  if (typeof value === "string" && value) return true;
  throw new Error("Postgres table existence check returned an invalid value");
}

function purgeWhereSql(
  table: CountTable,
  scope: FirstPartyAnalyticsPurgeScope,
  includeLegacyOwnerRows: boolean,
  window: FirstPartyAnalyticsPurgeWindow,
  protectPendingDelivery: boolean,
): { sql: string; args: unknown[]; timeColumn: CountTimeColumn } {
  const scopeSql = includeLegacyOwnerRows
    ? "(org_id = $1 OR (org_id IS NULL AND owner_email = $2))"
    : "org_id = $1";
  const args: unknown[] = includeLegacyOwnerRows
    ? [scope.orgId, scope.userEmail]
    : [scope.orgId];
  const timeParameter = args.length + 1;
  const timeColumn =
    table === "analytics_events" ? "received_at" : "event_date";
  args.push(
    timeColumn === "received_at"
      ? window.startReceivedAt
      : window.startEventDate,
  );
  const eventFilter =
    table === "analytics_events"
      ? " AND event_name IS DISTINCT FROM 'http.response'" +
        pendingDeliveryFilter(protectPendingDelivery)
      : "";
  return {
    sql: `${scopeSql}${eventFilter} AND ${timeColumn} >= $${timeParameter}`,
    args,
    timeColumn,
  };
}

async function countScopedRows(
  table: CountTable,
  timeColumn: CountTimeColumn,
  scope: FirstPartyAnalyticsPurgeScope,
  includeLegacyOwnerRows: boolean,
  window: FirstPartyAnalyticsPurgeWindow,
  protectPendingDelivery: boolean,
): Promise<number> {
  const scopeSql = includeLegacyOwnerRows
    ? "(org_id = $1 OR (org_id IS NULL AND owner_email = $2))"
    : "org_id = $1";
  const args: unknown[] = includeLegacyOwnerRows
    ? [scope.orgId, scope.userEmail]
    : [scope.orgId];
  const timeParameter = args.length + 1;
  const eventFilter =
    table === "analytics_events"
      ? "\n             AND event_name IS DISTINCT FROM 'http.response'" +
        pendingDeliveryFilter(protectPendingDelivery)
      : "";
  args.push(
    timeColumn === "received_at"
      ? window.startReceivedAt
      : window.startEventDate,
  );

  const { rows } = await getDbExec().execute({
    sql: `SELECT COUNT(*) AS row_count
           FROM ${table}
           WHERE ${scopeSql}
             ${eventFilter}
             AND ${timeColumn} >= $${timeParameter}`,
    args,
    timeoutMs: PURGE_COUNT_TIMEOUT_MS,
    maxAttempts: 1,
  });
  const rawCount = (rows[0] as { row_count?: unknown } | undefined)?.row_count;
  const value = Number(rawCount);
  if (!Number.isFinite(value)) {
    throw new Error(`Postgres count returned an invalid value for ${table}`);
  }
  return value;
}

export async function countFirstPartyAnalyticsPostgresRows(
  scope: FirstPartyAnalyticsPurgeScope,
  includeLegacyOwnerRows: boolean,
  window: FirstPartyAnalyticsPurgeWindow,
  protectPendingDelivery?: boolean,
): Promise<FirstPartyAnalyticsPostgresPurgeCounts> {
  const shouldProtectPendingDelivery =
    protectPendingDelivery ?? (await deliveryQueueTableExists());
  const [eventRows, dailyRollupRows, userDayRows] = await Promise.all([
    countScopedRows(
      "analytics_events",
      "received_at",
      scope,
      includeLegacyOwnerRows,
      window,
      shouldProtectPendingDelivery,
    ),
    countScopedRows(
      "analytics_event_daily_rollups",
      "event_date",
      scope,
      includeLegacyOwnerRows,
      window,
      shouldProtectPendingDelivery,
    ),
    countScopedRows(
      "analytics_user_days",
      "event_date",
      scope,
      includeLegacyOwnerRows,
      window,
      shouldProtectPendingDelivery,
    ),
  ]);
  return { eventRows, dailyRollupRows, userDayRows };
}

export async function purgeFirstPartyAnalyticsPostgresRows(
  scope: FirstPartyAnalyticsPurgeScope,
  includeLegacyOwnerRows: boolean,
  window: FirstPartyAnalyticsPurgeWindow,
): Promise<FirstPartyAnalyticsPostgresPurgeCounts> {
  const protectPendingDelivery = await deliveryQueueTableExists();
  const counts = await countFirstPartyAnalyticsPostgresRows(
    scope,
    includeLegacyOwnerRows,
    window,
    protectPendingDelivery,
  );

  for (const table of [
    "analytics_events",
    "analytics_event_daily_rollups",
    "analytics_user_days",
  ] as const) {
    const {
      sql: whereSql,
      args,
      timeColumn,
    } = purgeWhereSql(
      table,
      scope,
      includeLegacyOwnerRows,
      window,
      protectPendingDelivery,
    );
    while (true) {
      const result = await getDbExec().execute({
        sql: `WITH candidates AS (
          SELECT id
          FROM ${table}
          WHERE ${whereSql}
          ORDER BY ${timeColumn}, id
          LIMIT $${args.length + 1}
        )
        DELETE FROM ${table}
        WHERE id IN (SELECT id FROM candidates)`,
        args: [...args, PURGE_BATCH_SIZE],
        timeoutMs: PURGE_BATCH_TIMEOUT_MS,
        maxAttempts: 1,
      });
      if (Number(result.rowsAffected ?? 0) < PURGE_BATCH_SIZE) break;
    }
  }
  return counts;
}
