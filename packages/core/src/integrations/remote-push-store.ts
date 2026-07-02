import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
} from "../db/client.js";
import { ensureTableExists, ensureIndexExists } from "../db/ddl-guard.js";
import type {
  PublicRemotePushRegistration,
  RemotePushNotification,
  RemotePushRegistration,
} from "./remote-types.js";

let _initPromise: Promise<void> | undefined;

// Build the CREATE SQL lazily (not at module scope) so intType() runs at
// RUNTIME, not import time — a module-scope call breaks any consumer whose
// db/client mock doesn't stub intType (e.g. db-admin specs).
function buildCreateRegistrationsSql(): string {
  return `
  CREATE TABLE IF NOT EXISTS integration_remote_push_registrations (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    provider TEXT NOT NULL,
    platform TEXT,
    client_device_id TEXT,
    label TEXT,
    token TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    last_seen_at ${intType()},
    created_at ${intType()} NOT NULL,
    updated_at ${intType()} NOT NULL
  )
`;
}

function buildCreateNotificationsSql(): string {
  return `
  CREATE TABLE IF NOT EXISTS integration_remote_push_notifications (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    registration_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts ${intType()} NOT NULL DEFAULT 0,
    created_at ${intType()} NOT NULL,
    updated_at ${intType()} NOT NULL
  )
`;
}

async function ensureTables(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createRegistrationsSql = buildCreateRegistrationsSql();
      const createNotificationsSql = buildCreateNotificationsSql();
      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists(
          "integration_remote_push_registrations",
          createRegistrationsSql,
        );
        await ensureIndexExists(
          "idx_remote_push_token_hash",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_push_token_hash ON integration_remote_push_registrations(token_hash)`,
        );
        await ensureIndexExists(
          "idx_remote_push_owner",
          `CREATE INDEX IF NOT EXISTS idx_remote_push_owner ON integration_remote_push_registrations(owner_email, org_id, status)`,
        );
        await ensureTableExists(
          "integration_remote_push_notifications",
          createNotificationsSql,
        );
        await ensureIndexExists(
          "idx_remote_push_notifications_owner",
          `CREATE INDEX IF NOT EXISTS idx_remote_push_notifications_owner ON integration_remote_push_notifications(owner_email, org_id, status, created_at)`,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior
      await retryOnDdlRace(() => client.execute(createRegistrationsSql));
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_push_token_hash ON integration_remote_push_registrations(token_hash)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_remote_push_owner ON integration_remote_push_registrations(owner_email, org_id, status)`,
        ),
      );

      await retryOnDdlRace(() => client.execute(createNotificationsSql));
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_remote_push_notifications_owner ON integration_remote_push_notifications(owner_email, org_id, status, created_at)`,
        ),
      );
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function rowToRegistration(
  row: Record<string, unknown>,
): RemotePushRegistration {
  return {
    id: row.id as string,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    provider: row.provider as string,
    platform: (row.platform as string | null) ?? null,
    clientDeviceId: (row.client_device_id as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    token: row.token as string,
    tokenHash: row.token_hash as string,
    status: row.status as RemotePushRegistration["status"],
    lastSeenAt:
      row.last_seen_at == null ? null : Number(row.last_seen_at as number),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

function rowToNotification(
  row: Record<string, unknown>,
): RemotePushNotification {
  return {
    id: row.id as string,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    registrationId: row.registration_id as string,
    payload: parseJson(row.payload_json, null),
    status: row.status as RemotePushNotification["status"],
    attempts: Number(row.attempts ?? 0),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function toPublicRemotePushRegistration(
  registration: RemotePushRegistration,
): PublicRemotePushRegistration {
  return {
    id: registration.id,
    ownerEmail: registration.ownerEmail,
    orgId: registration.orgId,
    provider: registration.provider,
    platform: registration.platform,
    clientDeviceId: registration.clientDeviceId,
    label: registration.label,
    status: registration.status,
    lastSeenAt: registration.lastSeenAt,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
  };
}

export async function upsertRemotePushRegistration(input: {
  ownerEmail: string;
  orgId?: string | null;
  provider: string;
  token: string;
  platform?: string | null;
  clientDeviceId?: string | null;
  label?: string | null;
}): Promise<RemotePushRegistration> {
  await ensureTables();
  const client = getDbExec();
  const now = Date.now();
  const tokenHash = await hashToken(input.token);
  const provider = sanitizeString(input.provider, 80) ?? "unknown";
  const platform = sanitizeString(input.platform, 80);
  const clientDeviceId = sanitizeString(input.clientDeviceId, 200);
  const label = sanitizeString(input.label, 200);

  const existing = await getRemotePushRegistrationByTokenHash(tokenHash);
  if (existing) {
    await client.execute({
      sql: `UPDATE integration_remote_push_registrations
            SET owner_email = ?,
                org_id = ?,
                provider = ?,
                platform = ?,
                client_device_id = ?,
                label = ?,
                token = ?,
                status = 'active',
                last_seen_at = ?,
                updated_at = ?
            WHERE token_hash = ?`,
      args: [
        input.ownerEmail,
        input.orgId ?? null,
        provider,
        platform,
        clientDeviceId,
        label,
        input.token,
        now,
        now,
        tokenHash,
      ],
    });
    const updated = await getRemotePushRegistrationByTokenHash(tokenHash);
    if (!updated) throw new Error("remote push registration update failed");
    return updated;
  }

  const id = `remote-push-${now}-${randomHex(8)}`;
  await client.execute({
    sql: `INSERT INTO integration_remote_push_registrations
      (id, owner_email, org_id, provider, platform, client_device_id, label,
       token, token_hash, status, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.ownerEmail,
      input.orgId ?? null,
      provider,
      platform,
      clientDeviceId,
      label,
      input.token,
      tokenHash,
      "active",
      now,
      now,
      now,
    ],
  });
  const registration = await getRemotePushRegistrationByTokenHash(tokenHash);
  if (!registration) throw new Error("remote push registration insert failed");
  return registration;
}

