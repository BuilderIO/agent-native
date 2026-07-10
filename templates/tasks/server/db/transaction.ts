import { getDb } from "./index.js";

type AppDb = ReturnType<typeof getDb>;
export type TransactionDb = any;

export function runTransaction<T>(db: AppDb, fn: (tx: TransactionDb) => T): T {
  const transaction = db.transaction as unknown as (
    callback: (tx: TransactionDb) => T,
  ) => T;
  return transaction.call(db, fn);
}
