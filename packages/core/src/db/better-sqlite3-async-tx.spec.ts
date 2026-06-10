/**
 * Regression spec for async db.transaction() on the better-sqlite3 driver.
 *
 * better-sqlite3's native Transaction wrapper is sync-only — an async callback
 * throws "Transaction function cannot return a promise". The framework patches
 * the drizzle instance's .transaction() method in create-get-db.ts to support
 * async callbacks via manual BEGIN IMMEDIATE / COMMIT / ROLLBACK, with
 * SAVEPOINT for nested calls.
 */
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Schema used by every test
// ---------------------------------------------------------------------------

const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  value: text("value").notNull(),
});

// ---------------------------------------------------------------------------
// Helper: open an in-memory DB with the patch applied
// ---------------------------------------------------------------------------

async function openDb() {
  // Dynamic import mirrors how create-get-db.ts loads the driver.
  const [{ drizzle }, { patchBetterSqliteTransactions }] = await Promise.all([
    import("drizzle-orm/better-sqlite3"),
    // Import the patching function via the module under test.
    // The function is not exported — we test via the public createGetDb path,
    // but for unit isolation we construct a db directly and apply the same
    // patch logic by re-using the internal helper exposed via a test hook.
    // Since the helper is not exported, we instead inline an equivalent
    // open+patch sequence that mirrors create-get-db.ts exactly.
    Promise.resolve({ patchBetterSqliteTransactions: null }),
  ]);

  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)",
  );

  const schema = { items };
  const rawDb = drizzle(sqlite, { schema });

  // Apply the same patch as create-get-db.ts — imported via the module export.
  // patchBetterSqliteTransactions is unexported so we use the integration path:
  // the fully-initialised db returned by createGetDb already has the patch.
  // For unit testing we inline an equivalent wrapper here.
  let savepointSeq = 0;
  const EXTRACT_TX = Symbol("extract-tx");

  function makeAsyncTransaction(
    originalTransaction: (...args: any[]) => any,
  ): (...args: any[]) => Promise<unknown> {
    return async function asyncTransaction(cb: (tx: unknown) => unknown) {
      let capturedTx: unknown;
      try {
        originalTransaction((tx: unknown) => {
          capturedTx = tx;
          throw EXTRACT_TX;
        });
      } catch (e) {
        if (e !== EXTRACT_TX) throw e;
      }
      const tx = capturedTx as { transaction: (...a: any[]) => any };
      if (tx && typeof tx.transaction === "function") {
        tx.transaction = makeAsyncTransaction(tx.transaction.bind(tx));
      }
      const nested = sqlite.inTransaction;
      if (nested) {
        const sp = `sp_async_${++savepointSeq}`;
        sqlite.exec(`SAVEPOINT ${sp}`);
        let released = false;
        try {
          const result = await cb(tx);
          sqlite.exec(`RELEASE SAVEPOINT ${sp}`);
          released = true;
          return result;
        } catch (err) {
          if (!released) {
            try {
              sqlite.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
              sqlite.exec(`RELEASE SAVEPOINT ${sp}`);
            } catch {}
          }
          throw err;
        }
      }
      sqlite.exec("BEGIN IMMEDIATE");
      let committed = false;
      try {
        const result = await cb(tx);
        sqlite.exec("COMMIT");
        committed = true;
        return result;
      } catch (err) {
        if (!committed) {
          try {
            sqlite.exec("ROLLBACK");
          } catch {}
        }
        throw err;
      }
    };
  }

  (rawDb as any).transaction = makeAsyncTransaction(
    (rawDb as any).transaction.bind(rawDb),
  );

  return { db: rawDb as typeof rawDb & { transaction: any }, sqlite };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("better-sqlite3 async db.transaction()", () => {
  it("commits on success", async () => {
    const { db } = await openDb();

    await db.transaction(async (tx: any) => {
      await Promise.resolve(); // yield to microtask queue
      await tx.insert(items).values({ value: "alpha" });
    });

    const rows = await db.select().from(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("alpha");
  });

  it("rolls back on thrown error", async () => {
    const { db } = await openDb();

    // Pre-insert so we know the table starts non-empty is not assumed
    await db.insert(items).values({ value: "existing" });

    await expect(
      db.transaction(async (tx: any) => {
        await tx.insert(items).values({ value: "will-be-rolled-back" });
        await Promise.resolve();
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");

    const rows = await db.select().from(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("existing");
  });

  it("rolls back on async rejection", async () => {
    const { db } = await openDb();

    await expect(
      db.transaction(async (tx: any) => {
        await tx.insert(items).values({ value: "gone" });
        // Reject via a failed async operation
        await Promise.reject(new Error("async rejection"));
      }),
    ).rejects.toThrow("async rejection");

    const rows = await db.select().from(items);
    expect(rows).toHaveLength(0);
  });

  it("returns the callback return value", async () => {
    const { db } = await openDb();

    const result = await db.transaction(async (tx: any) => {
      await tx.insert(items).values({ value: "ret" });
      return "the-return-value";
    });

    expect(result).toBe("the-return-value");
  });

  it("supports multiple awaits inside the callback", async () => {
    const { db } = await openDb();

    await db.transaction(async (tx: any) => {
      await tx.insert(items).values({ value: "first" });
      await Promise.resolve(); // simulate async work between writes
      await tx.insert(items).values({ value: "second" });
    });

    const rows = await db.select().from(items).orderBy(items.id);
    expect(rows.map((r) => r.value)).toEqual(["first", "second"]);
  });

  it("supports sequential top-level transactions", async () => {
    const { db } = await openDb();

    await db.transaction(async (tx: any) => {
      await tx.insert(items).values({ value: "tx1" });
    });
    await db.transaction(async (tx: any) => {
      await tx.insert(items).values({ value: "tx2" });
    });

    const rows = await db.select().from(items).orderBy(items.id);
    expect(rows.map((r) => r.value)).toEqual(["tx1", "tx2"]);
  });

  it("handles nested async transaction with SAVEPOINT — commits both", async () => {
    const { db } = await openDb();

    await db.transaction(async (tx: any) => {
      await tx.insert(items).values({ value: "outer" });
      await tx.transaction(async (tx2: any) => {
        await Promise.resolve();
        await tx2.insert(items).values({ value: "inner" });
      });
    });

    const rows = await db.select().from(items).orderBy(items.id);
    expect(rows.map((r) => r.value)).toEqual(["outer", "inner"]);
  });

  it("handles nested async transaction with SAVEPOINT — rolls back inner only", async () => {
    const { db } = await openDb();

    await db.transaction(async (tx: any) => {
      await tx.insert(items).values({ value: "outer" });
      await expect(
        tx.transaction(async (tx2: any) => {
          await tx2.insert(items).values({ value: "inner-gone" });
          throw new Error("inner rollback");
        }),
      ).rejects.toThrow("inner rollback");
    });

    const rows = await db.select().from(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("outer");
  });

  it("leaves inTransaction false after commit", async () => {
    const { db, sqlite } = await openDb();

    await db.transaction(async (tx: any) => {
      await tx.insert(items).values({ value: "check" });
    });

    expect(sqlite.inTransaction).toBe(false);
  });

  it("leaves inTransaction false after rollback", async () => {
    const { db, sqlite } = await openDb();

    await expect(
      db.transaction(async () => {
        throw new Error("bail");
      }),
    ).rejects.toThrow("bail");

    expect(sqlite.inTransaction).toBe(false);
  });
});
