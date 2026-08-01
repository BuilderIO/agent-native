import { getDialect } from "./client.js";

/**
 * Read → conditional write → confirmation read, as one atomic unit, on every
 * supported dialect.
 *
 * Cloudflare D1 has no interactive transactions: `db.transaction()` issues a
 * bare `BEGIN`, which D1 rejects with `Failed query: begin`, so a template that
 * expressed this pattern as a transaction simply could not write on that
 * platform. D1 does offer `batch()`, which runs a fixed list of statements as an
 * implicit transaction — enough for the part that actually needs atomicity.
 *
 * The dialect branch lives here rather than at the call site, per the
 * architecture contract: app and template code uses the shared query builder and
 * never asks which database it is on.
 *
 * What each path guarantees:
 *
 * - **Interactive dialects** (SQLite/libSQL, Postgres): unchanged. All three
 *   steps run inside one transaction, exactly as before.
 * - **D1**: the initial read runs first, then the write and the confirmation
 *   read run together in one `batch()`. A sibling writer may therefore commit
 *   between the read and the write — which is why the write must be a
 *   compare-and-swap predicated on what the read saw, and why the confirmation
 *   read is what proves this attempt won. Both are the caller's responsibility
 *   and both are why this helper is shaped as read/plan/confirm rather than as
 *   a generic "run these statements".
 *
 * A caller that cannot express its write as a CAS must not use this helper on
 * D1: the guarantee it would need is not available there, and pretending
 * otherwise would be a silently weaker concurrency contract.
 */

/** Minimal surface this helper needs; both a Drizzle db and a tx satisfy it. */
type QueryExecutor = unknown;

/** A built Drizzle query. Awaited on the interactive path, batched on D1. */
type BuiltQuery = PromiseLike<unknown>;

export interface CompareAndSwapPlan<TConfirmed> {
  /** The conditional write, predicated on what `read` returned. */
  write: BuiltQuery;
  /** The read that proves this attempt's write landed. */
  confirm: PromiseLike<TConfirmed>;
}

export interface CompareAndSwapOptions<TCurrent, TConfirmed> {
  /** Reads the current row. Throwing here aborts before anything is written. */
  read: (exec: QueryExecutor) => Promise<TCurrent>;
  /** Builds the CAS write and its confirmation read from what `read` saw. */
  plan: (
    exec: QueryExecutor,
    current: TCurrent,
  ) => CompareAndSwapPlan<TConfirmed>;
}

export interface CompareAndSwapResult<TCurrent, TConfirmed> {
  current: TCurrent;
  confirmed: TConfirmed;
}

interface BatchCapableDb {
  batch: (queries: readonly BuiltQuery[]) => Promise<unknown[]>;
}

interface TransactionCapableDb {
  transaction: <T>(fn: (tx: QueryExecutor) => Promise<T>) => Promise<T>;
}

export async function runCompareAndSwap<TCurrent, TConfirmed>(
  db: unknown,
  { read, plan }: CompareAndSwapOptions<TCurrent, TConfirmed>,
): Promise<CompareAndSwapResult<TCurrent, TConfirmed>> {
  if (getDialect() === "d1") {
    const batchable = db as BatchCapableDb;
    if (typeof batchable.batch !== "function") {
      // The D1 dialect without a batching client is a broken wiring, not a
      // slower path: falling through to `transaction()` would fail on `BEGIN`
      // and name the wrong cause.
      throw new Error(
        "[db] The d1 dialect resolved a database client with no batch(); " +
          "D1 has no interactive transactions, so an atomic compare-and-swap " +
          "cannot be performed. Check the D1 binding wiring.",
      );
    }
    const current = await read(db);
    const { write, confirm } = plan(db, current);
    const results = await batchable.batch([write, confirm]);
    return { current, confirmed: results[1] as TConfirmed };
  }

  const transactional = db as TransactionCapableDb;
  return transactional.transaction(async (tx) => {
    const current = await read(tx);
    const { write, confirm } = plan(tx, current);
    await write;
    return { current, confirmed: await confirm };
  });
}
