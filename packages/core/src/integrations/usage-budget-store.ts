import { getDbExec, intType, isPostgres, type DbExec } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import {
  getIntegrationScope,
  integrationScopeSubjectKey,
  type IntegrationScopeAccess,
  type IntegrationScopeKey,
} from "./scope-store.js";

let initPromise: Promise<void> | undefined;
let transactionTail: Promise<void> = Promise.resolve();

/** All budget values are integer millionths of one billing currency unit. */
export const INTEGRATION_BUDGET_COST_UNIT = "currency_micros" as const;

export type IntegrationBudgetPeriod = "day" | "month";
export type IntegrationBudgetSubject =
  | { type: "org"; orgId: string }
  | { type: "user"; userEmail: string }
  | { type: "scope"; scope: IntegrationScopeKey };

export interface IntegrationUsageBudget {
  id: string;
  subjectType: IntegrationBudgetSubject["type"];
  subjectId: string;
  period: IntegrationBudgetPeriod;
  /** Integer millionths of one billing currency unit. */
  limitMicros: number;
  /** Threshold in basis points: 8,000 means 80%. */
  thresholdBps: number;
  ownerEmail: string;
  orgId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface IntegrationBudgetSnapshot {
  budget: IntegrationUsageBudget;
  windowStart: number;
  windowEnd: number;
  usedMicros: number;
  reservedMicros: number;
  remainingMicros: number;
  costUnit: typeof INTEGRATION_BUDGET_COST_UNIT;
}

export type IntegrationReservationStatus =
  | "pending"
  | "reserved"
  | "denied"
  | "settled"
  | "released";

export interface IntegrationBudgetReservationResult {
  allowed: boolean;
  reservationId: string;
  status: IntegrationReservationStatus;
  estimatedCostMicros: number;
  settledCostMicros: number | null;
  thresholdEventEmitted: boolean;
  snapshot: IntegrationBudgetSnapshot;
}

export interface IntegrationBudgetThresholdEvent {
  id: string;
  budgetId: string;
  windowStart: number;
  thresholdBps: number;
  observedMicros: number;
  createdAt: number;
}

interface ResolvedSubject {
  type: IntegrationBudgetSubject["type"];
  id: string;
  partitionKey: string;
  orgId: string | null;
}

interface ReservationRow {
  id: string;
  reservationKey: string;
  budgetId: string;
  windowStart: number;
  estimatedCostMicros: number;
  settledCostMicros: number | null;
  status: IntegrationReservationStatus;
}

async function ensureTables(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = getDbExec();
      const budgetsSql = `CREATE TABLE IF NOT EXISTS integration_usage_budgets (
        id TEXT PRIMARY KEY,
        partition_key TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        period TEXT NOT NULL,
        limit_micros ${intType()} NOT NULL,
        threshold_bps ${intType()} NOT NULL DEFAULT 8000,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        created_at ${intType()} NOT NULL,
        updated_at ${intType()} NOT NULL
      )`;
      const windowsSql = `CREATE TABLE IF NOT EXISTS integration_usage_budget_windows (
        budget_id TEXT NOT NULL,
        window_start ${intType()} NOT NULL,
        used_micros ${intType()} NOT NULL DEFAULT 0,
        reserved_micros ${intType()} NOT NULL DEFAULT 0,
        updated_at ${intType()} NOT NULL,
        PRIMARY KEY (budget_id, window_start)
      )`;
      const reservationsSql = `CREATE TABLE IF NOT EXISTS integration_usage_reservations (
        id TEXT PRIMARY KEY,
        reservation_key TEXT NOT NULL,
        budget_id TEXT NOT NULL,
        window_start ${intType()} NOT NULL,
        estimated_cost_micros ${intType()} NOT NULL,
        settled_cost_micros ${intType()},
        status TEXT NOT NULL,
        created_at ${intType()} NOT NULL,
        updated_at ${intType()} NOT NULL
      )`;
      const eventsSql = `CREATE TABLE IF NOT EXISTS integration_usage_budget_events (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL,
        window_start ${intType()} NOT NULL,
        threshold_bps ${intType()} NOT NULL,
        observed_micros ${intType()} NOT NULL,
        created_at ${intType()} NOT NULL
      )`;
      const indexes = [
        {
          name: "idx_integration_budget_subject",
          sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_budget_subject ON integration_usage_budgets(partition_key, subject_type, subject_id, period)",
        },
        {
          name: "idx_integration_budget_owner",
          sql: "CREATE INDEX IF NOT EXISTS idx_integration_budget_owner ON integration_usage_budgets(owner_email, subject_type)",
        },
        {
          name: "idx_integration_budget_org",
          sql: "CREATE INDEX IF NOT EXISTS idx_integration_budget_org ON integration_usage_budgets(org_id, subject_type)",
        },
        {
          name: "idx_integration_reservation_budget",
          sql: "CREATE INDEX IF NOT EXISTS idx_integration_reservation_budget ON integration_usage_reservations(budget_id, window_start, status)",
        },
        {
          name: "idx_integration_budget_event_window",
          sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_budget_event_window ON integration_usage_budget_events(budget_id, window_start, threshold_bps)",
        },
      ];

      if (isPostgres()) {
        await ensureTableExists("integration_usage_budgets", budgetsSql);
        await ensureTableExists("integration_usage_budget_windows", windowsSql);
        await ensureTableExists(
          "integration_usage_reservations",
          reservationsSql,
        );
        await ensureTableExists("integration_usage_budget_events", eventsSql);
        for (const index of indexes) {
          await ensureIndexExists(index.name, index.sql);
        }
        return;
      }

      await db.execute(budgetsSql);
      await db.execute(windowsSql);
      await db.execute(reservationsSql);
      await db.execute(eventsSql);
      for (const index of indexes) await db.execute(index.sql);
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

function requiredString(value: unknown, name: string, maxLength = 512): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeEmail(value: unknown, name: string): string {
  const normalized = requiredString(value, name, 320).toLowerCase();
  if (!normalized.includes("@")) {
    throw new Error(`${name} must be an email address`);
  }
  return normalized;
}

function normalizeAccess(
  access: IntegrationScopeAccess,
): Required<IntegrationScopeAccess> {
  return {
    ownerEmail: normalizeEmail(access.ownerEmail, "ownerEmail"),
    orgId: access.orgId ? requiredString(access.orgId, "orgId") : null,
  };
}

function requireMicros(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be a safe integer in currency micros`);
  }
  return value;
}

function requireThresholdBps(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error("thresholdBps must be an integer from 1 to 10000");
  }
  return value;
}

function requirePeriod(
  value: IntegrationBudgetPeriod,
): IntegrationBudgetPeriod {
  if (value !== "day" && value !== "month") {
    throw new Error("period must be day or month");
  }
  return value;
}

function authorizationSql(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `((${prefix}subject_type = 'user' AND ${prefix}owner_email = ?) OR (${prefix}subject_type <> 'user' AND ((${prefix}org_id = ? AND CAST(? AS TEXT) IS NOT NULL) OR (${prefix}org_id IS NULL AND ${prefix}owner_email = ?))))`;
}

function authorizationArgs(
  access: Required<IntegrationScopeAccess>,
): unknown[] {
  return [access.ownerEmail, access.orgId, access.orgId, access.ownerEmail];
}

async function resolveSubject(
  subject: IntegrationBudgetSubject,
  access: Required<IntegrationScopeAccess>,
): Promise<ResolvedSubject> {
  if (subject.type === "org") {
    const orgId = requiredString(subject.orgId, "subject.orgId");
    if (!access.orgId || access.orgId !== orgId) {
      throw new Error("Not authorized to manage a budget for that org");
    }
    return { type: "org", id: orgId, partitionKey: `org:${orgId}`, orgId };
  }

  if (subject.type === "user") {
    const userEmail = normalizeEmail(subject.userEmail, "subject.userEmail");
    if (userEmail !== access.ownerEmail) {
      throw new Error("Not authorized to manage another user's budget");
    }
    return {
      type: "user",
      id: userEmail,
      partitionKey: access.orgId
        ? `org:${access.orgId}`
        : `owner:${access.ownerEmail}`,
      orgId: access.orgId,
    };
  }

  const scope = await getIntegrationScope(subject.scope, access);
  if (!scope)
    throw new Error("Integration scope is not available to this caller");
  return {
    type: "scope",
    id: integrationScopeSubjectKey(subject.scope),
    partitionKey: scope.orgId
      ? `org:${scope.orgId}`
      : `owner:${scope.ownerEmail}`,
    orgId: scope.orgId,
  };
}

function stableId(prefix: string, parts: unknown[]): string {
  return `${prefix}:${JSON.stringify(parts)}`;
}

function rowToBudget(row: Record<string, unknown>): IntegrationUsageBudget {
  return {
    id: String(row.id),
    subjectType: row.subject_type as IntegrationBudgetSubject["type"],
    subjectId: String(row.subject_id),
    period: row.period as IntegrationBudgetPeriod,
    limitMicros: Number(row.limit_micros),
    thresholdBps: Number(row.threshold_bps),
    ownerEmail: String(row.owner_email),
    orgId: row.org_id == null ? null : String(row.org_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToReservation(row: Record<string, unknown>): ReservationRow {
  return {
    id: String(row.id),
    reservationKey: String(row.reservation_key),
    budgetId: String(row.budget_id),
    windowStart: Number(row.window_start),
    estimatedCostMicros: Number(row.estimated_cost_micros),
    settledCostMicros:
      row.settled_cost_micros == null ? null : Number(row.settled_cost_micros),
    status: row.status as IntegrationReservationStatus,
  };
}

function windowForPeriod(
  period: IntegrationBudgetPeriod,
  timestamp: number,
): { start: number; end: number } {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid budget timestamp");
  const start =
    period === "day"
      ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const end =
    period === "day"
      ? start + 24 * 60 * 60 * 1000
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { start, end };
}

async function withSerializedTransaction<T>(
  fn: (tx: DbExec) => Promise<T>,
): Promise<T> {
  const previous = transactionTail;
  let release!: () => void;
  transactionTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  const db = getDbExec();
  try {
    if (db.transaction) return await db.transaction(fn);
    await db.execute(isPostgres() ? "BEGIN" : "BEGIN IMMEDIATE");
    try {
      const result = await fn(db);
      await db.execute("COMMIT");
      return result;
    } catch (error) {
      await db.execute("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    release();
  }
}

async function findBudget(
  db: DbExec,
  budgetId: string,
  access: Required<IntegrationScopeAccess>,
): Promise<IntegrationUsageBudget | null> {
  const { rows } = await db.execute({
    sql: `SELECT id, subject_type, subject_id, period, limit_micros,
      threshold_bps, owner_email, org_id, created_at, updated_at
      FROM integration_usage_budgets
      WHERE id = ? AND ${authorizationSql()} LIMIT 1`,
    args: [budgetId, ...authorizationArgs(access)],
  });
  return rows.length > 0
    ? rowToBudget(rows[0] as Record<string, unknown>)
    : null;
}

async function ensureWindow(
  db: DbExec,
  budgetId: string,
  windowStart: number,
  now: number,
): Promise<void> {
  // SQLite and Postgres both support this exact conflict target. It is used
  // only as the atomic create-if-absent primitive for the counter row.
  await db.execute({
    sql: `INSERT INTO integration_usage_budget_windows
      (budget_id, window_start, used_micros, reserved_micros, updated_at)
      VALUES (?, ?, 0, 0, ?)
      ON CONFLICT (budget_id, window_start) DO NOTHING`,
    args: [budgetId, windowStart, now],
  });
}

async function snapshotForBudget(
  db: DbExec,
  budget: IntegrationUsageBudget,
  timestamp: number,
): Promise<IntegrationBudgetSnapshot> {
  const window = windowForPeriod(budget.period, timestamp);
  const { rows } = await db.execute({
    sql: `SELECT used_micros, reserved_micros
      FROM integration_usage_budget_windows
      WHERE budget_id = ? AND window_start = ? LIMIT 1`,
    args: [budget.id, window.start],
  });
  const usedMicros = rows.length > 0 ? Number(rows[0].used_micros) : 0;
  const reservedMicros = rows.length > 0 ? Number(rows[0].reserved_micros) : 0;
  return {
    budget,
    windowStart: window.start,
    windowEnd: window.end,
    usedMicros,
    reservedMicros,
    remainingMicros: Math.max(
      0,
      budget.limitMicros - usedMicros - reservedMicros,
    ),
    costUnit: INTEGRATION_BUDGET_COST_UNIT,
  };
}

async function emitThresholdEvent(
  db: DbExec,
  budget: IntegrationUsageBudget,
  snapshot: IntegrationBudgetSnapshot,
  now: number,
): Promise<boolean> {
  const observedMicros = snapshot.usedMicros + snapshot.reservedMicros;
  if (observedMicros * 10_000 < budget.limitMicros * budget.thresholdBps) {
    return false;
  }
  const eventId = stableId("integration-budget-threshold", [
    budget.id,
    snapshot.windowStart,
    budget.thresholdBps,
  ]);
  const result = await db.execute({
    sql: `INSERT INTO integration_usage_budget_events
      (id, budget_id, window_start, threshold_bps, observed_micros, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING`,
    args: [
      eventId,
      budget.id,
      snapshot.windowStart,
      budget.thresholdBps,
      observedMicros,
      now,
    ],
  });
  return result.rowsAffected > 0;
}

export async function saveIntegrationUsageBudget(
  input: {
    subject: IntegrationBudgetSubject;
    period: IntegrationBudgetPeriod;
    limitMicros: number;
    thresholdBps?: number;
  },
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationUsageBudget> {
  await ensureTables();
  const access = normalizeAccess(accessInput);
  const subject = await resolveSubject(input.subject, access);
  const period = requirePeriod(input.period);
  const limitMicros = requireMicros(input.limitMicros, "limitMicros");
  const thresholdBps = requireThresholdBps(input.thresholdBps ?? 8_000);
  const id = stableId("integration-budget", [
    subject.partitionKey,
    subject.type,
    subject.id,
    period,
  ]);
  const now = Date.now();

  await withSerializedTransaction(async (tx) => {
    // The stable id is derived entirely from the authorized partition. The
    // conflict update therefore cannot cross an owner/org boundary.
    await tx.execute({
      sql: `INSERT INTO integration_usage_budgets (
        id, partition_key, subject_type, subject_id, period, limit_micros,
        threshold_bps, owner_email, org_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        limit_micros = excluded.limit_micros,
        threshold_bps = excluded.threshold_bps,
        updated_at = excluded.updated_at`,
      args: [
        id,
        subject.partitionKey,
        subject.type,
        subject.id,
        period,
        limitMicros,
        thresholdBps,
        access.ownerEmail,
        subject.orgId,
        now,
        now,
      ],
    });
  });

  const saved = await getIntegrationUsageBudget(id, access);
  if (!saved) throw new Error("Integration budget write could not be verified");
  return saved;
}

export async function getIntegrationUsageBudget(
  budgetIdInput: string,
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationUsageBudget | null> {
  await ensureTables();
  const budgetId = requiredString(budgetIdInput, "budgetId", 2_048);
  return findBudget(getDbExec(), budgetId, normalizeAccess(accessInput));
}

/** List budgets visible in the caller's personal/active-org partition. */
export async function listIntegrationUsageBudgets(
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationUsageBudget[]> {
  await ensureTables();
  const access = normalizeAccess(accessInput);
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, partition_key, subject_type, subject_id, period,
      limit_micros, threshold_bps, owner_email, org_id, created_at, updated_at
      FROM integration_usage_budgets
      WHERE ${authorizationSql()}
      ORDER BY updated_at DESC`,
    args: authorizationArgs(access),
  });
  return rows.map((row) => rowToBudget(row as Record<string, unknown>));
}

export async function getIntegrationBudgetSnapshot(
  budgetIdInput: string,
  accessInput: IntegrationScopeAccess,
  timestamp = Date.now(),
): Promise<IntegrationBudgetSnapshot | null> {
  await ensureTables();
  const access = normalizeAccess(accessInput);
  const budget = await findBudget(
    getDbExec(),
    requiredString(budgetIdInput, "budgetId", 2_048),
    access,
  );
  return budget ? snapshotForBudget(getDbExec(), budget, timestamp) : null;
}

export async function reserveIntegrationUsageBudget(
  input: {
    budgetId: string;
    reservationId: string;
    estimatedCostMicros: number;
    timestamp?: number;
  },
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationBudgetReservationResult> {
  await ensureTables();
  const access = normalizeAccess(accessInput);
  const budgetId = requiredString(input.budgetId, "budgetId", 2_048);
  const reservationId = requiredString(
    input.reservationId,
    "reservationId",
    512,
  );
  const estimatedCostMicros = requireMicros(
    input.estimatedCostMicros,
    "estimatedCostMicros",
  );
  const timestamp = input.timestamp ?? Date.now();

  return withSerializedTransaction(async (tx) => {
    const budget = await findBudget(tx, budgetId, access);
    if (!budget)
      throw new Error("Integration budget is not available to this caller");
    const window = windowForPeriod(budget.period, timestamp);
    const now = Date.now();
    const storageId = stableId("integration-reservation", [
      budget.id,
      reservationId,
    ]);

    const inserted = await tx.execute({
      sql: `INSERT INTO integration_usage_reservations (
        id, reservation_key, budget_id, window_start,
        estimated_cost_micros, settled_cost_micros, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?, ?)
      ON CONFLICT (id) DO NOTHING`,
      args: [
        storageId,
        reservationId,
        budget.id,
        window.start,
        estimatedCostMicros,
        now,
        now,
      ],
    });

    if (inserted.rowsAffected === 0) {
      const existing = await getReservation(tx, storageId, budget.id);
      if (!existing) {
        throw new Error("Reservation id is not available to this caller");
      }
      if (existing.estimatedCostMicros !== estimatedCostMicros) {
        throw new Error(
          "Reservation id was already used with a different estimate",
        );
      }
      if (existing.windowStart !== window.start) {
        throw new Error(
          "Reservation id was already used in a different budget window",
        );
      }
      const snapshot = await snapshotForBudget(
        tx,
        budget,
        existing.windowStart,
      );
      return {
        allowed:
          existing.status === "reserved" || existing.status === "settled",
        reservationId,
        status: existing.status,
        estimatedCostMicros,
        settledCostMicros: existing.settledCostMicros,
        thresholdEventEmitted: false,
        snapshot,
      };
    }

    await ensureWindow(tx, budget.id, window.start, now);
    const reserved = await tx.execute({
      sql: `UPDATE integration_usage_budget_windows
        SET reserved_micros = reserved_micros + ?, updated_at = ?
        WHERE budget_id = ? AND window_start = ?
          AND used_micros + reserved_micros + ? <= ?`,
      args: [
        estimatedCostMicros,
        now,
        budget.id,
        window.start,
        estimatedCostMicros,
        budget.limitMicros,
      ],
    });
    const allowed = reserved.rowsAffected > 0;
    const status: IntegrationReservationStatus = allowed
      ? "reserved"
      : "denied";
    await tx.execute({
      sql: `UPDATE integration_usage_reservations
        SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      args: [status, now, storageId],
    });
    const snapshot = await snapshotForBudget(tx, budget, timestamp);
    const thresholdEventEmitted = allowed
      ? await emitThresholdEvent(tx, budget, snapshot, now)
      : false;
    return {
      allowed,
      reservationId,
      status,
      estimatedCostMicros,
      settledCostMicros: null,
      thresholdEventEmitted,
      snapshot,
    };
  });
}

async function getReservation(
  db: DbExec,
  storageId: string,
  budgetId: string,
): Promise<ReservationRow | null> {
  const { rows } = await db.execute({
    sql: `SELECT id, reservation_key, budget_id, window_start,
      estimated_cost_micros, settled_cost_micros, status
      FROM integration_usage_reservations
      WHERE id = ? AND budget_id = ? LIMIT 1`,
    args: [storageId, budgetId],
  });
  return rows.length > 0
    ? rowToReservation(rows[0] as Record<string, unknown>)
    : null;
}

export async function settleIntegrationUsageBudget(
  input: {
    budgetId: string;
    reservationId: string;
    actualCostMicros: number;
  },
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationBudgetReservationResult> {
  await ensureTables();
  const access = normalizeAccess(accessInput);
  const budgetId = requiredString(input.budgetId, "budgetId", 2_048);
  const reservationId = requiredString(
    input.reservationId,
    "reservationId",
    512,
  );
  const actualCostMicros = requireMicros(
    input.actualCostMicros,
    "actualCostMicros",
    true,
  );

  return withSerializedTransaction(async (tx) => {
    const budget = await findBudget(tx, budgetId, access);
    if (!budget)
      throw new Error("Integration budget is not available to this caller");
    const storageId = stableId("integration-reservation", [
      budget.id,
      reservationId,
    ]);
    const reservation = await getReservation(tx, storageId, budget.id);
    if (!reservation) {
      throw new Error("Integration budget reservation was not found");
    }
    if (reservation.status === "denied" || reservation.status === "released") {
      throw new Error(`Cannot settle a ${reservation.status} reservation`);
    }
    if (reservation.status === "pending") {
      throw new Error("Cannot settle a pending reservation");
    }
    if (
      reservation.status === "settled" &&
      reservation.settledCostMicros !== actualCostMicros
    ) {
      throw new Error("Reservation was already settled with a different cost");
    }

    let thresholdEventEmitted = false;
    if (reservation.status === "reserved") {
      const now = Date.now();
      const updated = await tx.execute({
        sql: `UPDATE integration_usage_budget_windows SET
          reserved_micros = reserved_micros - ?,
          used_micros = used_micros + ?,
          updated_at = ?
          WHERE budget_id = ? AND window_start = ?
            AND reserved_micros >= ?`,
        args: [
          reservation.estimatedCostMicros,
          actualCostMicros,
          now,
          budget.id,
          reservation.windowStart,
          reservation.estimatedCostMicros,
        ],
      });
      if (updated.rowsAffected === 0) {
        throw new Error(
          "Integration budget reservation counter is inconsistent",
        );
      }
      await tx.execute({
        sql: `UPDATE integration_usage_reservations SET
          status = 'settled', settled_cost_micros = ?, updated_at = ?
          WHERE id = ? AND status = 'reserved'`,
        args: [actualCostMicros, now, reservation.id],
      });
      const thresholdSnapshot = await snapshotForBudget(
        tx,
        budget,
        reservation.windowStart,
      );
      thresholdEventEmitted = await emitThresholdEvent(
        tx,
        budget,
        thresholdSnapshot,
        now,
      );
    }

    const snapshot = await snapshotForBudget(
      tx,
      budget,
      reservation.windowStart,
    );
    return {
      allowed: true,
      reservationId,
      status: "settled",
      estimatedCostMicros: reservation.estimatedCostMicros,
      settledCostMicros: actualCostMicros,
      thresholdEventEmitted,
      snapshot,
    };
  });
}

export async function releaseIntegrationUsageBudget(
  input: { budgetId: string; reservationId: string },
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationBudgetReservationResult> {
  await ensureTables();
  const access = normalizeAccess(accessInput);
  const budgetId = requiredString(input.budgetId, "budgetId", 2_048);
  const reservationId = requiredString(
    input.reservationId,
    "reservationId",
    512,
  );

  return withSerializedTransaction(async (tx) => {
    const budget = await findBudget(tx, budgetId, access);
    if (!budget)
      throw new Error("Integration budget is not available to this caller");
    const storageId = stableId("integration-reservation", [
      budget.id,
      reservationId,
    ]);
    const reservation = await getReservation(tx, storageId, budget.id);
    if (!reservation) {
      throw new Error("Integration budget reservation was not found");
    }
    if (reservation.status === "settled") {
      throw new Error("Cannot release a settled reservation");
    }
    if (reservation.status === "pending") {
      throw new Error("Cannot release a pending reservation");
    }

    if (reservation.status === "reserved") {
      const now = Date.now();
      const updated = await tx.execute({
        sql: `UPDATE integration_usage_budget_windows SET
          reserved_micros = reserved_micros - ?, updated_at = ?
          WHERE budget_id = ? AND window_start = ?
            AND reserved_micros >= ?`,
        args: [
          reservation.estimatedCostMicros,
          now,
          budget.id,
          reservation.windowStart,
          reservation.estimatedCostMicros,
        ],
      });
      if (updated.rowsAffected === 0) {
        throw new Error(
          "Integration budget reservation counter is inconsistent",
        );
      }
      await tx.execute({
        sql: `UPDATE integration_usage_reservations
          SET status = 'released', updated_at = ?
          WHERE id = ? AND status = 'reserved'`,
        args: [now, reservation.id],
      });
    }

    const snapshot = await snapshotForBudget(
      tx,
      budget,
      reservation.windowStart,
    );
    return {
      allowed: false,
      reservationId,
      status: reservation.status === "denied" ? "denied" : "released",
      estimatedCostMicros: reservation.estimatedCostMicros,
      settledCostMicros: reservation.settledCostMicros,
      thresholdEventEmitted: false,
      snapshot,
    };
  });
}

export async function listIntegrationBudgetThresholdEvents(
  budgetIdInput: string,
  accessInput: IntegrationScopeAccess,
): Promise<IntegrationBudgetThresholdEvent[]> {
  await ensureTables();
  const access = normalizeAccess(accessInput);
  const budgetId = requiredString(budgetIdInput, "budgetId", 2_048);
  const budget = await findBudget(getDbExec(), budgetId, access);
  if (!budget) return [];
  const { rows } = await getDbExec().execute({
    sql: `SELECT id, budget_id, window_start, threshold_bps,
      observed_micros, created_at
      FROM integration_usage_budget_events
      WHERE budget_id = ? ORDER BY window_start DESC, created_at DESC`,
    args: [budget.id],
  });
  return rows.map((row) => ({
    id: String(row.id),
    budgetId: String(row.budget_id),
    windowStart: Number(row.window_start),
    thresholdBps: Number(row.threshold_bps),
    observedMicros: Number(row.observed_micros),
    createdAt: Number(row.created_at),
  }));
}

/** Test-only reset for suites that swap the injected database. */
export function _resetIntegrationUsageBudgetStoreForTests(): void {
  initPromise = undefined;
  transactionTail = Promise.resolve();
}
