import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { bigint, table, text } from "@agent-native/core/db/schema";
import { registerIdentityColumns } from "@agent-native/core/org";
import { getAppConfig } from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { and, eq, gte, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

const allowanceTable = schema.hostedClipAllowances;
const applicationState = table("application_state", {
  sessionId: text("session_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
const ALLOWANCE_LOCK_KEY = "clips-hosted-clip-allowances";
// The ledger functions without a policy argument share these limits with `hostedPolicy()`, so they read the same config.
const hostedStorageConfig = () => getAppConfig().clips.hostedStorage;
type HostedClipAllowanceTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

registerIdentityColumns([
  {
    table: "clips_hosted_clip_allowances",
    column: "identity_key",
    emailChange: "retain",
    offboard: "retain",
    reason:
      "Canonical email history prevents email changes from resetting hosted recording eligibility.",
  },
  {
    table: "clips_hosted_clip_allowances",
    column: "user_id",
    emailChange: "retain",
    offboard: "retain",
    reason:
      "Stable account history prevents a renamed or offboarded account from resetting hosted recording eligibility.",
  },
]);

export const HOSTED_CLIP_ALLOWANCE_DENIAL_REASONS = [
  "unverified",
  "disposable",
  "ip_velocity",
  "global_daily_cap",
  "global_storage_cap",
  "disabled",
  "exhausted",
  "sign_in_required",
] as const;

export type HostedClipAllowanceDenialReason =
  (typeof HOSTED_CLIP_ALLOWANCE_DENIAL_REASONS)[number];

export type HostedClipAllowanceStatus = "reserved" | "consumed" | "released";

export type HostedClipAllowancePolicy = {
  enabled: boolean;
  perIdentityClipLimit: number;
  ipPrefixDailyGrantCap?: number;
  globalDailyClipCap?: number;
  globalRetainedByteCap?: number;
  retainedByteAlertRatio?: number;
  reservationBytes: number;
  disposableDomains?: ReadonlySet<string>;
};

export type HostedClipAllowance = typeof allowanceTable.$inferSelect;

export type HostedClipAllowanceSnapshot = {
  identityKey: string | null;
  userId: string | null;
  consumedCount: number;
  reservedCount: number;
  remainingCount: number;
  retainedBytes: number;
  reservedBytes: number;
  status: "available" | "denied";
  denialReason: HostedClipAllowanceDenialReason | null;
};

export type HostedClipAllowanceReservationResult =
  | {
      ok: true;
      allowance: HostedClipAllowance;
      alreadyReserved: boolean;
    }
  | { ok: false; reason: HostedClipAllowanceDenialReason };

export type HostedClipAllowanceRetryResult =
  | {
      ok: true;
      allowance: HostedClipAllowance;
      alreadyReserved: boolean;
    }
  | {
      ok: false;
      reason: "exhausted" | "global_storage_cap" | "invalid_transition";
    };

export function hostedCleanupConfirmedKey(recordingId: string): string {
  return `hosted-cleanup-confirmed-${recordingId}`;
}

export async function writeHostedCleanupConfirmedMarker(input: {
  recordingId: string;
  ownerEmail: string;
  videoUrl?: string | null;
}): Promise<string> {
  const sessionId = input.ownerEmail.trim().toLowerCase();
  if (!sessionId) throw new Error("Hosted cleanup marker requires an owner.");
  const value = JSON.stringify({
    videoUrl: input.videoUrl ?? null,
    cleanupId: randomUUID(),
  });
  await withAllowanceLock(async (tx) => {
    await tx
      .insert(applicationState)
      .values({
        sessionId,
        key: hostedCleanupConfirmedKey(input.recordingId),
        value,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [applicationState.sessionId, applicationState.key],
        set: { value, updatedAt: Date.now() },
      });
  });
  return value;
}

export type HostedClipAllowanceStorageResult =
  | { ok: true; allowance: HostedClipAllowance }
  | { ok: false; reason: "global_storage_cap" };

export class HostedClipAllowanceInvariantError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "not_found"
      | "owner_mismatch"
      | "invalid_transition",
    message: string,
  ) {
    super(message);
    this.name = "HostedClipAllowanceInvariantError";
  }
}

/** Returns the stable email identity used for hosted allowance accounting. */
export function canonicalHostedClipIdentityKey(
  email: string | null | undefined,
): string | null {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;

  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1 || normalized.indexOf("@") !== at)
    return null;

  let local = normalized.slice(0, at);
  let domain = normalized.slice(at + 1);
  if (!local || !domain || /\s/.test(normalized)) return null;

  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    local = local.split("+", 1)[0]!.replace(/\./g, "");
    if (!local) return null;
  }

  return `${local}@${domain}`;
}

/**
 * Buckets an IP literal to the prefix used for grant-velocity checks.
 * Callers should pass an address obtained from a trusted server-side source.
 */
