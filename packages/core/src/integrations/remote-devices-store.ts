import { getDbExec, intType, retryOnDdlRace } from "../db/client.js";
import type { PublicRemoteDevice, RemoteDevice } from "./remote-types.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE TABLE IF NOT EXISTS integration_remote_devices (
            id TEXT PRIMARY KEY,
            owner_email TEXT NOT NULL,
            org_id TEXT,
            label TEXT NOT NULL,
            device_token_hash TEXT NOT NULL,
            last_seen_at ${intType()},
            status TEXT NOT NULL,
            created_at ${intType()} NOT NULL,
            updated_at ${intType()} NOT NULL
          )
        `),
      );
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
    })();
  }
  return _initPromise;
}

function rowToDevice(row: Record<string, unknown>): RemoteDevice {
  return {
    id: row.id as string,
    ownerEmail: row.owner_email as string,
    orgId: (row.org_id as string | null) ?? null,
    label: row.label as string,
    deviceTokenHash: row.device_token_hash as string,
    lastSeenAt:
      row.last_seen_at == null ? null : Number(row.last_seen_at as number),
    status: row.status as RemoteDevice["status"],
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
    lastSeenAt: device.lastSeenAt,
    status: device.status,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

export async function createRemoteDevice(input: {
  ownerEmail: string;
  orgId?: string | null;
  label: string;
}): Promise<{ device: RemoteDevice; token: string }> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const id = `remote-device-${now}-${randomHex(8)}`;
  const token = `anr_${randomHex(32)}`;
  const tokenHash = await hashRemoteDeviceToken(token);

  await client.execute({
    sql: `INSERT INTO integration_remote_devices
      (id, owner_email, org_id, label, device_token_hash, last_seen_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.ownerEmail,
      input.orgId ?? null,
      input.label.trim() || "Remote device",
      tokenHash,
      now,
      "active",
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
  limit?: number;
}): Promise<RemoteDevice[]> {
  await ensureTable();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  if (!Object.prototype.hasOwnProperty.call(input, "orgId")) {
    const { rows } = await getDbExec().execute({
      sql: `SELECT * FROM integration_remote_devices
            WHERE owner_email = ?
            ORDER BY COALESCE(last_seen_at, updated_at) DESC
            LIMIT ?`,
      args: [input.ownerEmail, limit],
    });
    return rows.map((row) => rowToDevice(row as Record<string, unknown>));
  }
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM integration_remote_devices
          WHERE owner_email = ?
            AND ((org_id IS NULL AND ? IS NULL) OR org_id = ?)
          ORDER BY COALESCE(last_seen_at, updated_at) DESC
          LIMIT ?`,
    args: [input.ownerEmail, input.orgId ?? null, input.orgId ?? null, limit],
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

export async function hashRemoteDeviceToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
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
