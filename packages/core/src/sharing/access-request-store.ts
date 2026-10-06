import { randomBytes } from "node:crypto";

import { getDbExec, type DbExec } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import type { ShareRole } from "./schema.js";

/**
 * Requests from signed-in people who hold a link to a resource they can't
 * open. One row per resource and requester: asking again reopens the same row
 * with a new generation, so owners are never notified twice for one ask.
 */

export type AccessRequestState = "pending" | "approved" | "declined";

export interface AccessRequestRow {
  id: string;
  resourceType: string;
  resourceId: string;
  requesterEmail: string;
  requesterName: string | null;
  /** The resource owner when the request was made, for per-owner limits. */
  ownerEmail: string;
  note: string | null;
  state: AccessRequestState;
  /** Increments each time a closed request is asked again. */
  generation: number;
  /** When this generation was asked, in epoch ms. */
  requestedAt: number;
  /** When the requester first asked for this resource, in epoch ms. */
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  grantedRole: ShareRole | null;
  /** Whether anyone was told about this generation. */
  delivered: boolean;
}

const TABLE = "resource_access_requests";

let _initPromise: Promise<void> | undefined;

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      await ensureTableExists(
        TABLE,
        `CREATE TABLE IF NOT EXISTS ${TABLE} (
          id TEXT PRIMARY KEY,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          requester_email TEXT NOT NULL,
          requester_name TEXT,
          owner_email TEXT NOT NULL,
          note TEXT,
          state TEXT NOT NULL,
          generation INTEGER NOT NULL DEFAULT 1,
          requested_at BIGINT NOT NULL,
          created_at BIGINT NOT NULL,
          decided_by TEXT,
          decided_at BIGINT,
          granted_role TEXT,
          delivery TEXT
        )`,
      );
      await ensureIndexExists(
        "idx_resource_access_requests_requester",
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_access_requests_requester ON ${TABLE} (resource_type, resource_id, requester_email)`,
      );
      await ensureIndexExists(
        "idx_resource_access_requests_requester_recent",
        `CREATE INDEX IF NOT EXISTS idx_resource_access_requests_requester_recent ON ${TABLE} (requester_email, requested_at)`,
      );
      await ensureIndexExists(
        "idx_resource_access_requests_owner_recent",
        `CREATE INDEX IF NOT EXISTS idx_resource_access_requests_owner_recent ON ${TABLE} (owner_email, requested_at)`,
      );
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

function optionalString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function optionalNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function parseRow(row: Record<string, unknown>): AccessRequestRow {
  return {
    id: String(row.id),
    resourceType: String(row.resource_type),
    resourceId: String(row.resource_id),
    requesterEmail: String(row.requester_email),
    requesterName: optionalString(row.requester_name),
    ownerEmail: String(row.owner_email),
    note: optionalString(row.note),
    state: String(row.state) as AccessRequestState,
    generation: Number(row.generation),
    requestedAt: Number(row.requested_at),
    createdAt: Number(row.created_at),
    decidedBy: optionalString(row.decided_by),
    decidedAt: optionalNumber(row.decided_at),
    grantedRole: optionalString(row.granted_role) as ShareRole | null,
    delivered: row.delivery != null,
  };
}

function newRequestId(): string {
  return randomBytes(12).toString("base64url");
}

export async function getAccessRequest(
  id: string,
): Promise<AccessRequestRow | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? parseRow(rows[0]) : null;
}

export async function findAccessRequest(
  resourceType: string,
  resourceId: string,
  requesterEmail: string,
): Promise<AccessRequestRow | null> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE resource_type = ? AND resource_id = ? AND requester_email = ? LIMIT 1`,
    args: [resourceType, resourceId, requesterEmail],
  });
  return rows[0] ? parseRow(rows[0]) : null;
}