export function hostedClipIpPrefix(
  ip: string | null | undefined,
): string | null {
  if (!ip || ip.includes("%")) return null;
  const version = isIP(ip);
  if (version === 4) {
    const octets = ip.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255))
      return null;
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (version !== 6) return null;

  const normalizedIp = ip.toLowerCase();
  const embeddedIpv4 = normalizedIp.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  let address = normalizedIp;
  if (embeddedIpv4) {
    const octets = embeddedIpv4[1]!.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255))
      return null;
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    address = `${normalizedIp.slice(0, -embeddedIpv4[1]!.length)}${high}:${low}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0]!.split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];
  const missingSegments = 8 - left.length - right.length;
  if ((halves.length === 1 && missingSegments !== 0) || missingSegments < 0)
    return null;
  const segments = [
    ...left,
    ...Array.from({ length: missingSegments }, () => "0"),
    ...right,
  ];
  if (
    segments.length !== 8 ||
    segments.some((segment) => !/^[0-9a-f]{1,4}$/.test(segment))
  )
    return null;

  return `${segments
    .slice(0, 4)
    .map((segment) => segment.padStart(4, "0"))
    .join(":")}:0000:0000:0000:0000/64`;
}

function assertPolicy(policy: HostedClipAllowancePolicy): void {
  const values: Array<[string, number | undefined, boolean]> = [
    ["perIdentityClipLimit", policy.perIdentityClipLimit, false],
    ["reservationBytes", policy.reservationBytes, true],
    ["ipPrefixDailyGrantCap", policy.ipPrefixDailyGrantCap, true],
    ["globalDailyClipCap", policy.globalDailyClipCap, true],
    ["globalRetainedByteCap", policy.globalRetainedByteCap, true],
  ];
  for (const [name, value, optional] of values) {
    if (optional && value === undefined) continue;
    if (
      value === undefined ||
      !Number.isSafeInteger(value) ||
      value < (name === "reservationBytes" ? 0 : 1)
    ) {
      throw new HostedClipAllowanceInvariantError(
        "invalid_input",
        `Hosted recording allowance policy has an invalid ${name}.`,
      );
    }
  }
  if (
    policy.retainedByteAlertRatio !== undefined &&
    (!Number.isFinite(policy.retainedByteAlertRatio) ||
      policy.retainedByteAlertRatio < 0 ||
      policy.retainedByteAlertRatio > 1)
  ) {
    throw new HostedClipAllowanceInvariantError(
      "invalid_input",
      "Hosted recording allowance alert ratio must be between zero and one.",
    );
  }
}

function assertRetainedByteCap(
  globalRetainedByteCap: number | undefined,
): void {
  if (globalRetainedByteCap === undefined) return;
  assertPolicy({
    enabled: true,
    perIdentityClipLimit: 1,
    reservationBytes: 0,
    globalRetainedByteCap,
  });
}

function assertByteCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HostedClipAllowanceInvariantError(
      "invalid_input",
      `Hosted recording allowance ${name} must be a non-negative safe integer.`,
    );
  }
}

export type HostedClipReleaseReason =
  | "abort"
  | "abandon"
  | "create_failed"
  | "upload_failed"
  | "finalize_failed"
  | "cleanup"
  | "takedown"
  | "orphan_reaped"
  | "failed_cleanup";

interface HostedClipEvent {
  name: string;
  props: Record<string, unknown>;
  userId?: string | undefined;
}

function hostedLevel(retainedBytes: number, globalRetainedByteCap?: number) {
  return {
    retainedBytes,
    ...(globalRetainedByteCap === undefined
      ? {}
      : {
          globalRetainedByteCap,
          ratio: retainedBytes / globalRetainedByteCap,
        }),
  };
}

/** Events are emitted after the transaction resolves so a rollback never reports. */
function emitHostedClipEvents(events: HostedClipEvent[]): void {
  for (const event of events) {
    const log =
      event.name === "clips_hosted_retained_bytes_threshold"
        ? console.warn
        : console.info;
    log(`[clips-hosted] ${event.name}`, {
      ...event.props,
      userId: event.userId,
    });
    try {
      track(
        event.name,
        { app_name: "clips", template_name: "clips", ...event.props },
        event.userId ? { userId: event.userId } : undefined,
      );
    } catch {
      // coercion-ok: analytics is best-effort; the log line above already carries the event.
    }
  }
}

function hostedDeniedEvent(
  recordingId: string,
  userId: string | undefined,
  denyReason: HostedClipAllowanceDenialReason,
  stage: "reserve" | "retry" | "consume",
): HostedClipEvent {
  return {
    name: "clips_hosted_denied",
    userId,
    props: { recordingId, denyReason, stage },
  };
}

function retainedByteThresholdEvent(input: {
  recordingId: string;
  userId: string;
  retainedBytesBefore: number;
  retainedBytesAfter: number;
  globalRetainedByteCap?: number | undefined;
  retainedByteAlertRatio?: number | undefined;
}): HostedClipEvent | null {
  const { globalRetainedByteCap, retainedByteAlertRatio = 0.8 } = input;
  if (globalRetainedByteCap === undefined) return null;
  const threshold = Math.max(
    1,
    Math.ceil(globalRetainedByteCap * retainedByteAlertRatio),
  );
  const crossed =
    input.retainedBytesBefore < threshold &&
    input.retainedBytesAfter >= threshold;
  if (!crossed) return null;
  return {
    name: "clips_hosted_retained_bytes_threshold",
    userId: input.userId,
    props: {
      recordingId: input.recordingId,
      thresholdBytes: threshold,
      ...hostedLevel(input.retainedBytesAfter, globalRetainedByteCap),
    },
  };
}

function assertAggregate(
  value: number | null | undefined,
  name: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new HostedClipAllowanceInvariantError(
      "invalid_input",
      `Hosted recording allowance ${name} aggregate is unreadable.`,
    );
  }
  return value;
}

function disposableDomainMatches(
  emailKey: string,
  disposableDomains: ReadonlySet<string> | undefined,
): boolean {
  if (!disposableDomains?.size) return false;
  const domain = emailKey.slice(emailKey.lastIndexOf("@") + 1);
  for (const candidate of disposableDomains) {
    const normalized = candidate
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, "");
    if (
      normalized &&
      (domain === normalized || domain.endsWith(`.${normalized}`))
    )
      return true;
  }
  return false;
}

function utcDayBounds(now: Date): { start: string; end: string } {
  if (!Number.isFinite(now.getTime())) {
    throw new HostedClipAllowanceInvariantError(
      "invalid_input",
      "Hosted recording allowance time is invalid.",
    );
  }
  const startDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    start: startDate.toISOString(),
    end: new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function createdDuringUtcDay(now: Date) {
  const { start, end } = utcDayBounds(now);
  const createdAt = sql`${allowanceTable.createdAt}::timestamptz`;
  return and(
    gte(createdAt, sql`${start}::timestamptz`),
    lt(createdAt, sql`${end}::timestamptz`),
  );
}

function identityOwnerWhere(identityKey: string, userId: string) {
  return or(
    eq(allowanceTable.identityKey, identityKey),
    eq(allowanceTable.userId, userId),
  );
}

async function withAllowanceLock<T>(
  run: (
    tx: HostedClipAllowanceTransaction,
    events: HostedClipEvent[],
  ) => Promise<T>,
): Promise<T> {
  const events: HostedClipEvent[] = [];
  const result = await getDb().transaction(async (tx) => {
    // The global byte and daily caps span identities, so every state change shares one lock.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${ALLOWANCE_LOCK_KEY}, 0::bigint))`,
    );
    return run(tx, events);
  });
  emitHostedClipEvents(events);
  return result;
}

