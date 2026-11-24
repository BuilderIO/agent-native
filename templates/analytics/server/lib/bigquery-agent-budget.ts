import { randomUUID } from "node:crypto";

import { getDbExec, type DbExec } from "@agent-native/core/db";
import { getOrgSetting } from "@agent-native/core/settings";

import { billedBytesForUsd, usdForBilledBytes } from "./bigquery-pricing.js";
import type { BigQueryJobBilling } from "./bigquery-usage.js";

export const OUTSIDE_AGENT_JOB_CAP_BYTES = 50_000_000_000;
export const OUTSIDE_AGENT_PERSON_BASE_BYTES = 175_921_860_444;
export const OUTSIDE_AGENT_PERSON_CEILING_BYTES = 879_609_302_220;
export const OUTSIDE_AGENT_ORG_LIMIT_BYTES = 8_796_093_022_208;
export const BIGQUERY_MAX_JOB_RUNTIME_MS = 6 * 60 * 60_000;

const RECONCILE_BATCH = 5;
const RECONCILE_TIMEOUT_MS = 2_500;
const RETENTION_MS = 90 * 24 * 60 * 60_000;
const APPROVAL_RETENTION_MS = 14 * 24 * 60 * 60_000;

export const BIGQUERY_AGENT_BUDGET_SETTING_KEY =
  "bigquery-outside-agent-budget";

export const BIGQUERY_AGENT_BUDGET_MIGRATION_SQL = [
  `CREATE TABLE IF NOT EXISTS analytics_bigquery_agent_jobs (
    request_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    location TEXT,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    org_key TEXT NOT NULL,
    credential_scope TEXT NOT NULL,
    source TEXT NOT NULL,
    utc_day TEXT NOT NULL,
    estimated_bytes BIGINT,
    reserved_bytes BIGINT NOT NULL,
    billed_bytes BIGINT,
    provider_cache_hit BOOLEAN,
    state TEXT NOT NULL,
    submission_state TEXT NOT NULL,
    resolution TEXT,
    created_at TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    reconciled_at TEXT,
    resolved_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS analytics_bigquery_agent_jobs_job_idx
    ON analytics_bigquery_agent_jobs (project_id, job_id)`,
  `CREATE INDEX IF NOT EXISTS analytics_bigquery_agent_jobs_owner_idx
    ON analytics_bigquery_agent_jobs (owner_email, state, utc_day)`,
  `CREATE INDEX IF NOT EXISTS analytics_bigquery_agent_jobs_org_idx
    ON analytics_bigquery_agent_jobs (org_key, state, utc_day)`,
  `CREATE INDEX IF NOT EXISTS analytics_bigquery_agent_jobs_resolved_idx
    ON analytics_bigquery_agent_jobs (resolved_at)`,
  `CREATE TABLE IF NOT EXISTS analytics_bigquery_agent_budget_locks (
    scope_key TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_bigquery_agent_allowance_approvals (
    owner_email TEXT NOT NULL,
    utc_day TEXT NOT NULL,
    org_key TEXT NOT NULL,
    allowance_bytes BIGINT NOT NULL,
    approved_via TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY (owner_email, utc_day)
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_bigquery_agent_executions (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    caller TEXT NOT NULL,
    source TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    project_id TEXT,
    job_id TEXT,
    status TEXT NOT NULL,
    code TEXT,
    estimated_bytes BIGINT,
    reserved_bytes BIGINT,
    billed_bytes BIGINT,
    provider_cache_hit BOOLEAN,
    row_count INTEGER,
    truncated BOOLEAN NOT NULL,
    cancelled BOOLEAN NOT NULL,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS analytics_bigquery_agent_executions_started_idx
    ON analytics_bigquery_agent_executions (started_at)`,
];

export const BIGQUERY_AGENT_CREDENTIAL_FINGERPRINT_MIGRATION_SQL = [
  `ALTER TABLE analytics_bigquery_agent_jobs ADD COLUMN IF NOT EXISTS credential_fingerprint TEXT`,
];

export const BIGQUERY_AGENT_EXECUTION_JOB_IDENTITY_MIGRATION_SQL = [
  `ALTER TABLE analytics_bigquery_agent_executions ADD COLUMN IF NOT EXISTS location TEXT`,
  `ALTER TABLE analytics_bigquery_agent_executions ADD COLUMN IF NOT EXISTS bytes_processed BIGINT`,
];

export const BIGQUERY_AGENT_EXECUTION_CANCEL_MIGRATION_SQL = [
  `ALTER TABLE analytics_bigquery_agent_executions ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN`,
];

export interface OutsideAgentIdentity {
  ownerEmail: string;
  orgId: string | null;
}

export function outsideAgentIdentity(
  userEmail: string | undefined | null,
  orgId: string | undefined | null,
): OutsideAgentIdentity {
  const ownerEmail = userEmail?.trim().toLowerCase();
  if (!ownerEmail) throw new BigQueryAgentBudgetUnavailableError("no_identity");
  return { ownerEmail, orgId: orgId?.trim() || null };
}

