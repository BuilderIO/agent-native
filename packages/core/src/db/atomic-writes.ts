import { getDialect } from "./client.js";

/**
 * Run a fixed list of writes as one atomic unit on every supported dialect.
 *
 * Companion to `runCompareAndSwap`, for the other half of the problem it
 * describes: D1 has no interactive transactions, so `db.transaction()` issues a
 * bare `BEGIN` and fails with `Failed query: begin`. Where `runCompareAndSwap`
 * covers read → conditional write → confirm, this covers the far more common
 * "insert these N rows together, or none of them". D1's `batch()` runs a fixed
 * statement list as an implicit transaction, which is exactly that guarantee.
 *
 * The dialect branch lives here rather than at the call site, per the
 * architecture contract: app and template code uses the shared query builder
 * and never asks which database it is on.
 *
 * `build` must return every statement up front and must not depend on a
 * previous statement's result — that is what makes the D1 path possible at all.
 * A write sequence that needs to read its own intermediate state is an
 * interactive transaction, and belongs in `runCompareAndSwap` (or nowhere, on
 * D1) rather than being reshaped until it type-checks here.
 */

/** Minimal surface this helper needs; both a Drizzle db and a tx satisfy it. */
type QueryExecutor = unknown;

/** A built Drizzle query. Awaited on the interactive path, batched on D1. */
type BuiltQuery = PromiseLike<unknown>;

interface BatchCapableDb {
  batch: (queries: readonly BuiltQuery[]) => Promise<unknown[]>;
}

interface TransactionCapableDb {
  transaction: <T>(fn: (tx: QueryExecutor) => Promise<T>) => Promise<T>;
}

export async function runAtomicWrites(
  db: unknown,
  build: (exec: QueryExecutor) => readonly BuiltQuery[],
): Promise<void> {
  if (getDialect() === "d1") {
    const batchable = db as BatchCapableDb;
    if (typeof batchable.batch !== "function") {
      // The d1 dialect without a batching client is broken wiring, not a slower
      // path: falling through to `transaction()` would fail on `BEGIN` and name
      // the wrong cause.
      throw new Error(
        "[db] The d1 dialect resolved a database client with no batch(); " +
          "D1 has no interactive transactions, so these writes cannot be made " +
          "atomic. Check the D1 binding wiring.",
      );
    }
    const queries = build(db);
    // `batch([])` is a round trip that guarantees nothing; an empty plan is a
    // caller bug worth surfacing rather than a successful no-op write.
    if (queries.length === 0) {
      throw new Error("[db] runAtomicWrites was given no statements to run.");
    }
    await batchable.batch(queries);
    return;
  }

  const transactional = db as TransactionCapableDb;
  await transactional.transaction(async (tx) => {
    const queries = build(tx);
    if (queries.length === 0) {
      throw new Error("[db] runAtomicWrites was given no statements to run.");
    }
    for (const query of queries) await query;
  });
}