async function countRows(
  db: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  where: ReturnType<typeof and>,
): Promise<number> {
  const [result] = await db
    .select({ value: sql<number>`count(*)::integer`.mapWith(Number) })
    .from(allowanceTable)
    .where(where);
  return assertAggregate(result?.value, "count");
}

async function readActiveByteTotal(
  db: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
): Promise<number> {
  const [result] = await db
    .select({
      value:
        sql<number>`COALESCE(SUM(${allowanceTable.quotaBytes}), 0)::float8`.mapWith(
          Number,
        ),
    })
    .from(allowanceTable)
    .where(inArray(allowanceTable.status, ["reserved", "consumed"]));
  return assertAggregate(result?.value, "retained byte count");
}

async function hostedReleasedEvent(
  tx: HostedClipAllowanceTransaction,
  input: {
    recordingId: string;
    userId: string;
    reason: HostedClipReleaseReason;
    releasedBytes: number;
    globalRetainedByteCap: number | undefined;
  },
): Promise<HostedClipEvent> {
  return {
    name: "clips_hosted_released",
    userId: input.userId,
    props: {
      recordingId: input.recordingId,
      reason: input.reason,
      releasedBytes: input.releasedBytes,
      ...hostedLevel(
        await readActiveByteTotal(tx),
        input.globalRetainedByteCap,
      ),
    },
  };
}

async function findOwnedAllowance(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  recordingId: string,
  userId: string,
): Promise<HostedClipAllowance> {
  const [allowance] = await tx
    .select()
    .from(allowanceTable)
    .where(eq(allowanceTable.recordingId, recordingId))
    .limit(1);
  if (!allowance) {
    throw new HostedClipAllowanceInvariantError(
      "not_found",
      "Hosted recording allowance was not found.",
    );
  }
  if (allowance.userId !== userId) {
    throw new HostedClipAllowanceInvariantError(
      "owner_mismatch",
      "Hosted recording allowance belongs to another user.",
    );
  }
  return allowance;
}

async function reservationDenialReason(input: {
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
  identityKey: string;
  userId: string;
  ipPrefix: string | null;
  policy: HostedClipAllowancePolicy;
  now: Date;
}): Promise<HostedClipAllowanceDenialReason | null> {
  const { tx, identityKey, userId, ipPrefix, policy, now } = input;
  const day = createdDuringUtcDay(now);

  if (ipPrefix && policy.ipPrefixDailyGrantCap !== undefined) {
    const [priorGrant] = await tx
      .select({ value: sql<number>`count(*)::integer`.mapWith(Number) })
      .from(allowanceTable)
      .where(
        and(
          eq(allowanceTable.ipPrefix, ipPrefix),
          day,
          or(
            eq(allowanceTable.identityKey, identityKey),
            eq(allowanceTable.userId, userId),
          ),
        ),
      )
      .limit(1);
    if (!assertAggregate(priorGrant?.value, "IP identity count")) {
      // Released rows still represent a grant made to this account and prefix today.
      const [prefixCount] = await tx
        .select({
          value:
            sql<number>`count(DISTINCT ${allowanceTable.userId})::integer`.mapWith(
              Number,
            ),
        })
        .from(allowanceTable)
        .where(and(eq(allowanceTable.ipPrefix, ipPrefix), day));
      if (
        assertAggregate(prefixCount?.value, "IP prefix daily count") >=
        policy.ipPrefixDailyGrantCap
      ) {
        return "ip_velocity";
      }
    }
  }

  if (policy.globalDailyClipCap !== undefined) {
    // A created reservation spends one global grant even if its upload is later released.
    const dailyCount = await countRows(tx, day);
    if (dailyCount >= policy.globalDailyClipCap) return "global_daily_cap";
  }

  if (policy.globalRetainedByteCap !== undefined) {
    const retainedBytes = await readActiveByteTotal(tx);
    if (retainedBytes + policy.reservationBytes > policy.globalRetainedByteCap)
      return "global_storage_cap";
  }

  const identityRows = await countRows(
    tx,
    and(
      identityOwnerWhere(identityKey, userId),
      inArray(allowanceTable.status, ["reserved", "consumed"]),
    ),
  );
  return identityRows >= policy.perIdentityClipLimit ? "exhausted" : null;
}

