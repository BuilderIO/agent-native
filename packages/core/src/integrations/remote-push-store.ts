import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
} from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { isDuplicateColumnError } from "../db/migrations.js";
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
    provider_ticket_id TEXT,
    next_attempt_at ${intType()} NOT NULL DEFAULT 0,
    last_error TEXT,
    delivered_at ${intType()},
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
        await ensureColumnExists(
          "integration_remote_push_notifications",
          "provider_ticket_id",
          `ALTER TABLE integration_remote_push_notifications ADD COLUMN IF NOT EXISTS provider_ticket_id TEXT`,
        );
        await ensureColumnExists(
          "integration_remote_push_notifications",
          "next_attempt_at",
          `ALTER TABLE integration_remote_push_notifications ADD COLUMN IF NOT EXISTS next_attempt_at ${intType()} NOT NULL DEFAULT 0`,
        );
        await ensureColumnExists(
          "integration_remote_push_notifications",
          "last_error",
          `ALTER TABLE integration_remote_push_notifications ADD COLUMN IF NOT EXISTS last_error TEXT`,
        );
        await ensureColumnExists(
          "integration_remote_push_notifications",
          "delivered_at",
          `ALTER TABLE integration_remote_push_notifications ADD COLUMN IF NOT EXISTS delivered_at ${intType()}`,
        );
        await ensureIndexExists(
          "idx_remote_push_notifications_delivery",
          `CREATE INDEX IF NOT EXISTS idx_remote_push_notifications_delivery ON integration_remote_push_notifications(status, next_attempt_at, updated_at)`,
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
      await addNotificationColumnIfMissing("provider_ticket_id", "TEXT");
      await addNotificationColumnIfMissing(
        "next_attempt_at",
        `${intType()} NOT NULL DEFAULT 0`,
      );
      await addNotificationColumnIfMissing("last_error", "TEXT");
      await addNotificationColumnIfMissing("delivered_at", intType());
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_remote_push_notifications_delivery ON integration_remote_push_notifications(status, next_attempt_at, updated_at)`,
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

async function addNotificationColumnIfMissing(
  name: string,
  definition: string,
): Promise<void> {
  try {
    await retryOnDdlRace(() =>
      getDbExec().execute(
        `ALTER TABLE integration_remote_push_notifications ADD COLUMN ${name} ${definition}`,
      ),
    );
  } catch (error) {
    if (!isDuplicateColumnError(error)) throw error;
  }
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
  const storedStatus = String(row.status ?? "pending");
  const status =
    storedStatus === "delivered" || storedStatus === "failed"
      ? storedStatus
      : "pending";
  return {
    id: row.id as string,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    registrationId: row.registration_id as string,
    payload: parseJson(row.payload_json, null),
    status,
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
  if (registrations.length === 0) return { queued: 0 };

  const client = getDbExec();
  const now = Date.now();
  const payload = JSON.stringify(input.payload ?? null);
  const values = registrations.map(
    () => "(?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)",
  );
  const args = registrations.flatMap((registration) => [
    `remote-push-notification-${now}-${randomHex(8)}`,
    input.ownerEmail,
    input.orgId ?? null,
    registration.id,
    payload,
    now,
    now,
    now,
  ]);
  const result = await client.execute({
    sql: `INSERT INTO integration_remote_push_notifications
        (id, owner_email, org_id, registration_id, payload_json, status,
         attempts, next_attempt_at, created_at, updated_at)
        VALUES ${values.join(", ")}`,
    args,
  });
  return {
    queued: result.rowsAffected ?? (result as any).rowCount ?? 0,
  };
}

export async function listRemotePushNotificationsForOwner(input: {
  ownerEmail: string;
  orgId?: string | null;
  status?: RemotePushNotification["status"];
  limit?: number;
}): Promise<RemotePushNotification[]> {
  await ensureTables();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const statusClause = input.status
    ? input.status === "pending"
      ? " AND status IN ('pending', 'sending', 'sent', 'checking')"
      : " AND status = ?"
    : "";
  const args: Array<string | number | null> = [
    input.ownerEmail,
    input.orgId ?? null,
    input.orgId ?? null,
  ];
  if (input.status && input.status !== "pending") args.push(input.status);
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

export interface ClaimedRemotePushDelivery {
  id: string;
  registrationId: string;
  provider: string;
  token: string;
  payload: unknown;
  phase: "send" | "receipt";
  providerTicketId: string | null;
  attempts: number;
}

export async function claimNextRemotePushDelivery(input?: {
  now?: number;
  staleAfterMs?: number;
}): Promise<ClaimedRemotePushDelivery | null> {
  await ensureTables();
  const client = getDbExec();
  const now = input?.now ?? Date.now();
  const staleBefore = now - Math.max(30_000, input?.staleAfterMs ?? 120_000);
  const { rows } = await client.execute({
    sql: `SELECT n.id, n.registration_id, n.payload_json, n.status, n.attempts,
                 n.provider_ticket_id, n.updated_at, r.provider, r.token
          FROM integration_remote_push_notifications n
          INNER JOIN integration_remote_push_registrations r
            ON r.id = n.registration_id
          WHERE r.status = 'active'
            AND (
              (n.status IN ('pending', 'sent') AND n.next_attempt_at <= ?)
              OR (n.status IN ('sending', 'checking') AND n.updated_at <= ?)
            )
          ORDER BY n.created_at ASC
          LIMIT 1`,
    args: [now, staleBefore],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const previousStatus = String(row.status ?? "pending");
  const providerTicketId = sanitizeString(
    row.provider_ticket_id as string | null,
    200,
  );
  const phase =
    (previousStatus === "sent" || previousStatus === "checking") &&
    providerTicketId
      ? "receipt"
      : "send";
  const claimedStatus = phase === "receipt" ? "checking" : "sending";
  const result = await client.execute({
    sql: `UPDATE integration_remote_push_notifications
          SET status = ?, attempts = attempts + 1, updated_at = ?
          WHERE id = ? AND status = ? AND updated_at = ?`,
    args: [
      claimedStatus,
      now,
      row.id as string,
      previousStatus,
      Number(row.updated_at),
    ],
  });
  if ((result.rowsAffected ?? (result as any).rowCount ?? 0) !== 1) return null;

  return {
    id: row.id as string,
    registrationId: row.registration_id as string,
    provider: String(row.provider ?? "unknown"),
    token: row.token as string,
    payload: parseJson(row.payload_json, null),
    phase,
    providerTicketId,
    attempts: Number(row.attempts ?? 0) + 1,
  };
}

export async function markRemotePushTicketAccepted(input: {
  id: string;
  providerTicketId: string;
  checkAfter: number;
}): Promise<boolean> {
  await ensureTables();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE integration_remote_push_notifications
          SET status = 'sent', provider_ticket_id = ?, next_attempt_at = ?,
              last_error = NULL, updated_at = ?
          WHERE id = ? AND status = 'sending'`,
    args: [input.providerTicketId, input.checkAfter, now, input.id],
  });
  return (result.rowsAffected ?? (result as any).rowCount ?? 0) === 1;
}

