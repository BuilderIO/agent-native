// Database pressure — the three signals that precede an outage, measured from
// inside the app that owns the database.
//
// The analytics app degraded for hours on 2026-08-06 before it fell over, and
// every check we had said UP until the moment it said DOWN. What was actually
// true, and visible in `pg_stat_activity` the whole time:
//
//   - 11-20 connections stuck `idle in transaction` up to 283s, left behind by
//     serverless workers killed mid-transaction. They hold locks; nothing
//     reaped them.
//   - `SELECT 1` drifting from ~0.2s to 6s as those locks accumulated.
//   - 47-56 concurrent copies of one unprojected query, each dragging a JSON
//     blob per row.
//
// None of that is "down". All of it is the hour before down. A monitor that
// only distinguishes 200 from 500 cannot see any of it.
//
// This lives in core rather than in a workstation script because the numbers
// require a database credential, and the app already has its own. Reading them
// here means the scheduled fleet audit needs no production credentials at all.
// `scripts/chat-health.mjs` measures the same three signals locally against
// every app at once; `db-pressure.spec.ts` pins the two threshold sets equal.

/** Counters taken in one shot from `pg_stat_activity`. */
export interface DbPressureCounters {
  connections: number;
  idleInTxn: number;
  oldestIdleTxnS: number;
  maxSameQuery: number;
  /** Round-trip of this statement on an already-open connection. */
  trivialQueryMs: number;
}

/**
 * Measured counters, or an explicit reason they could not be taken.
 *
 * A monitor must never read "not measured" as "healthy", so the two are
 * different shapes rather than an empty warning list.
 */
export type DbPressure =
  | ({ measured: true; warnings: string[] } & DbPressureCounters)
  | { measured: false; reason: string };

// Thresholds set from that outage, not intuition. Healthy analytics reads
// 0 / 128ms / 1; at the point it went down it read 20 / 6000ms / 56.
export const MAX_IDLE_TXN_AGE_S = 60;
export const MAX_TRIVIAL_QUERY_MS = 1_000;
export const MAX_SAME_QUERY_CONCURRENCY = 10;

/**
 * A hung probe must not hang the health route — that is the defect that took
 * the docs site permanently cold. Short because this runs on a connection the
 * liveness probe just proved is answering.
 */
const PRESSURE_PROBE_DEADLINE_MS = 3_000;

export const DB_PRESSURE_SQL = `
SELECT
  count(*)::int AS connections,
  count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_txn,
  coalesce(round(max(extract(epoch from (now() - state_change)))
    FILTER (WHERE state = 'idle in transaction'))::int, 0) AS oldest_idle_txn_s,
  coalesce((
    SELECT max(c) FROM (
      SELECT count(*)::int AS c FROM pg_stat_activity
      WHERE state = 'active' AND query <> '' GROUP BY left(query, 60)
    ) q
  ), 0)::int AS max_same_query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()`;

/** Reasons this database looks pressured, or [] when it looks fine. */
export function dbPressureWarnings(p: DbPressureCounters): string[] {
  const out: string[] = [];
  if (p.idleInTxn > 0 && p.oldestIdleTxnS > MAX_IDLE_TXN_AGE_S) {
    out.push(
      `${p.idleInTxn} idle-in-transaction (oldest ${p.oldestIdleTxnS}s) — workers killed mid-transaction still holding locks`,
    );
  }
  if (p.trivialQueryMs > MAX_TRIVIAL_QUERY_MS) {
    out.push(
      `trivial query took ${p.trivialQueryMs}ms — the database itself is slow, not the app`,
    );
  }
  if (p.maxSameQuery >= MAX_SAME_QUERY_CONCURRENCY) {
    out.push(
      `${p.maxSameQuery} concurrent copies of one query — a hot path is stampeding`,
    );
  }
  return out;
}

function readCount(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Some drivers hand back bigint-ish columns as strings.
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Read the pressure counters. Postgres-only: `pg_stat_activity` does not exist
 * on SQLite/libSQL/D1, and a dialect that cannot answer reports `measured:
 * false` rather than a clean-looking zero.
 */
export async function probeDbPressure(
  exec: { execute: (sql: string) => Promise<unknown> },
  dialect: string,
): Promise<DbPressure> {
  if (dialect !== "postgres") {
    return {
      measured: false,
      reason: `dialect ${dialect} has no pg_stat_activity`,
    };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("pressure probe deadline")),
        PRESSURE_PROBE_DEADLINE_MS,
      );
    });
    const result = (await Promise.race([
      exec.execute(DB_PRESSURE_SQL),
      deadline,
    ])) as { rows?: unknown[] } | undefined;
    const trivialQueryMs = Date.now() - startedAt;
    const row = result?.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      return { measured: false, reason: "pressure query returned no rows" };
    }
    const counters: DbPressureCounters = {
      connections: readCount(row, "connections") ?? -1,
      idleInTxn: readCount(row, "idle_in_txn") ?? -1,
      oldestIdleTxnS: readCount(row, "oldest_idle_txn_s") ?? -1,
      maxSameQuery: readCount(row, "max_same_query") ?? -1,
      trivialQueryMs,
    };
    if (Object.values(counters).some((n) => n < 0)) {
      return {
        measured: false,
        reason: "pressure query returned unreadable counters",
      };
    }
    return {
      measured: true,
      ...counters,
      warnings: dbPressureWarnings(counters),
    };
  } catch (err) {
    return {
      measured: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