export async function reserveHostedClipAllowance(input: {
  email: string | null | undefined;
  emailVerified: boolean;
  userId: string | null | undefined;
  recordingId: string;
  ipPrefix: string | null;
  policy: HostedClipAllowancePolicy;
  now?: Date;
}): Promise<HostedClipAllowanceReservationResult> {
  const emailKey = canonicalHostedClipIdentityKey(input.email);
  const userId = input.userId?.trim();
  const deny = (reason: HostedClipAllowanceDenialReason) => {
    emitHostedClipEvents([
      hostedDeniedEvent(
        input.recordingId,
        userId || undefined,
        reason,
        "reserve",
      ),
    ]);
    return { ok: false, reason } as const;
  };
  if (!emailKey || !userId) return deny("sign_in_required");
  if (!input.emailVerified) return deny("unverified");
  if (disposableDomainMatches(emailKey, input.policy.disposableDomains))
    return deny("disposable");
  if (!input.policy.enabled) return deny("disabled");
  assertPolicy(input.policy);
  if (!input.recordingId.trim()) {
    throw new HostedClipAllowanceInvariantError(
      "invalid_input",
      "Hosted recording allowance needs a recording id.",
    );
  }

  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  return withAllowanceLock(async (tx, events) => {
    const [existing] = await tx
      .select()
      .from(allowanceTable)
      .where(eq(allowanceTable.recordingId, input.recordingId))
      .limit(1);
    if (existing) {
      if (existing.userId !== userId) {
        throw new HostedClipAllowanceInvariantError(
          "owner_mismatch",
          "Hosted recording allowance belongs to another user.",
        );
      }
      if (existing.status === "released") {
        throw new HostedClipAllowanceInvariantError(
          "invalid_transition",
          "A released hosted recording allowance cannot be reserved again.",
        );
      }
      return { ok: true, allowance: existing, alreadyReserved: true };
    }

    if (!input.ipPrefix && input.policy.ipPrefixDailyGrantCap !== undefined) {
      // Fail open: the per-prefix cap cannot apply to a request with no usable client IP.
      console.warn("[clips-hosted] ip_prefix_unavailable", {
        recordingId: input.recordingId,
        userId,
        reason: "ip_prefix_daily_grant_cap_not_applied",
      });
    }

    const denialReason = await reservationDenialReason({
      tx,
      identityKey: emailKey,
      userId,
      ipPrefix: input.ipPrefix || null,
      policy: input.policy,
      now,
    });
    if (denialReason) {
      events.push(
        hostedDeniedEvent(input.recordingId, userId, denialReason, "reserve"),
      );
      return { ok: false, reason: denialReason };
    }

    const retainedBytesBefore = await readActiveByteTotal(tx);
    const [allowance] = await tx
      .insert(allowanceTable)
      .values({
        recordingId: input.recordingId,
        identityKey: emailKey,
        userId,
        status: "reserved",
        ipPrefix: input.ipPrefix,
        quotaBytes: input.policy.reservationBytes,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    if (!allowance) {
      throw new HostedClipAllowanceInvariantError(
        "invalid_input",
        "Hosted recording allowance reservation did not persist.",
      );
    }
    const retainedBytesAfter =
      retainedBytesBefore + input.policy.reservationBytes;
    events.push({
      name: "clips_hosted_reserved",
      userId,
      props: {
        recordingId: input.recordingId,
        reservedBytes: input.policy.reservationBytes,
        ...hostedLevel(retainedBytesAfter, input.policy.globalRetainedByteCap),
      },
    });
    const crossed = retainedByteThresholdEvent({
      recordingId: input.recordingId,
      userId,
      retainedBytesBefore,
      retainedBytesAfter,
      globalRetainedByteCap: input.policy.globalRetainedByteCap,
      retainedByteAlertRatio: input.policy.retainedByteAlertRatio,
    });
    if (crossed) events.push(crossed);
    return { ok: true, allowance, alreadyReserved: false };
  });
}

/** Restores the same grant when a failed hosted recording is explicitly retried. */
export async function reacquireHostedClipAllowanceForRetry(input: {
  recordingId: string;
  userId: string;
  ownerEmail: string;
  now?: Date;
}): Promise<HostedClipAllowanceRetryResult> {
  const {
    maxClipBytes: reservationBytes,
    perIdentityClipLimit,
    globalRetainedByteCap,
  } = hostedStorageConfig();
  assertPolicy({
    enabled: true,
    perIdentityClipLimit,
    reservationBytes,
    globalRetainedByteCap,
  });
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();
  const ownerEmail = input.ownerEmail.trim();
  if (!ownerEmail) return { ok: false, reason: "invalid_transition" };

  return withAllowanceLock(async (tx, events) => {
    const [recording] = await tx
      .select({
        status: schema.recordings.status,
        storageMode: schema.recordings.storageMode,
        failureCode: schema.recordings.failureCode,
      })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, input.recordingId),
          ilike(schema.recordings.ownerEmail, escapeLikeWildcards(ownerEmail)),
        ),
      )
      .for("update")
      .limit(1);
    if (
      recording?.storageMode !== "hosted" ||
      (recording.status !== "failed" && recording.status !== "uploading") ||
      recording.failureCode === "taken_down"
    ) {
      return { ok: false, reason: "invalid_transition" };
    }

    const current = await findOwnedAllowance(
      tx,
      input.recordingId,
      input.userId,
    );
    if (current.status === "consumed") {
      return { ok: false, reason: "invalid_transition" };
    }
    if (current.status === "reserved") {
      await tx
        .delete(applicationState)
        .where(
          and(
            eq(
              applicationState.sessionId,
              input.ownerEmail.trim().toLowerCase(),
            ),
            eq(
              applicationState.key,
              hostedCleanupConfirmedKey(input.recordingId),
            ),
          ),
        );
      return { ok: true, allowance: current, alreadyReserved: true };
    }

    const identityRows = await countRows(
      tx,
      and(
        identityOwnerWhere(current.identityKey, input.userId),
        inArray(allowanceTable.status, ["reserved", "consumed"]),
        ne(allowanceTable.recordingId, input.recordingId),
      ),
    );
    if (identityRows >= perIdentityClipLimit) {
      events.push(
        hostedDeniedEvent(
          input.recordingId,
          input.userId,
          "exhausted",
          "retry",
        ),
      );
      return { ok: false, reason: "exhausted" };
    }

    const retainedBytesBefore = await readActiveByteTotal(tx);
    if (
      globalRetainedByteCap !== undefined &&
      retainedBytesBefore + reservationBytes > globalRetainedByteCap
    ) {
      events.push(
        hostedDeniedEvent(
          input.recordingId,
          input.userId,
          "global_storage_cap",
          "retry",
        ),
      );
      return { ok: false, reason: "global_storage_cap" };
    }

    const [allowance] = await tx
      .update(allowanceTable)
      .set({
        status: "reserved",
        quotaBytes: reservationBytes,
        releasedAt: null,
        consumedAt: null,
        updatedAt,
      })
      .where(
        and(
          eq(allowanceTable.recordingId, input.recordingId),
          eq(allowanceTable.userId, input.userId),
          eq(allowanceTable.status, "released"),
        ),
      )
      .returning();
    if (!allowance) {
      throw new HostedClipAllowanceInvariantError(
        "invalid_transition",
        "Hosted recording allowance changed during retry reservation.",
      );
    }
    await tx
      .delete(applicationState)
      .where(
        and(
          eq(applicationState.sessionId, input.ownerEmail.trim().toLowerCase()),
          eq(
            applicationState.key,
            hostedCleanupConfirmedKey(input.recordingId),
          ),
        ),
      );
    events.push({
      name: "clips_hosted_reserved",
      userId: input.userId,
      props: {
        recordingId: input.recordingId,
        reservedBytes: reservationBytes,
        retry: true,
        ...hostedLevel(
          retainedBytesBefore + reservationBytes,
          globalRetainedByteCap,
        ),
      },
    });
    return { ok: true, allowance, alreadyReserved: false };
  });
}