function orgKey(identity: OutsideAgentIdentity): string {
  return identity.orgId
    ? `org:${identity.orgId}`
    : `personal:${identity.ownerEmail}`;
}

function personKey(identity: OutsideAgentIdentity): string {
  return `person:${identity.ownerEmail}`;
}

export class BigQueryAgentBudgetUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`BigQuery outside-agent budget unavailable: ${reason}`);
    this.name = "BigQueryAgentBudgetUnavailableError";
    this.reason = reason;
  }
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}

export interface OutsideAgentLimits {
  jobCapBytes: number;
  personBaseBytes: number;
  personCeilingBytes: number;
  orgLimitBytes: number;
  source: { person: "default" | "admin"; org: "default" | "admin" };
}

export interface BigQueryAgentBudgetOverrides {
  orgDailyLimitBytes?: number;
  personDailyAllowanceBytes?: Record<string, number>;
  updatedAt?: string;
  updatedBy?: string;
}

export const ADMIN_MAX_PERSON_DAILY_BYTES = billedBytesForUsd(500);
export const ADMIN_MAX_ORG_DAILY_BYTES = billedBytesForUsd(5_000);

function validLimit(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

export function parseBigQueryAgentBudgetOverrides(
  value: unknown,
): BigQueryAgentBudgetOverrides {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BigQueryAgentBudgetUnavailableError("overrides_unreadable");
  }
  const record = value as Record<string, unknown>;
  const result: BigQueryAgentBudgetOverrides = {};
  if (record.orgDailyLimitBytes !== undefined) {
    if (!validLimit(record.orgDailyLimitBytes, ADMIN_MAX_ORG_DAILY_BYTES)) {
      throw new BigQueryAgentBudgetUnavailableError("overrides_unreadable");
    }
    result.orgDailyLimitBytes = record.orgDailyLimitBytes;
  }
  if (record.personDailyAllowanceBytes !== undefined) {
    const people = record.personDailyAllowanceBytes;
    if (!people || typeof people !== "object" || Array.isArray(people)) {
      throw new BigQueryAgentBudgetUnavailableError("overrides_unreadable");
    }
    const parsed: Record<string, number> = {};
    for (const [email, bytes] of Object.entries(people)) {
      if (!validLimit(bytes, ADMIN_MAX_PERSON_DAILY_BYTES)) {
        throw new BigQueryAgentBudgetUnavailableError("overrides_unreadable");
      }
      parsed[email.trim().toLowerCase()] = bytes;
    }
    result.personDailyAllowanceBytes = parsed;
  }
  if (typeof record.updatedAt === "string") result.updatedAt = record.updatedAt;
  if (typeof record.updatedBy === "string") result.updatedBy = record.updatedBy;
  return result;
}

export async function readBigQueryAgentBudgetOverrides(
  orgId: string | null,
): Promise<BigQueryAgentBudgetOverrides> {
  if (!orgId) return {};
  let stored: unknown;
  try {
    stored = await getOrgSetting(orgId, BIGQUERY_AGENT_BUDGET_SETTING_KEY);
  } catch {
    throw new BigQueryAgentBudgetUnavailableError("overrides_unreadable");
  }
  return parseBigQueryAgentBudgetOverrides(stored);
}

export function outsideAgentLimits(
  identity: OutsideAgentIdentity,
  overrides: BigQueryAgentBudgetOverrides,
): OutsideAgentLimits {
  const personOverride =
    overrides.personDailyAllowanceBytes?.[identity.ownerEmail];
  const personBaseBytes = personOverride ?? OUTSIDE_AGENT_PERSON_BASE_BYTES;
  return {
    jobCapBytes: OUTSIDE_AGENT_JOB_CAP_BYTES,
    personBaseBytes,
    personCeilingBytes: Math.max(
      OUTSIDE_AGENT_PERSON_CEILING_BYTES,
      personBaseBytes,
    ),
    orgLimitBytes:
      overrides.orgDailyLimitBytes ?? OUTSIDE_AGENT_ORG_LIMIT_BYTES,
    source: {
      person: personOverride === undefined ? "default" : "admin",
      org: overrides.orgDailyLimitBytes === undefined ? "default" : "admin",
    },
  };
}

function readBytes(value: unknown, field: string): number {
  const text =
    typeof value === "number" || typeof value === "bigint"
      ? String(value)
      : value;
  if (typeof text !== "string" || !/^\d+$/.test(text)) {
    throw new BigQueryAgentBudgetUnavailableError(`unreadable_${field}`);
  }
  const bytes = Number(text);
  if (!Number.isSafeInteger(bytes)) {
    throw new BigQueryAgentBudgetUnavailableError(`unreadable_${field}`);
  }
  return bytes;
}

interface Usage {
  settledBytes: number;
  reservedBytes: number;
}

