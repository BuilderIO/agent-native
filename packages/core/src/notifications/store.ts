import { randomUUID } from "node:crypto";
import {
  getDbExec,
  intType,
  retryOnDdlRace,
  safeJsonParse,
} from "../db/client.js";
import { recordChange } from "../server/poll.js";
import type { Notification, NotificationSeverity } from "./types.js";

function bumpPoll(owner: string): void {
  recordChange({ source: "notifications", type: "change", key: owner });
}

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            severity TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT,
            metadata TEXT,
            delivered_channels TEXT NOT NULL DEFAULT '[]',
            created_at ${intType()} NOT NULL,
            read_at ${intType()}
          )
        `),
      );
      await retryOnDdlRace(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_notifications_owner_unread ON notifications (owner, read_at)`,
        ),
      );
    })().catch((err) => {
      // Reset on failure so a transient DB outage doesn't poison the cached
      // promise and reject every future insert/list call for the lifetime of
      // the process.
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
}

export async function insertNotification(
  input: InsertNotificationInput,
): Promise<Notification> {
  await ensureTable();
  const client = getDbExec();
  const id = randomUUID();
  const createdAt = Date.now();
  await client.execute({
    sql: `INSERT INTO notifications
      (id, owner, severity, title, body, metadata, delivered_channels, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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

export interface ListNotificationsOptions {
  /** When true, only return unread (read_at IS NULL). */
  unreadOnly?: boolean;
  /** Max rows to return. Default 50. */
  limit?: number;
  /** ISO timestamp cursor — returns rows with created_at < cursor. */
  before?: string;
}

export async function listNotifications(
  owner: string,
  options: ListNotificationsOptions = {},
): Promise<Notification[]> {
  await ensureTable();
  const client = getDbExec();
  const limit = Math.min(options.limit ?? 50, 200);
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