export async function consumeHostedClipAllowance(input: {
  recordingId: string;
  userId: string;
  actualBytes: number;
  now?: Date;
}): Promise<HostedClipAllowanceStorageResult> {
  assertByteCount(input.actualBytes, "actual byte count");
  const { globalRetainedByteCap, retainedByteAlertRatio } =
    hostedStorageConfig();
  assertRetainedByteCap(globalRetainedByteCap);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();

  return withAllowanceLock(async (tx, events) => {
    const current = await findOwnedAllowance(
      tx,
      input.recordingId,
      input.userId,
    );
    if (current.status === "released") {
      throw new HostedClipAllowanceInvariantError(
        "invalid_transition",
        "A released hosted recording allowance cannot be consumed.",
      );
    }
    const retainedBytes = await readActiveByteTotal(tx);
    const nextTotal = retainedBytes - current.quotaBytes + input.actualBytes;
    if (
      globalRetainedByteCap !== undefined &&
      nextTotal > globalRetainedByteCap
    ) {
      events.push(
        hostedDeniedEvent(
          input.recordingId,
          input.userId,
          "global_storage_cap",
          "consume",
        ),
      );
      return { ok: false, reason: "global_storage_cap" };
    }

    const [allowance] = await tx
      .update(allowanceTable)
      .set({
        status: "consumed",
        quotaBytes: input.actualBytes,
        consumedAt: current.consumedAt ?? updatedAt,
        updatedAt,
      })
      .where(eq(allowanceTable.recordingId, input.recordingId))
      .returning();
    if (!allowance) {
      throw new HostedClipAllowanceInvariantError(
        "not_found",
        "Hosted recording allowance disappeared during consumption.",
      );
    }
    // A finalize retry on an already-consumed allowance only re-sizes it.
    if (current.status === "reserved") {
      events.push({
        name: "clips_hosted_consumed",
        userId: input.userId,
        props: {
          recordingId: input.recordingId,
          actualBytes: input.actualBytes,
          ...hostedLevel(nextTotal, globalRetainedByteCap),
        },
      });
    }
    const crossed = retainedByteThresholdEvent({
      recordingId: input.recordingId,
      userId: input.userId,
      retainedBytesBefore: retainedBytes,
      retainedBytesAfter: nextTotal,
      globalRetainedByteCap,
      retainedByteAlertRatio,
    });
    if (crossed) events.push(crossed);
    return { ok: true, allowance };
  });
}

export async function adjustHostedClipRetainedBytes(input: {
  recordingId: string;
  userId: string;
  retainedBytes: number;
  now?: Date;
}): Promise<HostedClipAllowanceStorageResult> {
  assertByteCount(input.retainedBytes, "retained byte count");
  const { globalRetainedByteCap, retainedByteAlertRatio } =
    hostedStorageConfig();
  assertRetainedByteCap(globalRetainedByteCap);
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();

  return withAllowanceLock(async (tx, events) => {
    const current = await findOwnedAllowance(
      tx,
      input.recordingId,
      input.userId,
    );
    if (current.status !== "consumed") {
      throw new HostedClipAllowanceInvariantError(
        "invalid_transition",
        "Only a consumed hosted recording allowance can have retained bytes adjusted.",
      );
    }
    const retainedBytes = await readActiveByteTotal(tx);
    const nextTotal = retainedBytes - current.quotaBytes + input.retainedBytes;
    if (input.retainedBytes > current.quotaBytes) {
      if (
        globalRetainedByteCap !== undefined &&
        nextTotal > globalRetainedByteCap
      ) {
        return { ok: false, reason: "global_storage_cap" };
      }
    }

    const [allowance] = await tx
      .update(allowanceTable)
      .set({ quotaBytes: input.retainedBytes, updatedAt })
      .where(eq(allowanceTable.recordingId, input.recordingId))
      .returning();
    if (!allowance) {
      throw new HostedClipAllowanceInvariantError(
        "not_found",
        "Hosted recording allowance disappeared during byte adjustment.",
      );
    }
    if (input.retainedBytes < current.quotaBytes) {
      events.push({
        name: "clips_hosted_media_deleted",
        userId: input.userId,
        props: {
          recordingId: input.recordingId,
          freedBytes: current.quotaBytes - input.retainedBytes,
          ...hostedLevel(nextTotal, globalRetainedByteCap),
        },
      });
    }
    const crossed = retainedByteThresholdEvent({
      recordingId: input.recordingId,
      userId: input.userId,
      retainedBytesBefore: retainedBytes,
      retainedBytesAfter: nextTotal,
      globalRetainedByteCap,
      retainedByteAlertRatio,
    });
    if (crossed) events.push(crossed);
    return { ok: true, allowance };
  });
}