async function readUsage(
  exec: DbExec,
  identity: OutsideAgentIdentity,
  day: string,
): Promise<{ person: Usage; org: Usage }> {
  const { rows } = await exec.execute({
    sql: `SELECT
        COALESCE(SUM(CASE WHEN owner_email = $1 AND state = 'settled' AND utc_day = $3 THEN billed_bytes ELSE 0 END), 0)::text AS person_settled,
        COALESCE(SUM(CASE WHEN owner_email = $1 AND state = 'pending' THEN reserved_bytes ELSE 0 END), 0)::text AS person_reserved,
        COALESCE(SUM(CASE WHEN org_key = $2 AND state = 'settled' AND utc_day = $3 THEN billed_bytes ELSE 0 END), 0)::text AS org_settled,
        COALESCE(SUM(CASE WHEN org_key = $2 AND state = 'pending' THEN reserved_bytes ELSE 0 END), 0)::text AS org_reserved
      FROM analytics_bigquery_agent_jobs
      WHERE (owner_email = $1 OR org_key = $2) AND (state = 'pending' OR utc_day = $3)`,
    args: [identity.ownerEmail, orgKey(identity), day],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  return {
    person: {
      settledBytes: readBytes(row?.person_settled, "settled"),
      reservedBytes: readBytes(row?.person_reserved, "reserved"),
    },
    org: {
      settledBytes: readBytes(row?.org_settled, "settled"),
      reservedBytes: readBytes(row?.org_reserved, "reserved"),
    },
  };
}

async function readApproval(
  exec: DbExec,
  identity: OutsideAgentIdentity,
  now: Date,
): Promise<boolean> {
  const { rows } = await exec.execute({
    sql: `SELECT expires_at FROM analytics_bigquery_agent_allowance_approvals
      WHERE owner_email = $1 AND utc_day = $2 AND expires_at > $3`,
    args: [identity.ownerEmail, utcDay(now), now.toISOString()],
  });
  return rows.length > 0;
}

export interface BigQueryAgentBudgetScope {
  limitBytes: number;
  settledBytes: number;
  reservedBytes: number;
  remainingBytes: number;
}

export interface BigQueryAgentBudgetSnapshot {
  utcDay: string;
  resetsAt: string;
  jobCapBytes: number;
  person: BigQueryAgentBudgetScope & {
    baseAllowanceBytes: number;
    ceilingBytes: number;
    approvedToday: boolean;
  };
  org: BigQueryAgentBudgetScope;
  limitsSource: OutsideAgentLimits["source"];
}

function scope(limitBytes: number, usage: Usage): BigQueryAgentBudgetScope {
  return {
    limitBytes,
    settledBytes: usage.settledBytes,
    reservedBytes: usage.reservedBytes,
    remainingBytes: Math.max(
      0,
      limitBytes - usage.settledBytes - usage.reservedBytes,
    ),
  };
}

async function snapshotWith(
  exec: DbExec,
  identity: OutsideAgentIdentity,
  limits: OutsideAgentLimits,
  now: Date,
): Promise<BigQueryAgentBudgetSnapshot> {
  const day = utcDay(now);
  const { person, org } = await readUsage(exec, identity, day);
  const approvedToday = await readApproval(exec, identity, now);
  const allowance = approvedToday
    ? limits.personCeilingBytes
    : limits.personBaseBytes;
  return {
    utcDay: day,
    resetsAt: nextUtcMidnight(now).toISOString(),
    jobCapBytes: limits.jobCapBytes,
    person: {
      ...scope(allowance, person),
      baseAllowanceBytes: limits.personBaseBytes,
      ceilingBytes: limits.personCeilingBytes,
      approvedToday,
    },
    org: scope(limits.orgLimitBytes, org),
    limitsSource: limits.source,
  };
}

export async function readBigQueryAgentBudget(
  identity: OutsideAgentIdentity,
  options: {
    now?: Date;
    reconcile?: BigQueryAgentReconciler;
  } = {},
): Promise<BigQueryAgentBudgetSnapshot> {
  const now = options.now ?? new Date();
  if (options.reconcile)
    await reconcileStaleBigQueryAgentJobs(identity, options.reconcile, now);
  const limits = outsideAgentLimits(
    identity,
    await readBigQueryAgentBudgetOverrides(identity.orgId),
  );
  return guardBudget(() => snapshotWith(getDbExec(), identity, limits, now));
}

async function guardBudget<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BigQueryAgentBudgetUnavailableError) throw error;
    throw new BigQueryAgentBudgetUnavailableError("ledger_unavailable");
  }
}

export interface BigQueryAgentAdmissionRequest {
  source: string;
  projectId: string;
  jobId: string;
  credentialScope: string;
  credentialFingerprint: string | null;
  estimatedBytes: number | null;
  reservedBytes: number;
  leaseMs: number;
  location?: string | null;
}

export type BigQueryAgentRefusalCode =
  | "over_job_cap"
  | "approval_required"
  | "budget_exhausted";

