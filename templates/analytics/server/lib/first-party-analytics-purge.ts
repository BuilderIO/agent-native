import { getDbExec } from "@agent-native/core/db";
import { and, eq, gte, isNull, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

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

function scopePredicate(
  table: {
    orgId: any;
    ownerEmail: any;
  },
  scope: FirstPartyAnalyticsPurgeScope,
  includeLegacyOwnerRows: boolean,
) {
  if (!includeLegacyOwnerRows) return eq(table.orgId, scope.orgId);
  return or(
    eq(table.orgId, scope.orgId),
    and(isNull(table.orgId), eq(table.ownerEmail, scope.userEmail)),
  );
}

function windowPredicate(
  table: {
    eventDate: any;
    receivedAt?: any;
  },
  predicate: any,
  window: FirstPartyAnalyticsPurgeWindow,
) {
  return table.receivedAt
    ? and(predicate, gte(table.receivedAt, window.startReceivedAt))
    : and(predicate, gte(table.eventDate, window.startEventDate));
}

type CountTable =
  | "analytics_events"
  | "analytics_event_daily_rollups"
  | "analytics_user_days";

type CountTimeColumn = "received_at" | "event_date";

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
  args.push(
    timeColumn === "received_at"
      ? window.startReceivedAt
      : window.startEventDate,
  );

  const { rows } = await getDbExec().execute({
    sql: `SELECT COUNT(*) AS row_count
            FROM ${table}
           WHERE ${scopeSql}
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
  await (getDb() as any).transaction(async (tx: any) => {
    await tx
      .delete(schema.analyticsEvents)
      .where(
        windowPredicate(
          schema.analyticsEvents,
          scopePredicate(schema.analyticsEvents, scope, includeLegacyOwnerRows),
          window,
        ),
      );
    await tx
      .delete(schema.analyticsEventDailyRollups)
      .where(
        windowPredicate(
          schema.analyticsEventDailyRollups,
          scopePredicate(
            schema.analyticsEventDailyRollups,
            scope,
            includeLegacyOwnerRows,
          ),
          window,
        ),
      );
    await tx
      .delete(schema.analyticsUserDays)
      .where(
        windowPredicate(
          schema.analyticsUserDays,
          scopePredicate(
            schema.analyticsUserDays,
            scope,
            includeLegacyOwnerRows,
          ),
          window,
        ),
      );
  });
  return counts;
}