async function addHostedClipRetainedBytes(
  input: {
    recordingId: string;
    userId: string;
    additionalBytes: number;
  },
  enforceCap: boolean,
): Promise<HostedClipAllowanceStorageResult> {
  assertByteCount(input.additionalBytes, "additional byte count");
  const { globalRetainedByteCap, retainedByteAlertRatio } =
    hostedStorageConfig();
  if (enforceCap) assertRetainedByteCap(globalRetainedByteCap);
  const enforcedCap = enforceCap ? globalRetainedByteCap : undefined;
  return withAllowanceLock(async (tx, events) => {
    const current = await findOwnedAllowance(
      tx,
      input.recordingId,
      input.userId,
    );
    if (current.status !== "consumed") {
      throw new HostedClipAllowanceInvariantError(
        "invalid_transition",
        "Only a consumed hosted recording allowance can add retained bytes.",
      );
    }

    const nextClipBytes = current.quotaBytes + input.additionalBytes;
    assertByteCount(nextClipBytes, "retained byte count");
    const retainedBytes = await readActiveByteTotal(tx);
    if (enforcedCap !== undefined) {
      if (retainedBytes + input.additionalBytes > enforcedCap) {
        events.push({
          name: "clips_hosted_derivative_rejected",
          userId: input.userId,
          props: {
            recordingId: input.recordingId,
            additionalBytes: input.additionalBytes,
            ...hostedLevel(retainedBytes, enforcedCap),
          },
        });
        return { ok: false, reason: "global_storage_cap" };
      }
    }

    const [allowance] = await tx
      .update(allowanceTable)
      .set({ quotaBytes: nextClipBytes, updatedAt: new Date().toISOString() })
      .where(eq(allowanceTable.recordingId, input.recordingId))
      .returning();
    if (!allowance) {
      throw new HostedClipAllowanceInvariantError(
        "not_found",
        "Hosted recording allowance disappeared during byte accounting.",
      );
    }
    events.push({
      name: "clips_hosted_derivative_added",
      userId: input.userId,
      props: {
        recordingId: input.recordingId,
        additionalBytes: input.additionalBytes,
        ...hostedLevel(
          retainedBytes + input.additionalBytes,
          globalRetainedByteCap,
        ),
      },
    });
    const crossed = retainedByteThresholdEvent({
      recordingId: input.recordingId,
      userId: input.userId,
      retainedBytesBefore: retainedBytes,
      retainedBytesAfter: retainedBytes + input.additionalBytes,
      globalRetainedByteCap,
      retainedByteAlertRatio,
    });
    if (crossed) events.push(crossed);
    return { ok: true, allowance };
  });
}

export async function addHostedClipRetainedBytesWithinCap(input: {
  recordingId: string;
  userId: string;
  additionalBytes: number;
}): Promise<HostedClipAllowanceStorageResult> {
  return addHostedClipRetainedBytes(input, true);
}

/** Account for bytes already stored when a cap-denied cleanup also failed. */
export async function accountHostedClipAdditionalBytes(input: {
  recordingId: string;
  userId: string;
  additionalBytes: number;
}): Promise<HostedClipAllowanceStorageResult> {
  return addHostedClipRetainedBytes(input, false);
}

/**
 * Lowers a consumed recording's retained bytes by an object whose deletion the
 * provider confirmed. Looked up by recording id: the caller deleted an object
 * already bound to that recording. A reservation holds no stored bytes, so
 * anything other than a consumed row reports `adjusted: false`.
 */
export async function subtractHostedClipRetainedBytes(input: {
  recordingId: string;
  deletedBytes: number;
  now?: Date;
}): Promise<{ adjusted: boolean; quotaBytes: number }> {
  assertByteCount(input.deletedBytes, "deleted byte count");
  const updatedAt = (input.now ?? new Date()).toISOString();

  const { globalRetainedByteCap } = hostedStorageConfig();
  return withAllowanceLock(async (tx, events) => {
    const [current] = await tx
      .select()
      .from(allowanceTable)
      .where(eq(allowanceTable.recordingId, input.recordingId))
      .limit(1);
    if (!current) {
      throw new HostedClipAllowanceInvariantError(
        "not_found",
        "Hosted recording allowance was not found.",
      );
    }
    if (current.status !== "consumed" || input.deletedBytes === 0) {
      return { adjusted: false, quotaBytes: current.quotaBytes };
    }
    const quotaBytes = Math.max(0, current.quotaBytes - input.deletedBytes);
    await tx
      .update(allowanceTable)
      .set({ quotaBytes, updatedAt })
      .where(eq(allowanceTable.recordingId, input.recordingId));
    events.push({
      name: "clips_hosted_media_deleted",
      userId: current.userId,
      props: {
        recordingId: input.recordingId,
        freedBytes: current.quotaBytes - quotaBytes,
        ...hostedLevel(await readActiveByteTotal(tx), globalRetainedByteCap),
      },
    });
    return { adjusted: true, quotaBytes };
  });
}