export type BigQueryAgentAdmission =
  | {
      status: "admitted";
      requestId: string;
      reservedBytes: number;
      created: boolean;
      leaseExpiresAt: string;
      utcDay: string;
      budget: BigQueryAgentBudgetSnapshot;
    }
  | {
      status: "refused";
      code: BigQueryAgentRefusalCode;
      scope: "job" | "person" | "org";
      reservedBytes: number;
      budget: BigQueryAgentBudgetSnapshot;
    };

export async function admitBigQueryAgentJob(
  identity: OutsideAgentIdentity,
  request: BigQueryAgentAdmissionRequest,
  options: {
    now?: Date;
    clock?: () => Date;
    reconcile?: BigQueryAgentReconciler;
  } = {},
): Promise<BigQueryAgentAdmission> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? (() => options.now ?? new Date());
  if (
    !Number.isSafeInteger(request.reservedBytes) ||
    request.reservedBytes < 1 ||
    (request.estimatedBytes !== null &&
      (!Number.isSafeInteger(request.estimatedBytes) ||
        request.estimatedBytes < 0 ||
        request.estimatedBytes > request.reservedBytes))
  ) {
    throw new BigQueryAgentBudgetUnavailableError("invalid_reservation");
  }
  if (options.reconcile)
    await reconcileStaleBigQueryAgentJobs(identity, options.reconcile, now);
  const limits = outsideAgentLimits(
    identity,
    await readBigQueryAgentBudgetOverrides(identity.orgId),
  );
  const db = getDbExec();
  if (!db.transaction) {
    throw new BigQueryAgentBudgetUnavailableError("no_transactions");
  }
  const transaction = db.transaction.bind(db);
  return guardBudget(() =>
    transaction(async (tx) => {
      const keys = [orgKey(identity), personKey(identity)].sort();
      await tx.execute({
        sql: `INSERT INTO analytics_bigquery_agent_budget_locks (scope_key, created_at)
          VALUES ($1, $3), ($2, $3) ON CONFLICT (scope_key) DO NOTHING`,
        args: [keys[0], keys[1], now.toISOString()],
      });
      await tx.execute({
        sql: `SELECT scope_key FROM analytics_bigquery_agent_budget_locks
          WHERE scope_key IN ($1, $2) ORDER BY scope_key FOR UPDATE`,
        args: [keys[0], keys[1]],
      });
      const admittedAt = clock();
      const leaseExpiresAt = new Date(
        admittedAt.getTime() + request.leaseMs,
      ).toISOString();
      const existing = await tx.execute({
        sql: `SELECT request_id, state, resolution, owner_email, reserved_bytes::text AS reserved, utc_day
          FROM analytics_bigquery_agent_jobs WHERE project_id = $1 AND job_id = $2 FOR UPDATE`,
        args: [request.projectId, request.jobId],
      });
      const prior = existing.rows[0] as
        | {
            request_id: string;
            state: string;
            resolution: string | null;
            owner_email: string;
            reserved: unknown;
            utc_day: string;
          }
        | undefined;
      if (
        prior?.state === "settled" &&
        prior.resolution !== "billed" &&
        prior.resolution !== "cache_hit"
      ) {
        throw new BigQueryAgentBudgetUnavailableError("job_id_unconfirmed");
      }
      if (prior && prior.state !== "released") {
        if (prior.owner_email !== identity.ownerEmail) {
          throw new BigQueryAgentBudgetUnavailableError("job_id_owned");
        }
        let lease = leaseExpiresAt;
        if (prior.state === "pending") {
          const extended = await tx.execute({
            sql: `UPDATE analytics_bigquery_agent_jobs
              SET lease_expires_at = GREATEST(lease_expires_at, $2),
                credential_fingerprint = CASE
                  WHEN credential_fingerprint = $3 AND credential_scope = $4 THEN credential_fingerprint
                  ELSE NULL END
              WHERE request_id = $1 AND state = 'pending'
              RETURNING lease_expires_at`,
            args: [
              prior.request_id,
              leaseExpiresAt,
              request.credentialFingerprint,
              request.credentialScope,
            ],
          });
          const persisted = (
            extended.rows[0] as { lease_expires_at?: unknown } | undefined
          )?.lease_expires_at;
          if (typeof persisted !== "string") {
            throw new BigQueryAgentBudgetUnavailableError("lease_unreadable");
          }
          lease = persisted;
        }
        return {
          status: "admitted" as const,
          requestId: prior.request_id,
          reservedBytes: readBytes(prior.reserved, "reserved"),
          created: false,
          leaseExpiresAt: lease,
          utcDay: prior.utc_day,
          budget: await snapshotWith(tx, identity, limits, admittedAt),
        };
      }
      const budget = await snapshotWith(tx, identity, limits, admittedAt);
      const refusal = refusalFor(budget, limits, request.reservedBytes);
      if (refusal) {
        return {
          status: "refused" as const,
          ...refusal,
          reservedBytes: request.reservedBytes,
          budget,
        };
      }
      const requestId = randomUUID();
      if (prior) {
        await tx.execute({
          sql: "DELETE FROM analytics_bigquery_agent_jobs WHERE request_id = $1 AND state = 'released'",
          args: [prior.request_id],
        });
      }
      await tx.execute({
        sql: `INSERT INTO analytics_bigquery_agent_jobs (
            request_id, project_id, job_id, owner_email, org_id, org_key, credential_scope,
            credential_fingerprint, source, utc_day, estimated_bytes, reserved_bytes, state,
            submission_state, created_at, lease_expires_at, location
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending','admitted',$13,$14,$15)`,
        args: [
          requestId,
          request.projectId,
          request.jobId,
          identity.ownerEmail,
          identity.orgId,
          orgKey(identity),
          request.credentialScope,
          request.credentialFingerprint,
          request.source,
          budget.utcDay,
          request.estimatedBytes,
          request.reservedBytes,
          admittedAt.toISOString(),
          leaseExpiresAt,
          request.location ?? null,
        ],
      });
      return {
        status: "admitted" as const,
        requestId,
        reservedBytes: request.reservedBytes,
        created: true,
        leaseExpiresAt,
        utcDay: budget.utcDay,
        budget: {
          ...budget,
          person: reserve(budget.person, request.reservedBytes),
          org: reserve(budget.org, request.reservedBytes),
        },
      };
    }),
  );
}

