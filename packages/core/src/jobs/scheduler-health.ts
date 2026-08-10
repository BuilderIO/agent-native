import { randomUUID } from "node:crypto";

import { getDbExec, intType, isPostgres } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { runMigrations, type MigrationEntry } from "../db/migrations.js";

const TABLE = "automation_scheduler_health";
const DEFAULT_APP_ID = "default";
const MAX_ERROR_LENGTH = 500;

export const AUTOMATION_SCHEDULER_LEASE_MS = 10 * 60_000;
export const AUTOMATION_SCHEDULER_LEASE_RENEWAL_MS = 60_000;

/** Authoritative release-time schema for recurring scheduler health. */
export const AUTOMATION_SCHEDULER_HEALTH_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "automation-scheduler-health-table",
    sql: `
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL DEFAULT 'default',
        org_id TEXT,
        last_checked_at INTEGER,
        last_dispatched_at INTEGER,
        last_error TEXT,
        runtime TEXT,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS app_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS org_id TEXT;
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS last_checked_at INTEGER;
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS last_dispatched_at INTEGER;
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS last_error TEXT;
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS runtime TEXT;
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS updated_at INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_${TABLE}_updated ON ${TABLE} (updated_at)
    `,
  },
  {
    version: 2,
    name: "automation-scheduler-health-lease",
    sql: `
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS lease_owner TEXT;
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS lease_expires_at INTEGER;
    `,
  },
];

export async function runAutomationSchedulerHealthMigrations(
  nitroApp: unknown,
): Promise<void> {
  await runMigrations(AUTOMATION_SCHEDULER_HEALTH_MIGRATIONS, {
    table: "_automation_scheduler_health_migrations",
  })(nitroApp);
}

function normalizeAppId(appId: string | undefined): string {
  const normalized = appId?.trim();
  return normalized || DEFAULT_APP_ID;
}

function rowIdForScope(appId: string, orgId: string | null): string {
  return `${appId}:${orgId ?? "global"}`;
}

export interface AutomationSchedulerHealth {
  appId: string;
  orgId: string | null;
  lastCheckedAt: number | null;
  lastDispatchedAt: number | null;
  lastError: string | null;
  runtime: string | null;
  updatedAt: number | null;
}

let initPromise: Promise<void> | undefined;

async function ensureHealthTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL DEFAULT 'default',
          org_id TEXT,
          last_checked_at ${intType()},
          last_dispatched_at ${intType()},
          last_error TEXT,
          runtime TEXT,
          updated_at ${intType()} NOT NULL,
          lease_owner TEXT,
          lease_expires_at ${intType()}
        )
      `;
      const indexSql = `CREATE INDEX IF NOT EXISTS idx_${TABLE}_updated ON ${TABLE} (updated_at)`;
      if (isPostgres()) {
        await ensureTableExists(TABLE, createSql);
        await ensureColumnExists(
          TABLE,
          "app_id",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS app_id TEXT NOT NULL DEFAULT 'default'`,
        );
        await ensureColumnExists(
          TABLE,
          "org_id",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS org_id TEXT`,
        );
        await ensureColumnExists(
          TABLE,
          "last_checked_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS last_checked_at ${intType()}`,
        );
        await ensureColumnExists(
          TABLE,
          "last_dispatched_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS last_dispatched_at ${intType()}`,
        );
        await ensureColumnExists(
          TABLE,
          "last_error",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS last_error TEXT`,
        );
        await ensureColumnExists(
          TABLE,
          "runtime",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS runtime TEXT`,
        );
        await ensureColumnExists(
          TABLE,
          "updated_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS updated_at ${intType()}`,
        );
        await ensureColumnExists(
          TABLE,
          "lease_owner",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS lease_owner TEXT`,
        );
        await ensureColumnExists(
          TABLE,
          "lease_expires_at",
          `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS lease_expires_at ${intType()}`,
        );
        await ensureIndexExists(`idx_${TABLE}_updated`, indexSql);
        return;
      }

      const client = getDbExec();
      await client.execute(createSql);
      const { rows } = await client.execute(`PRAGMA table_info("${TABLE}")`);
      const columns = new Set(
        rows.map((row) => String((row as Record<string, unknown>).name)),
      );
      for (const [name, definition] of [
        ["app_id", "TEXT NOT NULL DEFAULT 'default'"],
        ["org_id", "TEXT"],
        ["last_checked_at", `${intType()}`],
        ["last_dispatched_at", `${intType()}`],
        ["last_error", "TEXT"],
        ["runtime", "TEXT"],
        ["updated_at", `${intType()} NOT NULL DEFAULT 0`],
        ["lease_owner", "TEXT"],
        ["lease_expires_at", `${intType()}`],
      ] as const) {
        if (columns.has(name)) continue;
        try {
          await client.execute(
            `ALTER TABLE ${TABLE} ADD COLUMN ${name} ${definition}`,
          );
        } catch (error) {
          const message = String(
            (error as { message?: unknown } | null)?.message ?? error,
          );
          if (
            !/duplicate column name/i.test(message) &&
            !/column .* already exists/i.test(message)
          ) {
            throw error;
          }
        }
      }
      await client.execute(indexSql);
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return (
    candidate?.code === "23505" ||
    /unique|duplicate|already exists/i.test(String(candidate?.message ?? error))
  );
}

function leaseRowId(appId: string): string {
  return rowIdForScope(appId, null);
}

/** Claim one recurring scheduler across all deployments of an app. */
export async function acquireAutomationSchedulerLease(
  input: {
    appId?: string;
    now?: number;
    leaseMs?: number;
  } = {},
): Promise<string | null> {
  await ensureHealthTable();
  const appId = normalizeAppId(input.appId);
  const id = leaseRowId(appId);
  const now = input.now ?? Date.now();
  const leaseMs = Math.max(
    input.leaseMs ?? AUTOMATION_SCHEDULER_LEASE_MS,
    AUTOMATION_SCHEDULER_LEASE_RENEWAL_MS * 2,
  );
  const owner = randomUUID();
  const expiresAt = now + leaseMs;
  const client = getDbExec();

  try {
    await client.execute({
      sql: `INSERT INTO ${TABLE}
        (id, app_id, org_id, last_checked_at, last_dispatched_at, last_error, runtime, updated_at, lease_owner, lease_expires_at)
        VALUES (?, ?, NULL, NULL, NULL, NULL, 'recurring-jobs', ?, ?, ?)`,
      args: [id, appId, now, owner, expiresAt],
    });
    return owner;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const result = await client.execute({
    sql: `UPDATE ${TABLE}
          SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
          WHERE id = ?
            AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`,
    args: [owner, expiresAt, now, id, now],
  });
  return Number(result.rowsAffected ?? 0) > 0 ? owner : null;
}

/** Renew a lease while a slow sweep is still executing. */
export async function renewAutomationSchedulerLease(input: {
  appId?: string;
  owner: string;
  now?: number;
  leaseMs?: number;
}): Promise<boolean> {
  await ensureHealthTable();
  const now = input.now ?? Date.now();
  const expiresAt =
    now + Math.max(input.leaseMs ?? AUTOMATION_SCHEDULER_LEASE_MS, 0);
  const result = await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET lease_expires_at = ?, updated_at = ?
          WHERE id = ? AND lease_owner = ?`,
    args: [
      expiresAt,
      now,
      leaseRowId(normalizeAppId(input.appId)),
      input.owner,
    ],
  });
  return Number(result.rowsAffected ?? 0) > 0;
}

