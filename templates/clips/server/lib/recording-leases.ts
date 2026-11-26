import {
  claimLease as claimTableLease,
  getDbExec,
  isLeaseHeld as isTableLeaseHeld,
  type Lease,
} from "@agent-native/core/db";

export {
  holdsLease,
  isLeaseLost,
  leaseHeld,
  releaseLease,
  renewLease,
  writeUnderLease,
} from "@agent-native/core/db";

// Leases live in `clips_backfill_leases`, a plain table. They must not live in
// `application_state`: every write there publishes a sync event to every open
// client, and a lease is claimed and released on every attempt.
const TABLE = "clips_backfill_leases";

export type RecordingLease = Lease;

/** Take the lease if it is free or expired; null while someone else holds it. */
export function claimLease(
  key: string,
  ttlMs: number,
): Promise<RecordingLease | null> {
  return claimTableLease(TABLE, key, ttlMs);
}

/** Whether anyone holds the lease right now; an expired lease is not held. */
export function isLeaseHeld(key: string): Promise<boolean> {
  return isTableLeaseHeld(TABLE, key);
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