function reserve<T extends BigQueryAgentBudgetScope>(
  scope: T,
  bytes: number,
): T {
  return {
    ...scope,
    reservedBytes: scope.reservedBytes + bytes,
    remainingBytes: Math.max(0, scope.remainingBytes - bytes),
  };
}

function refusalFor(
  budget: BigQueryAgentBudgetSnapshot,
  limits: OutsideAgentLimits,
  reservedBytes: number,
): { code: BigQueryAgentRefusalCode; scope: "job" | "person" | "org" } | null {
  if (reservedBytes > limits.jobCapBytes) {
    return { code: "over_job_cap", scope: "job" };
  }
  return budgetRefusalFor(budget, reservedBytes);
}

export function budgetRefusalFor(
  budget: BigQueryAgentBudgetSnapshot,
  reservedBytes: number,
): { code: BigQueryAgentRefusalCode; scope: "person" | "org" } | null {
  const orgUsed = budget.org.settledBytes + budget.org.reservedBytes;
  if (orgUsed + reservedBytes > budget.org.limitBytes) {
    return { code: "budget_exhausted", scope: "org" };
  }
  const personUsed = budget.person.settledBytes + budget.person.reservedBytes;
  if (personUsed + reservedBytes <= budget.person.limitBytes) return null;
  if (
    !budget.person.approvedToday &&
    personUsed + reservedBytes <= budget.person.ceilingBytes
  ) {
    return { code: "approval_required", scope: "person" };
  }
  return { code: "budget_exhausted", scope: "person" };
}

export async function approveBigQueryAgentDailyAllowance(
  identity: OutsideAgentIdentity,
  approvedVia: string,
  now: Date = new Date(),
): Promise<BigQueryAgentBudgetSnapshot> {
  const limits = outsideAgentLimits(
    identity,
    await readBigQueryAgentBudgetOverrides(identity.orgId),
  );
  return guardBudget(async () => {
    const db = getDbExec();
    await db.execute({
      sql: `INSERT INTO analytics_bigquery_agent_allowance_approvals (
          owner_email, utc_day, org_key, allowance_bytes, approved_via, approved_at, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (owner_email, utc_day) DO NOTHING`,
      args: [
        identity.ownerEmail,
        utcDay(now),
        orgKey(identity),
        limits.personCeilingBytes,
        approvedVia,
        now.toISOString(),
        nextUtcMidnight(now).toISOString(),
      ],
    });
    return snapshotWith(db, identity, limits, now);
  });
}

export async function markBigQueryAgentJobSubmission(
  requestId: string,
  submissionState: "accepted" | "unknown",
  location: string | undefined,
): Promise<void> {
  await guardBudget(() =>
    getDbExec().execute({
      sql: `UPDATE analytics_bigquery_agent_jobs
        SET submission_state = $2, location = COALESCE($3, location)
        WHERE request_id = $1 AND state = 'pending'`,
      args: [requestId, submissionState, location ?? null],
    }),
  );
}

export type BigQueryAgentSettlement =
  | { kind: "billed"; billedBytes: number; cacheHit: boolean | null }
  | { kind: "rejected" }
  | { kind: "not_found" }
  | { kind: "charged_reservation"; reason: string };