export async function releaseHostedClipAllowance(input: {
  recordingId: string;
  userId: string;
  reason: HostedClipReleaseReason;
  now?: Date;
}): Promise<{
  ok: true;
  allowance: HostedClipAllowance;
  alreadyReleased: boolean;
}> {
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();

  const { globalRetainedByteCap } = hostedStorageConfig();
  return withAllowanceLock(async (tx, events) => {
    const current = await findOwnedAllowance(
      tx,
      input.recordingId,
      input.userId,
    );
    if (current.status === "consumed") {
      throw new HostedClipAllowanceInvariantError(
        "invalid_transition",
        "A consumed hosted recording allowance must retain its accounting row.",
      );
    }
    if (current.status === "released")
      return { ok: true, allowance: current, alreadyReleased: true };

    const [allowance] = await tx
      .update(allowanceTable)
      .set({
        status: "released",
        quotaBytes: 0,
        releasedAt: updatedAt,
        updatedAt,
      })
      .where(eq(allowanceTable.recordingId, input.recordingId))
      .returning();
    if (!allowance) {
      throw new HostedClipAllowanceInvariantError(
        "not_found",
        "Hosted recording allowance disappeared during release.",
      );
    }
    events.push(
      await hostedReleasedEvent(tx, {
        globalRetainedByteCap,
        recordingId: input.recordingId,
        userId: input.userId,
        reason: input.reason,
        releasedBytes: current.quotaBytes,
      }),
    );
    return { ok: true, allowance, alreadyReleased: false };
  });
}

/** Serialize a hosted recording insert with orphan-reservation cleanup. */
export async function withReservedHostedClipAllowance<T>(input: {
  recordingId: string;
  userId: string;
  createRecording: (tx: HostedClipAllowanceTransaction) => Promise<T>;
}): Promise<T> {
  return withAllowanceLock(async (tx) => {
    const current = await findOwnedAllowance(
      tx,
      input.recordingId,
      input.userId,
    );
    if (current.status !== "reserved") {
      throw new HostedClipAllowanceInvariantError(
        "invalid_transition",
        "A hosted recording can only be created while its allowance is reserved.",
      );
    }
    return input.createRecording(tx);
  });
}

/** Release an old reservation only when its recording row was never committed or was fully deleted. */
export async function releaseOrphanedHostedClipAllowance(input: {
  recordingId: string;
  userId: string;
  createdBefore: Date;
  now?: Date;
}): Promise<boolean> {
  const createdBefore = input.createdBefore.toISOString();
  const updatedAt = (input.now ?? new Date()).toISOString();
  const { globalRetainedByteCap } = hostedStorageConfig();
  return withAllowanceLock(async (tx, events) => {
    const [current] = await tx
      .select()
      .from(allowanceTable)
      .where(eq(allowanceTable.recordingId, input.recordingId))
      .for("update", { of: allowanceTable })
      .limit(1);
    if (
      !current ||
      current.status !== "reserved" ||
      current.userId !== input.userId ||
      current.createdAt >= createdBefore
    ) {
      return false;
    }

    // guard:allow-unscoped — system reaper checks for any row tied to this reservation before release.
    const [recording] = await tx
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, input.recordingId))
      .limit(1);
    if (recording) return false;

    const cleanup = await tx
      .select({ id: schema.recordingMediaCleanups.id })
      .from(schema.recordingMediaCleanups)
      .where(
        and(
          eq(schema.recordingMediaCleanups.id, input.recordingId),
          eq(schema.recordingMediaCleanups.accountingSettled, false),
        ),
      )
      .limit(1);
    if (cleanup.length) return false;

    const released = await tx
      .update(allowanceTable)
      .set({
        status: "released",
        quotaBytes: 0,
        releasedAt: updatedAt,
        updatedAt,
      })
      .where(
        and(
          eq(allowanceTable.recordingId, input.recordingId),
          eq(allowanceTable.status, "reserved"),
          lt(allowanceTable.createdAt, createdBefore),
        ),
      )
      .returning({ recordingId: allowanceTable.recordingId });
    if (!released.length) return false;
    events.push(
      await hostedReleasedEvent(tx, {
        globalRetainedByteCap,
        recordingId: input.recordingId,
        userId: input.userId,
        reason: "orphan_reaped",
        releasedBytes: current.quotaBytes,
      }),
    );
    return true;
  });
}

