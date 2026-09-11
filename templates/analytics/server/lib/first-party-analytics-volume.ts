import { and, eq, sql } from "drizzle-orm";

import { schema } from "../db/index.js";

export const FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT_ENV =
  "ANALYTICS_FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT";
export const FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS_ENV =
  "ANALYTICS_FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS";

export const DEFAULT_FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT = 1_000_000;
export const DEFAULT_FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS = 30;

const MAX_EVENT_VOLUME_LIMIT = 100_000_000;
const MIN_VOLUME_WINDOW_DAYS = 1;
const MAX_VOLUME_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface FirstPartyPostgresEventVolumeConfig {
  eventLimit: number;
  windowDays: number;
}

export interface FirstPartyPostgresEventVolumeScope {
  ownerEmail: string;
  orgId: string | null;
  receivedAt: string;
}

export interface FirstPartyPostgresEventVolumeReservation {
  tenantKey: string;
  windowStart: string;
  eventCount: number;
  eventLimit: number;
}

export class FirstPartyPostgresEventVolumeLimitError extends Error {
  readonly statusCode = 429;

  constructor(
    readonly reservation: FirstPartyPostgresEventVolumeReservation,
    requested: number,
  ) {
    super(
      `Postgres first-party Analytics volume limit reached for this ${reservation.windowStart} window: ${reservation.eventCount}/${reservation.eventLimit} events reserved; connect your own analytics database or BigQuery before sending more events (requested ${requested}).`,
    );
    this.name = "FirstPartyPostgresEventVolumeLimitError";
  }
}

function parseIntegerEnv(
  environment: Record<string, string | undefined>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${key} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${key} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

export function getFirstPartyPostgresEventVolumeConfig(
  environment: Record<string, string | undefined> = process.env,
): FirstPartyPostgresEventVolumeConfig {
  return {
    eventLimit: parseIntegerEnv(
      environment,
      FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT_ENV,
      DEFAULT_FIRST_PARTY_POSTGRES_EVENT_VOLUME_LIMIT,
      1,
      MAX_EVENT_VOLUME_LIMIT,
    ),
    windowDays: parseIntegerEnv(
      environment,
      FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS_ENV,
      DEFAULT_FIRST_PARTY_POSTGRES_EVENT_VOLUME_WINDOW_DAYS,
      MIN_VOLUME_WINDOW_DAYS,
      MAX_VOLUME_WINDOW_DAYS,
    ),
  };
}

export function firstPartyPostgresEventVolumeWindowStart(
  receivedAt: string,
  windowDays: number,
): string {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new Error(
      "First-party Analytics volume window must be a positive integer",
    );
  }
  const receivedAtMs = Date.parse(receivedAt);
  if (!Number.isFinite(receivedAtMs)) {
    throw new Error(
      "First-party Analytics volume receivedAt must be an ISO timestamp",
    );
  }
  const windowMs = windowDays * DAY_MS;
  return new Date(Math.floor(receivedAtMs / windowMs) * windowMs).toISOString();
}

function tenantKey(
  scope: Pick<FirstPartyPostgresEventVolumeScope, "ownerEmail" | "orgId">,
): string {
  return scope.orgId ? `org:${scope.orgId}` : `user:${scope.ownerEmail}`;
}

function reservationId(tenant: string, windowStart: string): string {
  return `aevu_${encodeURIComponent(tenant)}_${encodeURIComponent(windowStart)}`;
}

export async function reserveFirstPartyPostgresEventVolume(
  transaction: any,
  scope: FirstPartyPostgresEventVolumeScope,
  requested: number,
): Promise<FirstPartyPostgresEventVolumeReservation> {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(
      "First-party Analytics volume reservation must be positive",
    );
  }
  const config = getFirstPartyPostgresEventVolumeConfig();
  const scopedTenantKey = tenantKey(scope);
  const windowStart = firstPartyPostgresEventVolumeWindowStart(
    scope.receivedAt,
    config.windowDays,
  );

  await transaction
    .insert(schema.analyticsEventVolumeUsage)
    .values({
      id: reservationId(scopedTenantKey, windowStart),
      tenantKey: scopedTenantKey,
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId,
      windowStart,
      eventCount: 0,
      eventLimit: config.eventLimit,
      updatedAt: scope.receivedAt,
    })
    .onConflictDoNothing({
      target: [
        schema.analyticsEventVolumeUsage.tenantKey,
        schema.analyticsEventVolumeUsage.windowStart,
      ],
    });

  const [updated] = await transaction
    .update(schema.analyticsEventVolumeUsage)
    .set({
      eventCount: sql`${schema.analyticsEventVolumeUsage.eventCount} + ${requested}`,
      eventLimit: config.eventLimit,
      updatedAt: scope.receivedAt,
    })
    .where(
      and(
        eq(schema.analyticsEventVolumeUsage.tenantKey, scopedTenantKey),
        eq(schema.analyticsEventVolumeUsage.windowStart, windowStart),
        sql`${schema.analyticsEventVolumeUsage.eventCount} + ${requested} <= ${config.eventLimit}`,
      ),
    )
    .returning({
      eventCount: schema.analyticsEventVolumeUsage.eventCount,
      eventLimit: schema.analyticsEventVolumeUsage.eventLimit,
    });

  if (!updated) {
    const [current] = await transaction
      .select({
        eventCount: schema.analyticsEventVolumeUsage.eventCount,
        eventLimit: schema.analyticsEventVolumeUsage.eventLimit,
      })
      .from(schema.analyticsEventVolumeUsage)
      .where(
        and(
          eq(schema.analyticsEventVolumeUsage.tenantKey, scopedTenantKey),
          eq(schema.analyticsEventVolumeUsage.windowStart, windowStart),
        ),
      )
      .limit(1);
    const reservation = {
      tenantKey: scopedTenantKey,
      windowStart,
      eventCount: Number(current?.eventCount ?? 0),
      eventLimit: Number(current?.eventLimit ?? config.eventLimit),
    };
    throw new FirstPartyPostgresEventVolumeLimitError(reservation, requested);
  }

  return {
    tenantKey: scopedTenantKey,
    windowStart,
    eventCount: Number(updated.eventCount),
    eventLimit: Number(updated.eventLimit),
  };
}