export function settlementForFinishedJob(
  observation: Extract<BigQueryJobBilling, { kind: "found" }>,
): BigQueryAgentSettlement | null {
  if (observation.state !== "DONE") return null;
  if (observation.billedBytes !== null) {
    return {
      kind: "billed",
      billedBytes: observation.cacheHit === true ? 0 : observation.billedBytes,
      cacheHit: observation.cacheHit,
    };
  }
  if (observation.cacheHit === true) {
    return { kind: "billed", billedBytes: 0, cacheHit: true };
  }
  if (
    observation.errorReason !== null &&
    observation.errorReason !== "stopped" &&
    observation.errorReason !== "unreadable" &&
    observation.statementType !== null &&
    observation.statementType !== "SCRIPT"
  ) {
    return { kind: "billed", billedBytes: 0, cacheHit: observation.cacheHit };
  }
  return null;
}

export async function settleBigQueryAgentJob(
  projectId: string,
  jobId: string,
  settlement: BigQueryAgentSettlement,
  now: Date = new Date(),
  options: {
    leaseExpiredAt?: Date;
    finalizeExecution?: boolean;
  } = {},
): Promise<boolean> {
  return guardBudget(async () => {
    const at = now.toISOString();
    const leaseGuard = options.leaseExpiredAt?.toISOString() ?? null;
    const db = getDbExec();
    if (!options.finalizeExecution) {
      return settleWith(db, projectId, jobId, settlement, at, leaseGuard);
    }
    if (!db.transaction) {
      throw new BigQueryAgentBudgetUnavailableError("no_transactions");
    }
    return db.transaction.bind(db)(async (tx) => {
      const settled = await settleWith(
        tx,
        projectId,
        jobId,
        settlement,
        at,
        leaseGuard,
      );
      if (settled) {
        await tx.execute({
          sql: `UPDATE analytics_bigquery_agent_executions AS e
            SET status = CASE WHEN e.status = 'submitting' THEN 'abandoned' ELSE e.status END,
              code = CASE WHEN e.status = 'submitting' THEN j.resolution ELSE e.code END,
              billed_bytes = j.billed_bytes, provider_cache_hit = j.provider_cache_hit
            FROM analytics_bigquery_agent_jobs AS j
            WHERE j.project_id = $1 AND j.job_id = $2
              AND e.project_id = j.project_id AND e.job_id = j.job_id
              AND e.status IN ('submitting', 'uncertain')`,
          args: [projectId, jobId],
        });
      }
      return settled;
    });
  });
}

async function settleWith(
  exec: DbExec,
  projectId: string,
  jobId: string,
  settlement: BigQueryAgentSettlement,
  at: string,
  leaseGuard: string | null,
): Promise<boolean> {
  const result =
    settlement.kind === "billed"
      ? await exec.execute({
          sql: `UPDATE analytics_bigquery_agent_jobs
            SET state = 'settled', billed_bytes = $3, provider_cache_hit = $4,
              resolution = $5, resolved_at = $6, submission_state = 'accepted'
            WHERE project_id = $1 AND job_id = $2 AND state = 'pending'
            RETURNING request_id`,
          args: [
            projectId,
            jobId,
            settlement.billedBytes,
            settlement.cacheHit,
            settlement.cacheHit === true ? "cache_hit" : "billed",
            at,
          ],
        })
      : settlement.kind === "charged_reservation"
        ? await exec.execute({
            sql: `UPDATE analytics_bigquery_agent_jobs
              SET state = 'settled', billed_bytes = reserved_bytes, resolution = $3, resolved_at = $4
              WHERE project_id = $1 AND job_id = $2 AND state = 'pending'
                AND ($5::text IS NULL OR lease_expires_at < $5::text)
              RETURNING request_id`,
            args: [projectId, jobId, settlement.reason, at, leaseGuard],
          })
        : await exec.execute({
            sql: `UPDATE analytics_bigquery_agent_jobs
              SET state = 'released', resolution = $3, resolved_at = $4,
                submission_state = CASE WHEN $3 = 'rejected' THEN 'rejected' ELSE submission_state END
              WHERE project_id = $1 AND job_id = $2 AND state = 'pending'
                AND ($5::text IS NULL OR lease_expires_at < $5::text)
              RETURNING request_id`,
            args: [projectId, jobId, settlement.kind, at, leaseGuard],
          });
  return result.rows.length > 0;
}

export interface BigQueryAgentPendingJob {
  requestId: string;
  projectId: string;
  jobId: string;
  location: string | null;
  credentialScope: string;
  credentialFingerprint: string | null;
  createdAt: string;
  submissionState: string;
}

export type BigQueryAgentJobObservation =
  | BigQueryJobBilling
  | { kind: "absent" };

export interface BigQueryAgentReconciler {
  credentialScope: string;
  credentialFingerprint: string | null;
  observe(
    job: BigQueryAgentPendingJob,
    signal: AbortSignal,
    options: { mayConfirmAbsence: boolean },
  ): Promise<BigQueryAgentJobObservation>;
}