/** Release only the lease owned by this invocation. */
export async function releaseAutomationSchedulerLease(input: {
  appId?: string;
  owner: string;
}): Promise<void> {
  await ensureHealthTable();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE}
          SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND lease_owner = ?`,
    args: [Date.now(), leaseRowId(normalizeAppId(input.appId)), input.owner],
  });
}

function fromRow(row: Record<string, unknown>): AutomationSchedulerHealth {
  return {
    appId: String(row.app_id ?? DEFAULT_APP_ID),
    orgId: row.org_id == null ? null : String(row.org_id),
    lastCheckedAt:
      row.last_checked_at == null ? null : Number(row.last_checked_at),
    lastDispatchedAt:
      row.last_dispatched_at == null ? null : Number(row.last_dispatched_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    runtime: row.runtime == null ? null : String(row.runtime),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
  };
}

/** Record the last scheduler tick without making health bookkeeping fatal. */
export async function recordAutomationSchedulerHealth(input: {
  appId?: string;
  orgId?: string | null;
  checkedAt?: number;
  dispatchedAt?: number;
  error?: string | null;
  runtime?: string | null;
}): Promise<void> {
  await ensureHealthTable();
  const appId = normalizeAppId(input.appId);
  const orgId = input.orgId ?? null;
  const rowId = rowIdForScope(appId, orgId);
  const now = Date.now();
  const checkedAt = input.checkedAt ?? now;
  const existing = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [rowId],
  });
  const row = existing.rows?.[0] as Record<string, unknown> | undefined;
  if (row) {
    await getDbExec().execute({
      sql: `UPDATE ${TABLE}
            SET last_checked_at = ?,
                last_dispatched_at = ?,
                last_error = ?,
                runtime = ?,
                updated_at = ?
            WHERE id = ?`,
      args: [
        checkedAt,
        input.dispatchedAt ?? row.last_dispatched_at ?? null,
        input.error?.slice(0, MAX_ERROR_LENGTH) ?? null,
        input.runtime ?? row.runtime ?? null,
        now,
        rowId,
      ],
    });
    return;
  }

  try {
    await getDbExec().execute({
      sql: `INSERT INTO ${TABLE}
        (id, app_id, org_id, last_checked_at, last_dispatched_at, last_error, runtime, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        rowId,
        appId,
        orgId,
        checkedAt,
        input.dispatchedAt ?? null,
        input.error?.slice(0, MAX_ERROR_LENGTH) ?? null,
        input.runtime ?? null,
        now,
      ],
    });
  } catch (error) {
    // Another serverless isolate may have inserted this scope between the read
    // and insert. Turn that race into the same update path.
    const message = String(
      (error as { message?: unknown } | null)?.message ?? error,
    );
    if (!/unique|duplicate/i.test(message)) throw error;
    await getDbExec().execute({
      sql: `UPDATE ${TABLE}
            SET last_checked_at = ?,
                last_dispatched_at = COALESCE(?, last_dispatched_at),
                last_error = ?,
                runtime = ?,
                updated_at = ?
            WHERE id = ?`,
      args: [
        checkedAt,
        input.dispatchedAt ?? null,
        input.error?.slice(0, MAX_ERROR_LENGTH) ?? null,
        input.runtime ?? null,
        now,
        rowId,
      ],
    });
  }
}

export async function getAutomationSchedulerHealth(
  input: {
    appId?: string;
    orgId?: string | null;
  } = {},
): Promise<AutomationSchedulerHealth | null> {
  await ensureHealthTable();
  const appId = normalizeAppId(input.appId);
  const rowId = rowIdForScope(appId, input.orgId ?? null);
  const result = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [rowId],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}
