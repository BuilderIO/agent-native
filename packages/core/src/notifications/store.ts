import { createHash, randomUUID } from "node:crypto";

import { getDbExec, safeJsonParse } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import { recordChange } from "../server/poll.js";
import type { Notification, NotificationSeverity } from "./types.js";

function bumpPoll(owner: string): void {
  recordChange({ source: "notifications", type: "change", key: owner });
}

let _initPromise: Promise<void> | undefined;

const DELIVERY_CLAIM_LEASE_MS = 2 * 60 * 1000;

function normalizeLimit(value: number | undefined, fallback = 50): number {
  if (!Number.isFinite(value) || value == null || value <= 0) return fallback;
  return Math.min(Math.floor(value), 200);
}

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const createSql = `
          CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            severity TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT,
            metadata TEXT,
            delivered_channels TEXT NOT NULL DEFAULT '[]',
            created_at BIGINT NOT NULL,
            read_at BIGINT
          )
        `;

      {
        await ensureTableExists("notifications", createSql);
        await ensureIndexExists(
          "idx_notifications_owner_unread",
          `CREATE INDEX IF NOT EXISTS idx_notifications_owner_unread ON notifications (owner, read_at)`,
        );
        await ensureTableExists(
          "notification_delivery_state",
          `CREATE TABLE IF NOT EXISTS notification_delivery_state (
            notification_id TEXT NOT NULL,
            delivery_key TEXT NOT NULL,
            state TEXT NOT NULL,
            claim_token TEXT,
            lease_expires_at BIGINT NOT NULL,
            completed_at BIGINT,
            PRIMARY KEY (notification_id, delivery_key)
          )`,
        );
        return;
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function parseRow(row: Record<string, unknown>): Notification {
  return {
    id: String(row.id),
    owner: String(row.owner),
    severity: String(row.severity) as NotificationSeverity,
    title: String(row.title),
    body: row.body == null ? undefined : String(row.body),
    metadata: row.metadata
      ? safeJsonParse<Record<string, unknown> | undefined>(
          row.metadata,
          undefined,
        )
      : undefined,
    deliveredChannels: safeJsonParse<string[]>(row.delivered_channels, []),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    readAt:
      row.read_at == null ? null : new Date(Number(row.read_at)).toISOString(),
  };
}

export interface InsertNotificationInput {
  owner: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  deliveredChannels?: string[];
  idempotencyKey?: string;
}

export async function insertNotification(
  input: InsertNotificationInput,
): Promise<Notification> {
  await ensureTable();
  const client = getDbExec();
  const id = input.idempotencyKey
    ? notificationIdForIdempotencyKey(input.owner, input.idempotencyKey)
    : randomUUID();
  const createdAt = Date.now();
  const inserted = await client.execute({
    sql: `INSERT INTO notifications
      (id, owner, severity, title, body, metadata, delivered_channels, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ${input.idempotencyKey ? "ON CONFLICT (id) DO NOTHING" : ""}`,
    args: [
      id,
      input.owner,
      input.severity,
      input.title,
      input.body ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      JSON.stringify(input.deliveredChannels ?? []),
      createdAt,
    ],
  });
  if (input.idempotencyKey && inserted.rowsAffected === 0) {
    const { rows } = await client.execute({
      sql: `SELECT * FROM notifications WHERE id = ? AND owner = ? LIMIT 1`,
      args: [id, input.owner],
    });
    if (!rows[0]) {
      throw new Error(
        "Idempotent notification insert conflicted without a row.",
      );
    }
    return parseRow(rows[0]);
  }
  bumpPoll(input.owner);
  return {
    id,
    owner: input.owner,
    severity: input.severity,
    title: input.title,
    body: input.body,
    metadata: input.metadata,
    deliveredChannels: input.deliveredChannels ?? [],
    createdAt: new Date(createdAt).toISOString(),
    readAt: null,
  };
}

export function notificationIdForIdempotencyKey(
  owner: string,
  idempotencyKey: string,
): string {
  return `idem_${createHash("sha256")
    .update(`${owner}\0${idempotencyKey}`)
    .digest("hex")}`;
}

function deliveryStateKey(key: string, kind: "channel" | "event"): string {
  return `${kind}:${key}`;
}

/**
 * Claims one idempotent notification side effect. A live claim prevents two
 * overlapping retries from delivering the same channel at once; a completed
 * claim is durable and suppresses later retries.
 */
export async function claimNotificationDelivery(
  notificationId: string,
  key: string,
  kind: "channel" | "event" = "channel",
): Promise<string | undefined> {
  await ensureTable();
  const client = getDbExec();
  const token = randomUUID();
  const now = Date.now();
  const stateKey = deliveryStateKey(key, kind);
  const inserted = await client.execute({
    sql: `INSERT INTO notification_delivery_state
      (notification_id, delivery_key, state, claim_token, lease_expires_at, completed_at)
      VALUES (?, ?, 'pending', ?, ?, NULL)
      ON CONFLICT (notification_id, delivery_key) DO NOTHING`,
    args: [notificationId, stateKey, token, now + DELIVERY_CLAIM_LEASE_MS],
  });
  if ((inserted.rowsAffected ?? 0) > 0) return token;

  const reclaimed = await client.execute({
    sql: `UPDATE notification_delivery_state
      SET state = 'pending', claim_token = ?, lease_expires_at = ?, completed_at = NULL
      WHERE notification_id = ? AND delivery_key = ?
        AND state = 'pending' AND lease_expires_at <= ?`,
    args: [token, now + DELIVERY_CLAIM_LEASE_MS, notificationId, stateKey, now],
  });
  if ((reclaimed.rowsAffected ?? 0) > 0) return token;

  // Some DbExec adapters omit rowsAffected for successful inserts. Verify the
  // token directly before treating this claim as unavailable.
  const { rows } = await client.execute({
    sql: `SELECT state, claim_token FROM notification_delivery_state
      WHERE notification_id = ? AND delivery_key = ? LIMIT 1`,
    args: [notificationId, stateKey],
  });
  return rows[0]?.state === "pending" && rows[0]?.claim_token === token
    ? token
    : undefined;
}

export async function completeNotificationDelivery(
  notificationId: string,
  key: string,
  claimToken: string,
  kind: "channel" | "event" = "channel",
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE notification_delivery_state
      SET state = 'delivered', claim_token = NULL, lease_expires_at = 0, completed_at = ?
      WHERE notification_id = ? AND delivery_key = ?
        AND state = 'pending' AND claim_token = ?`,
    args: [Date.now(), notificationId, deliveryStateKey(key, kind), claimToken],
  });
  if (result.rowsAffected === 0) {
    throw new Error("Notification delivery claim was lost before completion.");
  }
}

export async function releaseNotificationDelivery(
  notificationId: string,
  key: string,
  claimToken: string,
  kind: "channel" | "event" = "channel",
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM notification_delivery_state
      WHERE notification_id = ? AND delivery_key = ?
        AND state = 'pending' AND claim_token = ?`,
    args: [notificationId, deliveryStateKey(key, kind), claimToken],
  });
}