export async function reconcileStaleBigQueryAgentJobs(
  identity: OutsideAgentIdentity,
  reconciler: BigQueryAgentReconciler,
  now: Date = new Date(),
): Promise<number> {
  const stale = await guardBudget(() =>
    getDbExec().execute({
      sql: `SELECT request_id, project_id, job_id, location, credential_scope, credential_fingerprint,
          created_at, submission_state
        FROM analytics_bigquery_agent_jobs
        WHERE state = 'pending' AND lease_expires_at < $3
          AND (owner_email = $1 OR org_key = $2)
          AND (reconciled_at IS NULL OR reconciled_at < $4)
        ORDER BY reconciled_at NULLS FIRST, created_at LIMIT $5`,
      args: [
        identity.ownerEmail,
        orgKey(identity),
        now.toISOString(),
        new Date(now.getTime() - 30_000).toISOString(),
        RECONCILE_BATCH,
      ],
    }),
  );
  let resolved = 0;
  const deadline = AbortSignal.timeout(RECONCILE_TIMEOUT_MS);
  for (const row of stale.rows as Array<Record<string, unknown>>) {
    if (deadline.aborted) break;
    const job: BigQueryAgentPendingJob = {
      requestId: String(row.request_id),
      projectId: String(row.project_id),
      jobId: String(row.job_id),
      location: typeof row.location === "string" ? row.location : null,
      credentialScope: String(row.credential_scope),
      credentialFingerprint:
        typeof row.credential_fingerprint === "string"
          ? row.credential_fingerprint
          : null,
      createdAt: String(row.created_at),
      submissionState: String(row.submission_state),
    };
    const settlement = await reconcileOne(job, reconciler, deadline, now);
    if (settlement) {
      if (
        await settleBigQueryAgentJob(
          job.projectId,
          job.jobId,
          settlement,
          now,
          {
            leaseExpiredAt: now,
            finalizeExecution: true,
          },
        )
      )
        resolved++;
    } else {
      await guardBudget(() =>
        getDbExec().execute({
          sql: "UPDATE analytics_bigquery_agent_jobs SET reconciled_at = $2 WHERE request_id = $1 AND state = 'pending'",
          args: [job.requestId, now.toISOString()],
        }),
      );
    }
  }
  return resolved;
}

function samePrincipal(
  job: BigQueryAgentPendingJob,
  reconciler: BigQueryAgentReconciler,
): boolean {
  return (
    job.credentialScope === reconciler.credentialScope &&
    job.credentialFingerprint !== null &&
    job.credentialFingerprint === reconciler.credentialFingerprint
  );
}

async function reconcileOne(
  job: BigQueryAgentPendingJob,
  reconciler: BigQueryAgentReconciler,
  signal: AbortSignal,
  now: Date,
): Promise<BigQueryAgentSettlement | null> {
  const pastMaxRuntime =
    now.getTime() - Date.parse(job.createdAt) > BIGQUERY_MAX_JOB_RUNTIME_MS;
  let observation: BigQueryAgentJobObservation;
  try {
    observation = await reconciler.observe(job, signal, {
      mayConfirmAbsence: samePrincipal(job, reconciler),
    });
  } catch {
    // coercion-ok: an unread job stays reserved; only its six-hour bound settles it.
    observation = { kind: "unreadable" };
  }
  if (observation.kind === "found") {
    if (observation.state === "DONE") {
      return (
        settlementForFinishedJob(observation) ?? {
          kind: "charged_reservation",
          reason: "billed_bytes_missing",
        }
      );
    }
    return pastMaxRuntime
      ? { kind: "charged_reservation", reason: "max_runtime_elapsed" }
      : null;
  }
  if (observation.kind === "absent" && samePrincipal(job, reconciler)) {
    return { kind: "not_found" };
  }
  return pastMaxRuntime
    ? { kind: "charged_reservation", reason: "max_runtime_elapsed" }
    : null;
}

export interface BigQueryAgentExecutionRecord {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  caller: string;
  source: string;
  policyVersion: string;
  queryHash: string;
  projectId: string | null;
  jobId: string | null;
  location: string | null;
  status: string;
  code: string | null;
  bytesProcessed: number | null;
  estimatedBytes: number | null;
  reservedBytes: number | null;
  billedBytes: number | null;
  providerCacheHit: boolean | null;
  rowCount: number | null;
  truncated: boolean;
  cancelRequested: boolean;
  cancelConfirmed: boolean;
  startedAt: string;
  durationMs: number;
}

