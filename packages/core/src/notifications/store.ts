import { createHash, randomUUID } from "node:crypto";

import { getDbExec, safeJsonParse } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";
import { recordChange } from "../server/poll.js";
import type { Notification, NotificationSeverity } from "./types.js";

function bumpPoll(owner: string): void {
  recordChange({ source: "notifications", type: "change", key: owner });
}

const DELIVERY_CLAIM_LEASE_MS = 2 * 60 * 1000;

function normalizeLimit(value: number | undefined, fallback = 50): number {
  if (!Number.isFinite(value) || value == null || value <= 0) return fallback;
  return Math.min(Math.floor(value), 200);
}

export const notificationsStore = defineStore({
  id: "notifications",
  migrations: [
    {
      name: "baseline",
      run: async () => {
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
            read_at BIGINT,
            archived_at BIGINT
          )
        `;

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
      },
    },
    {
      // Inboxes that mirror a source app (an activity feed with an Archived
      // filter) need to keep a notification after the reader files it away.
      // Archiving is an additive nullable timestamp: nothing is dropped or
      // renamed, and a row that was never archived reads exactly as before.
      name: "notification-archive",
      run: async () => {
        await ensureColumnExists(
          "notifications",
          "archived_at",
          `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS archived_at BIGINT`,
        );
        await ensureIndexExists(
          "idx_notifications_owner_archived",
          `CREATE INDEX IF NOT EXISTS idx_notifications_owner_archived ON notifications (owner, archived_at)`,
        );
      },
    },
  ],
});

export function ensureTable(): Promise<void> {
  return notificationsStore.ready();
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
    archivedAt:
      row.archived_at == null
        ? null
        : new Date(Number(row.archived_at)).toISOString(),
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
    archivedAt: null,
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
 * Claims one idempotent notification side effect. Expired pending claims may
 * be retried. Event claims may also be replayed after their dispatch lease
 * expires because event subscribers deduplicate by the stable event ID;
 * channel deliveries remain non-replayable once dispatch starts.
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
        AND ((state = 'pending' AND lease_expires_at <= ?)
          OR (? = 'event' AND state = 'dispatching' AND lease_expires_at <= ?))`,
    args: [
      token,
      now + DELIVERY_CLAIM_LEASE_MS,
      notificationId,
      stateKey,
      now,
      kind,
      now,
    ],
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

export async function markNotificationDeliveryDispatching(
  notificationId: string,
  key: string,
  claimToken: string,
  kind: "channel" | "event" = "channel",
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE notification_delivery_state
      SET state = 'dispatching', lease_expires_at = ?
      WHERE notification_id = ? AND delivery_key = ?
        AND state = 'pending' AND claim_token = ?`,
    args: [
      kind === "event" ? Date.now() + DELIVERY_CLAIM_LEASE_MS : 0,
      notificationId,
      deliveryStateKey(key, kind),
      claimToken,
    ],
  });
  if (result.rowsAffected === 0) {
    throw new Error("Notification delivery claim was lost before dispatch.");
  }
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
        AND state = 'dispatching' AND claim_token = ?`,
    args: [Date.now(), notificationId, deliveryStateKey(key, kind), claimToken],
  });
  if (result.rowsAffected === 0) {
    throw new Error("Notification delivery claim was lost before completion.");
  }
}

export async function markNotificationDeliveryUncertain(
  notificationId: string,
  key: string,
  claimToken: string,
  kind: "channel" | "event" = "channel",
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `UPDATE notification_delivery_state
      SET state = 'uncertain', claim_token = NULL, lease_expires_at = 0, completed_at = ?
      WHERE notification_id = ? AND delivery_key = ?
        AND state = 'dispatching' AND claim_token = ?`,
    args: [Date.now(), notificationId, deliveryStateKey(key, kind), claimToken],
  });
  if (result.rowsAffected === 0) {
    throw new Error(
      "Notification delivery claim was lost before uncertainty was recorded.",
    );
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
        AND state IN ('pending', 'dispatching') AND claim_token = ?`,
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
  /** Only notifications the reader filed away (archived_at set). */
  archivedOnly?: boolean;
  /**
   * Include archived notifications in a read that does not ask for them. The
   * default leaves them out, which is what every inbox tab but "All workspace
   * updates" wants; a row that was never archived is unaffected.
   */
  includeArchived?: boolean;
  limit?: number;
  before?: string;
  /** Pair with before to continue within equal timestamps in descending ID order. */
  beforeId?: string;
}

export async function hasNotificationWithMetadata(
  owner: string,
  expected: Record<string, string | number | boolean>,
): Promise<boolean> {
  const entries = Object.entries(expected);
  if (entries.length === 0) return false;
  await ensureTable();
  const client = getDbExec();
  const predicates = entries
    .map(() => "metadata LIKE ? ESCAPE '\\'")
    .join(" AND ");
  const args = [
    owner,
    ...entries.map(([key, value]) => {
      const fragment = `${JSON.stringify(key)}:${JSON.stringify(value)}`;
      const escaped = fragment.replace(/[\\%_]/g, "\\$&");
      return `%${escaped}%`;
    }),
    25,
  ];
  const { rows } = await client.execute({
    sql: `SELECT metadata FROM notifications
      WHERE owner = ? AND ${predicates}
      ORDER BY created_at DESC LIMIT ?`,
    args,
  });
  return rows.some((row) => {
    const metadata = safeJsonParse<Record<string, unknown> | undefined>(
      row.metadata,
      undefined,
    );
    return (
      metadata !== undefined &&
      entries.every(([key, value]) => metadata[key] === value)
    );
  });
}

export async function listNotifications(
  owner: string,
  options: ListNotificationsOptions = {},
): Promise<Notification[]> {
  await ensureTable();
  const client = getDbExec();
  if (
    options.beforeId !== undefined &&
    (!options.before ||
      options.beforeId.length === 0 ||
      !Number.isFinite(new Date(options.before).getTime()))
  ) {
    throw new Error(
      "A notification beforeId cursor requires a valid before and a nonempty ID.",
    );
  }
  const limit = normalizeLimit(options.limit);
  const args: Array<string | number> = [owner];
  let where = `owner = ?`;
  if (options.archivedOnly) where += ` AND archived_at IS NOT NULL`;
  else if (!options.includeArchived) where += ` AND archived_at IS NULL`;
  if (options.unreadOnly) where += ` AND read_at IS NULL`;
  if (options.before) {
    const timestamp = new Date(options.before).getTime();
    if (options.beforeId) {
      where += ` AND (created_at < ? OR (created_at = ? AND id < ?))`;
      args.push(timestamp, timestamp, options.beforeId);
    } else {
      where += ` AND created_at < ?`;
      args.push(timestamp);
    }
  }
  args.push(limit);
  // raw-sql-ok: where is built only from literal clauses; every value is bound
  const { rows } = await client.execute({
    sql: `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    args,
  });
  return rows.map((r) => parseRow(r as Record<string, unknown>));
}

