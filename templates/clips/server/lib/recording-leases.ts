import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";

// Leases live in `clips_backfill_leases`, a plain table. They must not live in
// `application_state`: every write there publishes a sync event to every open
// client, and a lease is claimed and released on every attempt.
const TABLE = "clips_backfill_leases";

export interface RecordingLease {
  key: string;
  token: string;
  expiresAt: number;
}

/** Take the lease if it is free or expired; null while someone else holds it. */
export async function claimLease(
  key: string,
  ttlMs: number,
): Promise<RecordingLease | null> {
  const token = randomUUID();
  const now = Date.now();
  const expiresAt = now + ttlMs;
  const result = await getDbExec().execute({
    sql: `INSERT INTO ${TABLE} (lease_key, holder, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (lease_key) DO UPDATE SET
        holder = excluded.holder,
        expires_at = excluded.expires_at
      WHERE ${TABLE}.expires_at <= $4
      RETURNING holder`,
    args: [key, token, expiresAt, now],
  });
  return result.rows[0]?.holder === token ? { key, token, expiresAt } : null;
}

/** Release only our own claim; a lease that expired and was retaken stays. */
export async function releaseLease(lease: RecordingLease): Promise<void> {
  await getDbExec().execute({
    sql: `DELETE FROM ${TABLE} WHERE lease_key = $1 AND holder = $2`,
    args: [lease.key, lease.token],
  });
}

/** Durable per-key attempt counter (keeps the count in `holder`). */
export async function countAttempt(key: string): Promise<number> {
  const result = await getDbExec().execute({
    sql: `INSERT INTO ${TABLE} (lease_key, holder, expires_at)
      VALUES ($1, '1', 0)
      ON CONFLICT (lease_key) DO UPDATE SET
        holder = (${TABLE}.holder::int + 1)::text
      RETURNING holder`,
    args: [key],
  });
  const attempts = Number(result.rows[0]?.holder);
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`Attempt counter for ${key} returned an unusable value`);
  }
  return attempts;
}
