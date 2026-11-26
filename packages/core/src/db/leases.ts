import { randomUUID } from "node:crypto";

import { sql as drizzleSql, type SQL } from "drizzle-orm";

import { getDbExec, type DbExec } from "./client.js";
import { sql, type SqlFragment } from "./sql.js";

/**
 * Leases for long jobs that must run alone: a render, a build, a worker. The
 * app owns the table, with `lease_key` (primary key), `holder` and
 * `expires_at` (epoch milliseconds). A lease can expire and be taken over, so
 * a holder's writes go through {@link writeUnderLease}: once its lease has
 * run out, they are refused.
 */
export interface Lease {
  readonly table: string;
  readonly key: string;
  readonly token: string;
  readonly expiresAt: number;
}

export interface LeaseOptions {
  /** The executor to use, such as a transaction's. Defaults to `getDbExec()`. */
  exec?: DbExec;
}

export class LeaseLostError extends Error {
  readonly code = "lease_lost";

  constructor(readonly lease: Lease) {
    super(`The lease on ${lease.key} ran out, so this write was refused.`);
    this.name = "LeaseLostError";
  }
}

export function isLeaseLost(error: unknown): error is LeaseLostError {
  return (
    error instanceof LeaseLostError ||
    (error instanceof Error &&
      (error as { code?: unknown }).code === "lease_lost")
  );
}

function execOf(options: LeaseOptions | undefined): DbExec {
  return options?.exec ?? getDbExec();
}

/** Take the lease if it is free or expired; null while someone else holds it. */
export async function claimLease(
  table: string,
  key: string,
  ttlMs: number,
  options?: LeaseOptions,
): Promise<Lease | null> {
  const token = randomUUID();
  const now = Date.now();
  const expiresAt = now + ttlMs;
  const leases = sql.ident(table);
  const result = await execOf(options).execute(
    sql`INSERT INTO ${leases} (lease_key, holder, expires_at)
      VALUES (${sql.value(key)}, ${sql.value(token)}, ${sql.value(expiresAt)})
      ON CONFLICT (lease_key) DO UPDATE SET
        holder = excluded.holder,
        expires_at = excluded.expires_at
      WHERE ${leases}.expires_at <= ${sql.value(now)}
      RETURNING holder`,
  );
  return result.rows[0]?.holder === token
    ? { table, key, token, expiresAt }
    : null;
}

/** Release only our own claim; a lease that expired and was retaken stays. */
export async function releaseLease(
  lease: Lease,
  options?: LeaseOptions,
): Promise<void> {
  await execOf(options).execute(
    sql`DELETE FROM ${sql.ident(lease.table)}
      WHERE lease_key = ${sql.value(lease.key)}
        AND holder = ${sql.value(lease.token)}`,
  );
}

/** Push our live lease's expiry out. False once it has run out. */
export async function renewLease(
  lease: Lease,
  ttlMs: number,
  options?: LeaseOptions,
): Promise<boolean> {
  const now = Date.now();
  const result = await execOf(options).execute(
    sql`UPDATE ${sql.ident(lease.table)}
      SET expires_at = ${sql.value(now + ttlMs)}
      WHERE lease_key = ${sql.value(lease.key)}
        AND holder = ${sql.value(lease.token)}
        AND expires_at > ${sql.value(now)}
      RETURNING holder`,
  );
  return result.rows.length > 0;
}

/** Whether anyone holds the lease right now; an expired lease is not held. */
export async function isLeaseHeld(
  table: string,
  key: string,
  options?: LeaseOptions,
): Promise<boolean> {
  const result = await execOf(options).execute(
    sql`SELECT 1 FROM ${sql.ident(table)}
      WHERE lease_key = ${sql.value(key)}
        AND expires_at > ${sql.value(Date.now())}`,
  );
  return result.rows.length > 0;
}

/** Whether this lease is still ours and live. */
export async function holdsLease(
  lease: Lease,
  options?: LeaseOptions,
): Promise<boolean> {
  const result = await execOf(options).execute(
    sql`SELECT 1 FROM ${sql.ident(lease.table)}
      WHERE lease_key = ${sql.value(lease.key)}
        AND holder = ${sql.value(lease.token)}
        AND expires_at > ${sql.value(Date.now())}`,
  );
  return result.rows.length > 0;
}

/**
 * A Drizzle condition that is true while `lease` is ours and live. It locks
 * the lease row until the statement's transaction ends, so a claim waits for
 * the write instead of slipping in under it.
 */
export function leaseHeld(lease: Lease): SQL {
  return drizzleSql`EXISTS (SELECT 1 FROM ${drizzleSql.identifier(lease.table)}
    WHERE lease_key = ${lease.key}
      AND holder = ${lease.token}
      AND expires_at > ${Date.now()}
    FOR SHARE)`;
}

/** {@link leaseHeld} for a statement built with core's `sql` tag. */
export function leaseHeldSql(lease: Lease): SqlFragment {
  return sql`EXISTS (SELECT 1 FROM ${sql.ident(lease.table)}
    WHERE lease_key = ${sql.value(lease.key)}
      AND holder = ${sql.value(lease.token)}
      AND expires_at > ${sql.value(Date.now())}
    FOR SHARE)`;
}

/**
 * Runs one write that ANDs `held` into its WHERE and returns the rows it
 * changed. When it changed nothing because the lease ran out, it throws
 * {@link LeaseLostError}; when the lease is still ours, the empty result means
 * the write's own conditions did not match.
 */
export async function writeUnderLease<Row>(
  lease: Lease,
  write: (held: SQL) => Promise<Row[]>,
  options?: LeaseOptions,
): Promise<Row[]> {
  const rows = await write(leaseHeld(lease));
  if (rows.length === 0 && !(await holdsLease(lease, options))) {
    throw new LeaseLostError(lease);
  }
  return rows;
}