export async function countUnread(owner: string): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  // An archived notification was filed away, so it is not something the badge
  // should still be asking about.
  const { rows } = await client.execute({
    sql: `SELECT COUNT(*) as c FROM notifications WHERE owner = ? AND read_at IS NULL AND archived_at IS NULL`,
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

export type NotificationArchiveScope = "all" | "unread" | "read";

/**
 * File one notification away, or bring it back. The write is owner-scoped and
 * returns the new state so a caller can show what it wrote instead of assuming
 * it landed.
 */
export async function setNotificationArchived(
  id: string,
  owner: string,
  archived: boolean,
): Promise<Notification | null> {
  await ensureTable();
  const client = getDbExec();
  const now = archived ? Date.now() : null;
  const res = await client.execute({
    sql: `UPDATE notifications SET archived_at = ? WHERE id = ? AND owner = ?`,
    args: [now, id, owner],
  });
  if (res.rowsAffected === 0) return null;
  bumpPoll(owner);
  const { rows } = await client.execute({
    sql: `SELECT * FROM notifications WHERE id = ? AND owner = ? LIMIT 1`,
    args: [id, owner],
  });
  return rows[0] ? parseRow(rows[0]) : null;
}

/**
 * Archive every notification of one scope at once (the inbox menu's "Archive
 * all", "Archive unread" and "Archive read"). Rows already archived are left
 * alone, and the count is what this call actually changed.
 */
export async function archiveNotifications(
  owner: string,
  scope: NotificationArchiveScope,
): Promise<number> {
  await ensureTable();
  const client = getDbExec();
  const args: Array<string | number> = [Date.now(), owner];
  let where = `owner = ? AND archived_at IS NULL`;
  if (scope === "unread") where += ` AND read_at IS NULL`;
  if (scope === "read") where += ` AND read_at IS NOT NULL`;
  // raw-sql-ok: where is built only from literal clauses; every value is bound
  const res = await client.execute({
    sql: `UPDATE notifications SET archived_at = ? WHERE ${where}`,
    args,
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
