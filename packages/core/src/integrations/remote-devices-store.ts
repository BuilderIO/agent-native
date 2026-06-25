import {
  getDbExec,
  intType,
  isPostgres,
  retryOnDdlRace,
} from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import type { PublicRemoteDevice, RemoteDevice } from "./remote-types.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS integration_remote_devices (
          id TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          label TEXT NOT NULL,
          platform TEXT,
          app_version TEXT,
          host_name TEXT,
          metadata_json TEXT,
          device_token_hash TEXT NOT NULL,
          last_seen_at ${intType()},
          status TEXT NOT NULL,
          revoked_at ${intType()},
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL
        )
      `;

      if (isPostgres()) {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("integration_remote_devices", createSql);
        await ensureColumnExists(
          "integration_remote_devices",
          "platform",
          `ALTER TABLE integration_remote_devices ADD COLUMN IF NOT EXISTS platform TEXT`,
        );
        await ensureColumnExists(
          "integration_remote_devices",
          "app_version",
          `ALTER TABLE integration_remote_devices ADD COLUMN IF NOT EXISTS app_version TEXT`,
        );
        await ensureColumnExists(
          "integration_remote_devices",
          "host_name",
          `ALTER TABLE integration_remote_devices ADD COLUMN IF NOT EXISTS host_name TEXT`,
        );
        await ensureColumnExists(
          "integration_remote_devices",
          "metadata_json",
          `ALTER TABLE integration_remote_devices ADD COLUMN IF NOT EXISTS metadata_json TEXT`,
        );
        await ensureColumnExists(
          "integration_remote_devices",
          "revoked_at",
          `ALTER TABLE integration_remote_devices ADD COLUMN IF NOT EXISTS revoked_at ${intType()}`,
        );
        await ensureIndexExists(
          "idx_remote_devices_token_hash",
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_devices_token_hash ON integration_remote_devices(device_token_hash)`,
        );
        await ensureIndexExists(
          "idx_remote_devices_owner",
          `CREATE INDEX IF NOT EXISTS idx_remote_devices_owner ON integration_remote_devices(owner_email, org_id)`,
        );
        return;
      }
      // SQLite (local dev): keep existing behavior verbatim
      await retryOnDdlRace(() => client.execute(createSql));
      await addColumnIfMissing("platform", "TEXT");
      await addColumnIfMissing("app_version", "TEXT");
      await addColumnIfMissing("host_name", "TEXT");
      await addColumnIfMissing("metadata_json", "TEXT");
      await addColumnIfMissing("revoked_at", intType());
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_devices_token_hash ON integration_remote_devices(device_token_hash)`,
        ),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_remote_devices_owner ON integration_remote_devices(owner_email, org_id)`,
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

async function addColumnIfMissing(
  name: string,
  definition: string,
): Promise<void> {
  const sql = isPostgres()
    ? `ALTER TABLE integration_remote_devices ADD COLUMN IF NOT EXISTS ${name} ${definition}`
    : `ALTER TABLE integration_remote_devices ADD COLUMN ${name} ${definition}`;
  try {
    await retryOnDdlRace(() => getDbExec().execute(sql));
  } catch (err) {
    if (isDuplicateColumnError(err)) return;
    throw err;
  }
}

function isDuplicateColumnError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? "");
  const message = String((err as { message?: unknown })?.message ?? err)
    .toLowerCase()
    .trim();
  return (
    code === "42701" ||
    message.includes("duplicate column") ||
    message.includes("already exists")
  );
}