export async function markRemotePushDelivered(id: string): Promise<boolean> {
  await ensureTables();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE integration_remote_push_notifications
          SET status = 'delivered', last_error = NULL, delivered_at = ?,
              updated_at = ?
          WHERE id = ? AND status = 'checking'`,
    args: [now, now, id],
  });
  return (result.rowsAffected ?? (result as any).rowCount ?? 0) === 1;
}

export async function retryRemotePushDelivery(input: {
  id: string;
  phase: "send" | "receipt";
  retryAt: number;
  errorCode: string;
  resend?: boolean;
}): Promise<boolean> {
  await ensureTables();
  const currentStatus = input.phase === "receipt" ? "checking" : "sending";
  const retryStatus =
    input.phase === "receipt" && !input.resend ? "sent" : "pending";
  const clearTicketClause = input.resend ? ", provider_ticket_id = NULL" : "";
  const result = await getDbExec().execute({
    sql: `UPDATE integration_remote_push_notifications
          SET status = ?, next_attempt_at = ?, last_error = ?${clearTicketClause},
              updated_at = ?
          WHERE id = ? AND status = ?`,
    args: [
      retryStatus,
      input.retryAt,
      sanitizeString(input.errorCode, 160) ?? "temporary_error",
      Date.now(),
      input.id,
      currentStatus,
    ],
  });
  return (result.rowsAffected ?? (result as any).rowCount ?? 0) === 1;
}

export async function failRemotePushDelivery(input: {
  id: string;
  phase: "send" | "receipt";
  errorCode: string;
}): Promise<boolean> {
  await ensureTables();
  const currentStatus = input.phase === "receipt" ? "checking" : "sending";
  const result = await getDbExec().execute({
    sql: `UPDATE integration_remote_push_notifications
          SET status = 'failed', last_error = ?, updated_at = ?
          WHERE id = ? AND status = ?`,
    args: [
      sanitizeString(input.errorCode, 160) ?? "delivery_failed",
      Date.now(),
      input.id,
      currentStatus,
    ],
  });
  return (result.rowsAffected ?? (result as any).rowCount ?? 0) === 1;
}

export async function deactivateRemotePushRegistration(
  registrationId: string,
): Promise<boolean> {
  await ensureTables();
  const client = getDbExec();
  const now = Date.now();
  const result = await client.execute({
    sql: `UPDATE integration_remote_push_registrations
          SET status = 'inactive', updated_at = ?
          WHERE id = ? AND status = 'active'`,
    args: [now, registrationId],
  });
  await client.execute({
    sql: `UPDATE integration_remote_push_notifications
          SET status = 'failed', last_error = 'registration_inactive',
              updated_at = ?
          WHERE registration_id = ?
            AND status IN ('pending', 'sending', 'sent', 'checking')`,
    args: [now, registrationId],
  });
  return (result.rowsAffected ?? (result as any).rowCount ?? 0) === 1;
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
