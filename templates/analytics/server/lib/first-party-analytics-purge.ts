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

const PURGE_BATCH_SIZE = 5_000;
const PURGE_BATCH_TIMEOUT_MS = 30_000;

function purgeWhereSql(
  table: CountTable,
  scope: FirstPartyAnalyticsPurgeScope,
  includeLegacyOwnerRows: boolean,
  window: FirstPartyAnalyticsPurgeWindow,
): { sql: string; args: unknown[]; timeColumn: CountTimeColumn } {
  const scopeSql = includeLegacyOwnerRows
    ? "(org_id = ? OR (org_id IS NULL AND owner_email = ?))"
    : "org_id = ?";
  const args: unknown[] = includeLegacyOwnerRows
    ? [scope.orgId, scope.userEmail]
    : [scope.orgId];
  const timeColumn =
    table === "analytics_events" ? "received_at" : "event_date";
  args.push(
    timeColumn === "received_at"
      ? window.startReceivedAt
      : window.startEventDate,
  );
  const eventFilter =
    table === "analytics_events"
      ? " AND event_name IS DISTINCT FROM 'http.response'"
      : "";
  return {
    sql: `${scopeSql}${eventFilter} AND ${timeColumn} >= ?`,
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
): Promise<number> {
  const scopeSql = includeLegacyOwnerRows
    ? "(org_id = ? OR (org_id IS NULL AND owner_email = ?))"
    : "org_id = ?";
  const args: unknown[] = includeLegacyOwnerRows
    ? [scope.orgId, scope.userEmail]
    : [scope.orgId];
  const eventFilter =
    table === "analytics_events"
      ? "\n             AND event_name IS DISTINCT FROM 'http.response'"
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
             AND ${timeColumn} >= ?`,
    args,
    timeoutMs: 5_000,
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
): Promise<FirstPartyAnalyticsPostgresPurgeCounts> {
  const [eventRows, dailyRollupRows, userDayRows] = await Promise.all([
    countScopedRows(
      "analytics_events",
      "received_at",
      scope,
      includeLegacyOwnerRows,
      window,
    ),
    countScopedRows(
      "analytics_event_daily_rollups",
      "event_date",
      scope,
      includeLegacyOwnerRows,
      window,
    ),
    countScopedRows(
      "analytics_user_days",
      "event_date",
      scope,
      includeLegacyOwnerRows,
      window,
    ),
  ]);
  return { eventRows, dailyRollupRows, userDayRows };
}

export async function purgeFirstPartyAnalyticsPostgresRows(
  scope: FirstPartyAnalyticsPurgeScope,
  includeLegacyOwnerRows: boolean,
  window: FirstPartyAnalyticsPurgeWindow,
): Promise<FirstPartyAnalyticsPostgresPurgeCounts> {
  const counts = await countFirstPartyAnalyticsPostgresRows(
    scope,
    includeLegacyOwnerRows,
    window,
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
    } = purgeWhereSql(table, scope, includeLegacyOwnerRows, window);
    while (true) {
      const result = await getDbExec().execute({
        sql: `WITH candidates AS (
          SELECT id
          FROM ${table}
          WHERE ${whereSql}
          ORDER BY ${timeColumn}, id
          LIMIT ?
        )
        DELETE FROM ${table}
        WHERE id IN (SELECT id FROM candidates)
        RETURNING id`,
        args: [...args, PURGE_BATCH_SIZE],
        timeoutMs: PURGE_BATCH_TIMEOUT_MS,
        maxAttempts: 1,
      });
      if (result.rows.length < PURGE_BATCH_SIZE) break;
    }
  }
  return counts;
}