export async function listCompletedNotificationChannels(
  notificationId: string,
): Promise<string[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT delivery_key FROM notification_delivery_state
      WHERE notification_id = ? AND state = 'delivered'
        AND delivery_key LIKE 'channel:%'`,
    args: [notificationId],
  });
  return rows.map((row) => String(row.delivery_key).slice("channel:".length));
}

export async function updateDeliveredChannels(
  id: string,
  channels: string[],
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `UPDATE notifications SET delivered_channels = ? WHERE id = ?`,
    args: [JSON.stringify(channels), id],
  });
}

export async function addDeliveredChannel(
  id: string,
  channel: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows } = await client.execute({
      sql: `SELECT delivered_channels FROM notifications WHERE id = ? LIMIT 1`,
      args: [id],
    });
    const currentJson = String(rows[0]?.delivered_channels ?? "[]");
    const current = safeJsonParse<string[]>(currentJson, []);
    if (current.includes(channel)) return;
    const merged = [...current, channel];
    const updated = await client.execute({
      sql: `UPDATE notifications SET delivered_channels = ?
        WHERE id = ? AND delivered_channels = ?`,
      args: [JSON.stringify(merged), id, currentJson],
    });
    if ((updated.rowsAffected ?? 0) > 0) return;
  }
  throw new Error(
    `Could not record delivered notification channel "${channel}".`,
  );
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
  before?: string;
}

export async function listNotifications(
  owner: string,
  options: ListNotificationsOptions = {},
): Promise<Notification[]> {
  await ensureTable();
  const client = getDbExec();
  const limit = normalizeLimit(options.limit);
  const args: Array<string | number> = [owner];
  let where = `owner = ?`;
  if (options.unreadOnly) where += ` AND read_at IS NULL`;
  if (options.before) {
    where += ` AND created_at < ?`;
    args.push(new Date(options.before).getTime());
  }
  args.push(limit);
  const { rows } = await client.execute({
    sql: `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    args,
  });
  return rows.map((r) => parseRow(r as Record<string, unknown>));
}

export async function countUnread(owner: string): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) as c FROM notifications WHERE owner = ? AND read_at IS NULL`,
    args: [owner],
  });
  return Number(rows[0]?.c ?? 0);
}

export async function markNotificationRead(
  id: string,
  owner: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const res = await client.execute({
    sql: `UPDATE notifications SET read_at = ? WHERE id = ? AND owner = ? AND read_at IS NULL`,
    args: [now, id, owner],
  });
  const updated =
    (res as unknown as { rowsAffected?: number }).rowsAffected !== 0;
  if (updated) bumpPoll(owner);
  return updated;
}

export async function markAllNotificationsRead(owner: string): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const res = await client.execute({
    sql: `UPDATE notifications SET read_at = ? WHERE owner = ? AND read_at IS NULL`,
    args: [now, owner],
  });
  const count = (res as unknown as { rowsAffected?: number }).rowsAffected ?? 0;
  if (count > 0) bumpPoll(owner);
  return count;
}

export async function deleteNotification(
  id: string,
  owner: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const res = await client.execute({
    sql: `DELETE FROM notifications WHERE id = ? AND owner = ?`,
    args: [id, owner],
  });
  const deleted =
    (res as unknown as { rowsAffected?: number }).rowsAffected !== 0;
  if (deleted) bumpPoll(owner);
  return deleted;
}