export async function listRemotePushRegistrationsForOwner(input: {
  ownerEmail: string;
  orgId?: string | null;
  includeInactive?: boolean;
  limit?: number;
}): Promise<RemotePushRegistration[]> {
  await ensureTables();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const statusClause = input.includeInactive ? "" : " AND status = 'active'";
  if (!Object.prototype.hasOwnProperty.call(input, "orgId")) {
    const { rows } = await getDbExec().execute({
      sql: `SELECT * FROM integration_remote_push_registrations
            WHERE owner_email = ?${statusClause}
            ORDER BY COALESCE(last_seen_at, updated_at) DESC
            LIMIT ?`,
      args: [input.ownerEmail, limit],
    });
    return rows.map((row) => rowToRegistration(row as Record<string, unknown>));
  }
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_push_registrations
          WHERE owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)${statusClause}
          ORDER BY COALESCE(last_seen_at, updated_at) DESC
          LIMIT ?`,
    args: [input.ownerEmail, input.orgId ?? null, input.orgId ?? null, limit],
  });
  return rows.map((row) => rowToRegistration(row as Record<string, unknown>));
}

export async function unregisterRemotePushRegistrationForOwner(input: {
  ownerEmail: string;
  orgId?: string | null;
  id?: string | null;
  token?: string | null;
}): Promise<boolean> {
  await ensureTables();
  const tokenHash = input.token ? await hashToken(input.token) : null;
  if (!input.id && !tokenHash) return false;
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE integration_remote_push_registrations
          SET status = 'inactive', updated_at = ?
          WHERE owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
            AND (${input.id ? "id = ?" : "0 = 1"} OR ${
              tokenHash ? "token_hash = ?" : "0 = 1"
            })`,
    args: [
      now,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
      ...(input.id ? [input.id] : []),
      ...(tokenHash ? [tokenHash] : []),
    ],
  });
  return (result.rowsAffected ?? (result as any).rowCount ?? 0) > 0;
}

export async function queueRemotePushNotifications(input: {
  ownerEmail: string;
  orgId?: string | null;
  payload: unknown;
}): Promise<{ queued: number }> {
  await ensureTables();
  const registrations = await listRemotePushRegistrationsForOwner({
    ownerEmail: input.ownerEmail,
    orgId: input.orgId ?? null,
    limit: 100,
  });
  const client = getDbExec();
  const now = Date.now();
  let queued = 0;
  for (const registration of registrations) {
    const id = `remote-push-notification-${now}-${randomHex(8)}`;
    const result = await client.execute({
      sql: `INSERT INTO integration_remote_push_notifications
        (id, owner_email, org_id, registration_id, payload_json, status,
         attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.ownerEmail,
        input.orgId ?? null,
        registration.id,
        JSON.stringify(input.payload ?? null),
        "pending",
        0,
        now,
        now,
      ],
    });
    queued += result.rowsAffected ?? (result as any).rowCount ?? 0;
  }
  return { queued };
}

export async function listRemotePushNotificationsForOwner(input: {
  ownerEmail: string;
  orgId?: string | null;
  status?: RemotePushNotification["status"];
  limit?: number;
}): Promise<RemotePushNotification[]> {
  await ensureTables();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const statusClause = input.status ? " AND status = ?" : "";
  const args: Array<string | number | null> = [
    input.ownerEmail,
    input.orgId ?? null,
    input.orgId ?? null,
  ];
  if (input.status) args.push(input.status);
  args.push(limit);
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_push_notifications
          WHERE owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)${statusClause}
          ORDER BY created_at DESC
          LIMIT ?`,
    args,
  });
  return rows.map((row) => rowToNotification(row as Record<string, unknown>));
}

async function getRemotePushRegistrationByTokenHash(
  tokenHash: string,
): Promise<RemotePushRegistration | null> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_push_registrations
          WHERE token_hash = ?
          LIMIT 1`,
    args: [tokenHash],
  });
  return rows[0] ? rowToRegistration(rows[0] as Record<string, unknown>) : null;
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeString(
  value: string | null | undefined,
  max: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (value == null) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}