function rowToDevice(row: Record<string, unknown>): RemoteDevice {
  return {
    id: row.id as string,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    label: row.label as string,
    platform: (row.platform as string | null) ?? null,
    appVersion: (row.app_version as string | null) ?? null,
    hostName: (row.host_name as string | null) ?? null,
    metadata: parseJson(row.metadata_json, null) as Record<
      string,
      unknown
    > | null,
    deviceTokenHash: row.device_token_hash as string,
    lastSeenAt:
      row.last_seen_at == null ? null : Number(row.last_seen_at as number),
    status: row.status as RemoteDevice["status"],
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at as number),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export function toPublicRemoteDevice(device: RemoteDevice): PublicRemoteDevice {
  return {
    id: device.id,
    ownerEmail: device.ownerEmail,
    orgId: device.orgId,
    label: device.label,
    platform: device.platform,
    appVersion: device.appVersion,
    hostName: device.hostName,
    metadata: device.metadata,
    lastSeenAt: device.lastSeenAt,
    status: device.status,
    revokedAt: device.revokedAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

export async function createRemoteDevice(input: {
  ownerEmail: string;
  orgId?: string | null;
  label: string;
  platform?: string | null;
  appVersion?: string | null;
  hostName?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{ device: RemoteDevice; token: string }> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const id = `remote-device-${now}-${randomHex(8)}`;
  const token = `anr_${randomHex(32)}`;
  const tokenHash = await hashRemoteDeviceToken(token);

  await client.execute({
    sql: `INSERT INTO integration_remote_devices
      (id, owner_email, org_id, label, platform, app_version, host_name, metadata_json,
       device_token_hash, last_seen_at, status, revoked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.ownerEmail,
      input.orgId ?? null,
      input.label.trim() || "Remote device",
      sanitizeOptionalString(input.platform, 80),
      sanitizeOptionalString(input.appVersion, 120),
      sanitizeOptionalString(input.hostName, 200),
      input.metadata ? JSON.stringify(input.metadata) : null,
      tokenHash,
      now,
      "active",
      null,
      now,
      now,
    ],
  });

  const device = await getRemoteDevice(id);
  if (!device) throw new Error("remote device insert failed");
  return { device, token };
}

export async function getRemoteDevice(
  id: string,
): Promise<RemoteDevice | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_devices WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? rowToDevice(rows[0] as Record<string, unknown>) : null;
}

export async function getRemoteDeviceForOwner(input: {
  id: string;
  ownerEmail: string;
  orgId?: string | null;
}): Promise<RemoteDevice | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_devices
          WHERE id = ?
            AND owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
          LIMIT 1`,
    args: [
      input.id,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
    ],
  });
  return rows[0] ? rowToDevice(rows[0] as Record<string, unknown>) : null;
}

export async function listRemoteDevicesForOwner(input: {
  ownerEmail: string;
  orgId?: string | null;
  status?: RemoteDevice["status"];
  limit?: number;
}): Promise<RemoteDevice[]> {
  await ensureTable();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const statusClause = input.status ? " AND status = ?" : "";
  if (!Object.prototype.hasOwnProperty.call(input, "orgId")) {
    const args: Array<string | number> = [input.ownerEmail];
    if (input.status) args.push(input.status);
    args.push(limit);
    const { rows } = await getDbExec().execute({
      sql: `SELECT * FROM integration_remote_devices
            WHERE owner_email = ?${statusClause}
            ORDER BY COALESCE(last_seen_at, updated_at) DESC
            LIMIT ?`,
      args,
    });
    return rows.map((row) => rowToDevice(row as Record<string, unknown>));
  }
  const args: Array<string | number | null> = [
    input.ownerEmail,
    input.orgId ?? null,
    input.orgId ?? null,
  ];
  if (input.status) args.push(input.status);
  args.push(limit);
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_devices
          WHERE owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)${statusClause}
          ORDER BY COALESCE(last_seen_at, updated_at) DESC
          LIMIT ?`,
    args,
  });
  return rows.map((row) => rowToDevice(row as Record<string, unknown>));
}

export async function authenticateRemoteDeviceToken(
  rawToken: string | null | undefined,
): Promise<RemoteDevice | null> {
  if (!rawToken) return null;
  await ensureTable();
  const tokenHash = await hashRemoteDeviceToken(rawToken);
  const now = Date.now();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM integration_remote_devices
          WHERE device_token_hash = ? AND status = 'active'
          LIMIT 1`,
    args: [tokenHash],
  });
  if (!rows[0]) return null;
  const device = rowToDevice(rows[0] as Record<string, unknown>);
  await client.execute({
    sql: `UPDATE integration_remote_devices
          SET last_seen_at = ?, updated_at = ?
          WHERE id = ?`,
    args: [now, now, device.id],
  });
  return { ...device, lastSeenAt: now, updatedAt: now };
}

export async function updateRemoteDeviceDetails(input: {
  id: string;
  label?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  hostName?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<RemoteDevice | null> {
  await ensureTable();
  const now = Date.now();
  const updates: string[] = [];
  const args: Array<string | number | null> = [];
  if (input.label !== undefined) {
    updates.push("label = ?");
    args.push(sanitizeOptionalString(input.label, 200) ?? "Remote device");
  }
  if (input.platform !== undefined) {
    updates.push("platform = ?");
    args.push(sanitizeOptionalString(input.platform, 80));
  }
  if (input.appVersion !== undefined) {
    updates.push("app_version = ?");
    args.push(sanitizeOptionalString(input.appVersion, 120));
  }
  if (input.hostName !== undefined) {
    updates.push("host_name = ?");
    args.push(sanitizeOptionalString(input.hostName, 200));
  }
  if (input.metadata !== undefined) {
    updates.push("metadata_json = ?");
    args.push(input.metadata ? JSON.stringify(input.metadata) : null);
  }
  if (updates.length === 0) return getRemoteDevice(input.id);

  updates.push("updated_at = ?");
  args.push(now, input.id);
  await getDbExec().execute({
    sql: `UPDATE integration_remote_devices
          SET ${updates.join(", ")}
          WHERE id = ? AND status = 'active'`,
    args,
  });
  return getRemoteDevice(input.id);
}

export async function revokeRemoteDeviceForOwner(input: {
  id: string;
  ownerEmail: string;
  orgId?: string | null;
}): Promise<RemoteDevice | null> {
  await ensureTable();
  const now = Date.now();
  await getDbExec().execute({
    sql: `UPDATE integration_remote_devices
          SET status = 'inactive',
              revoked_at = COALESCE(revoked_at, ?),
              updated_at = ?
          WHERE id = ?
            AND owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)`,
    args: [
      now,
      now,
      input.id,
      input.ownerEmail,
      input.orgId ?? null,
      input.orgId ?? null,
    ],
  });
  return getRemoteDeviceForOwner(input);
}

export async function unregisterRemoteDevice(id: string): Promise<boolean> {
  await ensureTable();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE integration_remote_devices
          SET status = 'inactive',
              revoked_at = COALESCE(revoked_at, ?),
              updated_at = ?
          WHERE id = ? AND status = 'active'`,
    args: [now, now, id],
  });
  return (result.rowsAffected ?? (result as any).rowCount ?? 0) > 0;
}

export async function hashRemoteDeviceToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

function sanitizeOptionalString(
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

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