/** Release only the exact failed attempt whose cleanup marker was confirmed. */
export async function releaseHostedClipAllowanceAfterCleanup(input: {
  recordingId: string;
  ownerEmail: string;
  expectedUpdatedAt: string;
  cleanupMarkerValue: string;
  sessionKey?: string | null;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();
  const ownerEmail = input.ownerEmail.trim();
  if (!ownerEmail) return false;

  const { globalRetainedByteCap } = hostedStorageConfig();
  return withAllowanceLock(async (tx, events) => {
    const [row] = await tx
      .select({
        status: schema.recordings.status,
        storageMode: schema.recordings.storageMode,
        failureCode: schema.recordings.failureCode,
        allowanceStatus: allowanceTable.status,
        allowanceUpdatedAt: allowanceTable.updatedAt,
        allowanceUserId: allowanceTable.userId,
        allowanceQuotaBytes: allowanceTable.quotaBytes,
      })
      .from(schema.recordings)
      .innerJoin(
        allowanceTable,
        eq(allowanceTable.recordingId, schema.recordings.id),
      )
      .where(
        and(
          eq(schema.recordings.id, input.recordingId),
          ilike(schema.recordings.ownerEmail, escapeLikeWildcards(ownerEmail)),
        ),
      )
      .for("update", { of: [schema.recordings, allowanceTable] })
      .limit(1);
    if (
      row?.status !== "failed" ||
      row.storageMode !== "hosted" ||
      row.failureCode === "taken_down" ||
      row.allowanceStatus !== "reserved" ||
      row.allowanceUpdatedAt !== input.expectedUpdatedAt
    ) {
      return false;
    }

    const [marker] = await tx
      .select({ value: applicationState.value })
      .from(applicationState)
      .where(
        and(
          eq(applicationState.sessionId, ownerEmail.toLowerCase()),
          eq(
            applicationState.key,
            hostedCleanupConfirmedKey(input.recordingId),
          ),
        ),
      )
      .for("update")
      .limit(1);
    if (marker?.value !== input.cleanupMarkerValue) return false;

    const [allowance] = await tx
      .update(allowanceTable)
      .set({
        status: "released",
        quotaBytes: 0,
        releasedAt: updatedAt,
        updatedAt,
      })
      .where(
        and(
          eq(allowanceTable.recordingId, input.recordingId),
          eq(allowanceTable.status, "reserved"),
          eq(allowanceTable.updatedAt, input.expectedUpdatedAt),
        ),
      )
      .returning({ recordingId: allowanceTable.recordingId });
    if (!allowance) return false;
    events.push(
      await hostedReleasedEvent(tx, {
        globalRetainedByteCap,
        recordingId: input.recordingId,
        userId: row.allowanceUserId,
        reason: "failed_cleanup",
        releasedBytes: row.allowanceQuotaBytes,
      }),
    );

    await tx
      .delete(applicationState)
      .where(
        and(
          eq(applicationState.sessionId, ownerEmail.toLowerCase()),
          eq(
            applicationState.key,
            hostedCleanupConfirmedKey(input.recordingId),
          ),
          eq(applicationState.value, input.cleanupMarkerValue),
        ),
      );
    if (input.sessionKey) {
      await tx
        .delete(applicationState)
        .where(
          and(
            sql`LOWER(${applicationState.sessionId}) = ${ownerEmail.toLowerCase()}`,
            eq(applicationState.key, input.sessionKey),
          ),
        );
    }
    return true;
  });
}

export async function getHostedClipAllowanceStatus(input: {
  recordingId: string;
  userId: string;
}): Promise<HostedClipAllowance | null> {
  const [allowance] = await getDb()
    .select()
    .from(allowanceTable)
    .where(
      and(
        eq(allowanceTable.recordingId, input.recordingId),
        eq(allowanceTable.userId, input.userId),
      ),
    )
    .limit(1);
  return allowance ?? null;
}

export async function getHostedClipAllowanceSnapshot(input: {
  email: string | null | undefined;
  emailVerified: boolean;
  userId: string | null | undefined;
  ipPrefix: string | null;
  policy: HostedClipAllowancePolicy;
  now?: Date;
}): Promise<HostedClipAllowanceSnapshot> {
  const identityKey = canonicalHostedClipIdentityKey(input.email);
  const userId = input.userId?.trim() || null;
  const empty: HostedClipAllowanceSnapshot = {
    identityKey,
    userId,
    consumedCount: 0,
    reservedCount: 0,
    remainingCount: 0,
    retainedBytes: 0,
    reservedBytes: 0,
    status: "denied",
    denialReason: "sign_in_required",
  };
  if (!identityKey || !userId) return empty;
  assertPolicy(input.policy);

  return withAllowanceLock(async (tx) => {
    const [stats] = await tx
      .select({
        consumedCount:
          sql<number>`count(*) FILTER (WHERE ${allowanceTable.status} = 'consumed')::integer`.mapWith(
            Number,
          ),
        reservedCount:
          sql<number>`count(*) FILTER (WHERE ${allowanceTable.status} = 'reserved')::integer`.mapWith(
            Number,
          ),
        retainedBytes:
          sql<number>`COALESCE(SUM(${allowanceTable.quotaBytes}) FILTER (WHERE ${allowanceTable.status} = 'consumed'), 0)::float8`.mapWith(
            Number,
          ),
        reservedBytes:
          sql<number>`COALESCE(SUM(${allowanceTable.quotaBytes}) FILTER (WHERE ${allowanceTable.status} = 'reserved'), 0)::float8`.mapWith(
            Number,
          ),
      })
      .from(allowanceTable)
      .where(identityOwnerWhere(identityKey, userId));

    const consumedCount = assertAggregate(
      stats?.consumedCount,
      "consumed count",
    );
    const reservedCount = assertAggregate(
      stats?.reservedCount,
      "reserved count",
    );
    const retainedBytes = assertAggregate(
      stats?.retainedBytes,
      "retained bytes",
    );
    const reservedBytes = assertAggregate(
      stats?.reservedBytes,
      "reserved bytes",
    );
    const remainingCount = Math.max(
      0,
      input.policy.perIdentityClipLimit - consumedCount - reservedCount,
    );

    let denialReason: HostedClipAllowanceDenialReason | null = null;
    if (!input.emailVerified) denialReason = "unverified";
    else if (
      disposableDomainMatches(identityKey, input.policy.disposableDomains)
    )
      denialReason = "disposable";
    else if (!input.policy.enabled) denialReason = "disabled";
    else
      denialReason = await reservationDenialReason({
        tx,
        identityKey,
        userId,
        ipPrefix: input.ipPrefix || null,
        policy: input.policy,
        now: input.now ?? new Date(),
      });

    return {
      identityKey,
      userId,
      consumedCount,
      reservedCount,
      remainingCount,
      retainedBytes,
      reservedBytes,
      status: denialReason ? "denied" : "available",
      denialReason,
    };
  });
}
