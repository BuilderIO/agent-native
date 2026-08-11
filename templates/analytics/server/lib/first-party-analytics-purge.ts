import { and, count, eq, gte, isNull, or } from "drizzle-orm";

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

async function countScopedRows(table: any, predicate: any): Promise<number> {
  const [row] = await (getDb() as any)
    .select({ count: count() })
    .from(table)
    .where(predicate);
  const value = Number(row?.count ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export async function countFirstPartyAnalyticsPostgresRows(
  scope: FirstPartyAnalyticsPurgeScope,
  includeLegacyOwnerRows: boolean,
  window: FirstPartyAnalyticsPurgeWindow,
): Promise<FirstPartyAnalyticsPostgresPurgeCounts> {
  const predicates = [
    windowPredicate(
      schema.analyticsEvents,
      scopePredicate(schema.analyticsEvents, scope, includeLegacyOwnerRows),
      window,
    ),
    windowPredicate(
      schema.analyticsEventDailyRollups,
      scopePredicate(
        schema.analyticsEventDailyRollups,
        scope,
        includeLegacyOwnerRows,
      ),
      window,
    ),
    windowPredicate(
      schema.analyticsUserDays,
      scopePredicate(schema.analyticsUserDays, scope, includeLegacyOwnerRows),
      window,
    ),
  ];
  const [eventRows, dailyRollupRows, userDayRows] = await Promise.all([
    countScopedRows(schema.analyticsEvents, predicates[0]),
    countScopedRows(schema.analyticsEventDailyRollups, predicates[1]),
    countScopedRows(schema.analyticsUserDays, predicates[2]),
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