export async function writeBigQueryAgentExecutionRecord(
  record: BigQueryAgentExecutionRecord,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  // raw-sql-ok: static INSERT with bound values; only the per-call timeout is computed.
  await getDbExec().execute({
    timeoutMs:
      options.timeoutMs === undefined
        ? undefined
        : Math.max(1, options.timeoutMs),
    maxAttempts: options.timeoutMs === undefined ? undefined : 1,
    sql: `INSERT INTO analytics_bigquery_agent_executions (
        id, owner_email, org_id, caller, source, policy_version, query_hash, project_id, job_id,
        status, code, estimated_bytes, reserved_bytes, billed_bytes, provider_cache_hit,
        row_count, truncated, cancelled, started_at, duration_ms, location, bytes_processed,
        cancel_requested
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id, job_id = EXCLUDED.job_id, status = EXCLUDED.status,
        code = EXCLUDED.code, estimated_bytes = EXCLUDED.estimated_bytes,
        reserved_bytes = EXCLUDED.reserved_bytes, billed_bytes = EXCLUDED.billed_bytes,
        provider_cache_hit = EXCLUDED.provider_cache_hit, row_count = EXCLUDED.row_count,
        truncated = EXCLUDED.truncated, cancelled = EXCLUDED.cancelled,
        duration_ms = EXCLUDED.duration_ms, location = EXCLUDED.location,
        bytes_processed = EXCLUDED.bytes_processed, cancel_requested = EXCLUDED.cancel_requested
      WHERE analytics_bigquery_agent_executions.status = 'submitting'
        AND EXCLUDED.status <> 'submitting'`,
    args: [
      record.id,
      record.ownerEmail,
      record.orgId,
      record.caller,
      record.source,
      record.policyVersion,
      record.queryHash,
      record.projectId,
      record.jobId,
      record.status,
      record.code,
      record.estimatedBytes,
      record.reservedBytes,
      record.billedBytes,
      record.providerCacheHit,
      record.rowCount,
      record.truncated,
      record.cancelConfirmed,
      record.startedAt,
      record.durationMs,
      record.location,
      record.bytesProcessed,
      record.cancelRequested,
    ],
  });
}

export async function pruneBigQueryAgentBudget(now: Date = new Date()) {
  const db = getDbExec();
  const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
  const finalized = await db.execute({
    timeoutMs: 1_500,
    maxAttempts: 1,
    sql: `UPDATE analytics_bigquery_agent_executions AS e
      SET status = 'abandoned', code = j.resolution, billed_bytes = j.billed_bytes,
        provider_cache_hit = j.provider_cache_hit
      FROM analytics_bigquery_agent_jobs AS j
      WHERE e.status = 'submitting'
        AND e.project_id = j.project_id AND e.job_id = j.job_id
        AND j.state <> 'pending' AND j.lease_expires_at < $1
      RETURNING e.id`,
    args: [now.toISOString()],
  });
  const jobs = await db.execute({
    timeoutMs: 1_500,
    maxAttempts: 1,
    sql: `DELETE FROM analytics_bigquery_agent_jobs
      WHERE state <> 'pending' AND resolved_at IS NOT NULL AND resolved_at < $1
      RETURNING request_id`,
    args: [cutoff],
  });
  const executions = await db.execute({
    timeoutMs: 1_500,
    maxAttempts: 1,
    sql: "DELETE FROM analytics_bigquery_agent_executions WHERE started_at < $1 RETURNING id",
    args: [cutoff],
  });
  const approvals = await db.execute({
    timeoutMs: 1_500,
    maxAttempts: 1,
    sql: "DELETE FROM analytics_bigquery_agent_allowance_approvals WHERE expires_at < $1 RETURNING owner_email",
    args: [new Date(now.getTime() - APPROVAL_RETENTION_MS).toISOString()],
  });
  return {
    cutoff,
    executionsFinalized: finalized.rows.length,
    admissionsDeleted: jobs.rows.length,
    executionsDeleted: executions.rows.length,
    approvalsDeleted: approvals.rows.length,
  };
}

export function usd(bytes: number): number {
  return Math.round(usdForBilledBytes(bytes) * 10_000) / 10_000;
}

export function formatUsd(bytes: number): string {
  const dollars = usdForBilledBytes(bytes);
  return dollars > 0 && dollars < 0.01 ? "<$0.01" : `$${dollars.toFixed(2)}`;
}

export function describeBigQueryAgentBudget(
  budget: BigQueryAgentBudgetSnapshot,
) {
  const scopeView = (s: BigQueryAgentBudgetScope) => ({
    limitUsd: usd(s.limitBytes),
    spentUsd: usd(s.settledBytes),
    reservedUsd: usd(s.reservedBytes),
    remainingUsd: usd(s.remainingBytes),
    remainingBytes: s.remainingBytes,
  });
  return {
    utcDay: budget.utcDay,
    resetsAt: budget.resetsAt,
    pricing: "$6.25 per TiB (2^40 bytes) billed, BigQuery on-demand list price",
    perJobCap: { bytes: budget.jobCapBytes, usd: usd(budget.jobCapBytes) },
    person: {
      ...scopeView(budget.person),
      noAskAllowanceUsd: usd(budget.person.baseAllowanceBytes),
      ceilingUsd: usd(budget.person.ceilingBytes),
      approvedToday: budget.person.approvedToday,
    },
    org: scopeView(budget.org),
    limitsSource: budget.limitsSource,
  };
}

export type BigQueryAgentBudgetView = ReturnType<
  typeof describeBigQueryAgentBudget
>;