export async function listPendingAccessRequests(
  resourceType: string,
  resourceId: string,
  limit: number,
): Promise<AccessRequestRow[]> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT * FROM ${TABLE} WHERE resource_type = ? AND resource_id = ? AND state = 'pending' ORDER BY requested_at DESC LIMIT ?`,
    args: [resourceType, resourceId, limit],
  });
  return rows.map(parseRow);
}

/**
 * How many requests were asked since `since` by one requester or against one
 * owner, and when the oldest of them was asked.
 */
export async function countRecentAccessRequests(
  by: { requesterEmail: string } | { ownerEmail: string },
  since: number,
): Promise<{ count: number; oldestAt: number | null }> {
  await ensureTable();
  const [column, value] =
    "requesterEmail" in by
      ? ["requester_email", by.requesterEmail]
      : ["owner_email", by.ownerEmail];
  const { rows } = await getDbExec().execute({
    sql: `SELECT COUNT(*) AS n, MIN(requested_at) AS oldest FROM ${TABLE} WHERE ${column} = ? AND requested_at > ?`,
    args: [value, since],
  });
  return {
    count: Number(rows[0]?.n ?? 0),
    oldestAt: optionalNumber(rows[0]?.oldest),
  };
}

export interface OpenAccessRequestInput {
  resourceType: string;
  resourceId: string;
  requesterEmail: string;
  requesterName: string | null;
  ownerEmail: string;
  note: string | null;
  now: number;
  /** A request declined after this time stays closed instead of reopening. */
  declinedCooldownStart: number;
  /**
   * A pending request nobody was told about, asked before this time, is
   * claimed to be sent again; one asked later may still be sending.
   */
  sendWindowStart: number;
}

/**
 * Opens a request, or reopens a closed one as a new generation. A pending
 * request whose send was cut off before anyone was told is claimed again in
 * its own generation, so recipients the cut-off send reached get nothing new.
 * Returns `opened: false` with the existing row when a request is already
 * pending, or was declined too recently to ask again, so the caller sends
 * nothing.
 */
export async function openAccessRequest(
  input: OpenAccessRequestInput,
): Promise<{ request: AccessRequestRow; opened: boolean }> {
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `INSERT INTO ${TABLE} (
        id, resource_type, resource_id, requester_email, requester_name,
        owner_email, note, state, generation, requested_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)
      ON CONFLICT (resource_type, resource_id, requester_email) DO UPDATE SET
        requester_name = excluded.requester_name,
        owner_email = excluded.owner_email,
        note = excluded.note,
        state = 'pending',
        generation = ${TABLE}.generation + 1,
        requested_at = excluded.requested_at,
        decided_by = NULL,
        decided_at = NULL,
        granted_role = NULL,
        delivery = NULL
      WHERE ${TABLE}.state = 'approved'
        OR (${TABLE}.state = 'declined' AND ${TABLE}.decided_at <= ?)
      RETURNING *`,
    args: [
      newRequestId(),
      input.resourceType,
      input.resourceId,
      input.requesterEmail,
      input.requesterName,
      input.ownerEmail,
      input.note,
      input.now,
      input.now,
      input.declinedCooldownStart,
    ],
  });
  if (rows[0]) return { request: parseRow(rows[0]), opened: true };
  // Moving requested_at makes the claim one ask's alone.
  const { rows: unsent } = await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET requested_at = ?
      WHERE resource_type = ? AND resource_id = ? AND requester_email = ?
        AND state = 'pending' AND delivery IS NULL AND requested_at <= ?
      RETURNING *`,
    args: [
      input.now,
      input.resourceType,
      input.resourceId,
      input.requesterEmail,
      input.sendWindowStart,
    ],
  });
  if (unsent[0]) return { request: parseRow(unsent[0]), opened: true };
  const existing = await findAccessRequest(
    input.resourceType,
    input.resourceId,
    input.requesterEmail,
  );
  if (!existing) throw new Error("Access request conflict could not be read.");
  return { request: existing, opened: false };
}

/**
 * Withdraws a request that was just opened but reached nobody, so asking
 * again isn't blocked and doesn't count toward the limits. Only the ask that
 * opened or claimed it at `requestedAt` can: one another ask has claimed
 * since, or already delivered, stays.
 */
export async function deleteAccessRequest(
  id: string,
  generation: number,
  requestedAt: number,
): Promise<void> {
  await ensureTable();
  await getDbExec().execute({
    sql: `DELETE FROM ${TABLE} WHERE id = ? AND generation = ? AND requested_at = ? AND state = 'pending' AND delivery IS NULL`,
    args: [id, generation, requestedAt],
  });
}

export async function recordAccessRequestDelivery(
  id: string,
  generation: number,
  delivery: Record<string, unknown>,
): Promise<void> {
  await ensureTable();
  await getDbExec().execute({
    sql: `UPDATE ${TABLE} SET delivery = ? WHERE id = ? AND generation = ?`,
    args: [JSON.stringify(delivery), id, generation],
  });
}

/**
 * Closes a pending request. Only a request still pending in the generation
 * the decider saw changes, so a decision on a stale page can't close a newer
 * ask and two people can't both decide one. Pass the transaction a grant runs
 * in so both commit together.
 */
export async function decideAccessRequest(
  input: {
    id: string;
    generation: number;
    state: Exclude<AccessRequestState, "pending">;
    decidedBy: string;
    grantedRole: ShareRole | null;
    now: number;
  },
  exec: DbExec = getDbExec(),
): Promise<AccessRequestRow | null> {
  await ensureTable();
  const { rows } = await exec.execute({
    sql: `UPDATE ${TABLE} SET state = ?, decided_by = ?, decided_at = ?, granted_role = ?
      WHERE id = ? AND generation = ? AND state = 'pending'
      RETURNING *`,
    args: [
      input.state,
      input.decidedBy,
      input.now,
      input.grantedRole,
      input.id,
      input.generation,
    ],
  });
  return rows[0] ? parseRow(rows[0]) : null;
}
