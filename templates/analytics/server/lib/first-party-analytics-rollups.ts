import { isPostgres } from "@agent-native/core/db";
import { sql } from "@agent-native/core/db/schema";

import { getDb, schema } from "../db/index.js";
import { FIRST_PARTY_ANALYTICS_ROLLUP_LOCK_KEY } from "./analytics-rollup-lock.js";

/**
 * The normalized subset emitted by first-party analytics ingest. Keeping this
 * contract smaller than the raw event row makes it clear that rollups never
 * need to parse properties or context JSON.
 */
export interface NormalizedFirstPartyAnalyticsEventRow {
  eventName: string;
  eventDate: string;
  ownerEmail: string;
  orgId?: string | null;
  userKey?: string | null;
  app?: string | null;
  template?: string | null;
}

export interface FirstPartyAnalyticsRollupResult {
  eventCount: number;
  dailyRollupCount: number;
  userDayCount: number;
}

interface DailyRollupRow {
  id: string;
  tenantKey: string;
  ownerEmail: string;
  orgId: string | null;
  eventDate: string;
  eventName: string;
  app: string;
  template: string;
  eventCount: number;
}

interface UserDayRow {
  id: string;
  tenantKey: string;
  ownerEmail: string;
  orgId: string | null;
  eventDate: string;
  userKey: string;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Analytics rollup row requires a non-empty ${field}`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(`Analytics rollup row ${field} must be a string or null`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function tenantKey(ownerEmail: string, orgId: string | null): string {
  return orgId ? `org:${orgId}` : `user:${ownerEmail}`;
}

function compositeKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${parts.map((part) => encodeURIComponent(part)).join("|")}`;
}

/**
 * Upsert compact rollups for a normalized batch. When ingestion passes its
 * transaction through, raw events and rollups share one commit boundary.
 */
export async function upsertFirstPartyAnalyticsRollups(
  rows: readonly NormalizedFirstPartyAnalyticsEventRow[],
  transaction?: any,
): Promise<FirstPartyAnalyticsRollupResult> {
  const dailyRollups = new Map<string, DailyRollupRow>();
  const userDays = new Map<string, UserDayRow>();

  for (const row of rows) {
    const eventName = requiredString(row.eventName, "eventName");
    const eventDate = requiredString(row.eventDate, "eventDate");
    const ownerEmail = requiredString(row.ownerEmail, "ownerEmail");
    const orgId = nullableString(row.orgId, "orgId");
    const userKey = nullableString(row.userKey, "userKey");
    const app = nullableString(row.app, "app") ?? "";
    const template = nullableString(row.template, "template") ?? "";
    const scopeKey = tenantKey(ownerEmail, orgId);
    const dailyKey = compositeKey([
      scopeKey,
      eventDate,
      eventName,
      app,
      template,
    ]);
    const existingDaily = dailyRollups.get(dailyKey);

    if (existingDaily) {
      existingDaily.eventCount += 1;
    } else {
      dailyRollups.set(dailyKey, {
        id: stableId("aedr", [scopeKey, eventDate, eventName, app, template]),
        tenantKey: scopeKey,
        ownerEmail,
        orgId,
        eventDate,
        eventName,
        app,
        template,
        eventCount: 1,
      });
    }

    if (userKey) {
      const userDayKey = compositeKey([scopeKey, eventDate, userKey]);
      if (!userDays.has(userDayKey)) {
        userDays.set(userDayKey, {
          id: stableId("aud", [scopeKey, eventDate, userKey]),
          tenantKey: scopeKey,
          ownerEmail,
          orgId,
          eventDate,
          userKey,
        });
      }
    }
  }

  if (dailyRollups.size === 0) {
    return {
      eventCount: rows.length,
      dailyRollupCount: 0,
      userDayCount: 0,
    };
  }

  const writeRollups = async (tx: any) => {
    if (isPostgres()) {
      // The historical backfill takes this lock before its raw-event
      // snapshot. Holding it through ingest's rollup increment prevents the
      // backfill's monotonic upsert from losing a concurrently committed
      // event.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${FIRST_PARTY_ANALYTICS_ROLLUP_LOCK_KEY}, 0::bigint))`,
      );
    }
    const dailyRows = [...dailyRollups.values()];
    await tx
      .insert(schema.analyticsEventDailyRollups)
      .values(dailyRows)
      .onConflictDoUpdate({
        target: [
          schema.analyticsEventDailyRollups.tenantKey,
          schema.analyticsEventDailyRollups.eventDate,
          schema.analyticsEventDailyRollups.eventName,
          schema.analyticsEventDailyRollups.app,
          schema.analyticsEventDailyRollups.template,
        ],
        set: {
          eventCount: sql`${schema.analyticsEventDailyRollups.eventCount} + excluded.event_count`,
        },
      });

    const userDayRows = [...userDays.values()];
    if (userDayRows.length > 0) {
      await tx
        .insert(schema.analyticsUserDays)
        .values(userDayRows)
        .onConflictDoNothing({
          target: [
            schema.analyticsUserDays.tenantKey,
            schema.analyticsUserDays.eventDate,
            schema.analyticsUserDays.userKey,
          ],
        });
    }
  };

  if (transaction) {
    await writeRollups(transaction);
  } else {
    await (getDb() as any).transaction(writeRollups);
  }

  return {
    eventCount: rows.length,
    dailyRollupCount: dailyRollups.size,
    userDayCount: userDays.size,
  };
}
