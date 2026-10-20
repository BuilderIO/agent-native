/**
 * For specs that mock `getDbExec()` with a hand-written executor. Outside
 * hosted runtimes a store records its migrations in `_an_store_migrations`
 * (see `store-registry.ts`), so a strict mock sees those statements too.
 * Answer them as an empty ledger: every store then applies its migrations
 * against the mock once per executor, as it did before the ledger.
 */
const STORE_LEDGER_STATEMENT = /\b_an_store_migration(?:s|_lock)\b/;

export function isStoreLedgerStatement(sql: string): boolean {
  return STORE_LEDGER_STATEMENT.test(sql);
}

export function storeLedgerResult(
  sql: string,
): { rows: Array<Record<string, unknown>>; rowsAffected: number } | undefined {
  if (!isStoreLedgerStatement(sql)) return undefined;
  return {
    rows: [],
    rowsAffected: /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql) ? 1 : 0,
  };
}
