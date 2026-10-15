import type { DbExec } from "./client.js";
import {
  MIGRATION_DEFERRED,
  splitSqlStatements,
  type MigrationEntry,
} from "./migrations.js";
import type { StoreMigration } from "./store-registry.js";

/**
 * Turns `runMigrations` entries into store migrations that keep each entry's
 * identity: a named entry keeps its name, an unnamed one becomes `v<version>`,
 * and each carries a `legacy` reference so a database that already applied it
 * through the old list records it instead of running it again. Multi-statement
 * SQL is split here because the store runner sends one statement per call.
 */
export function fromMigrationEntries(
  table: string,
  entries: readonly MigrationEntry[],
  options: { data?: readonly (string | number)[] } = {},
): StoreMigration[] {
  const data = new Set(options.data ?? []);
  return entries.map((entry) => {
    const raw = typeof entry.sql === "string" ? entry.sql : entry.sql.postgres;
    const name = entry.name ?? `v${entry.version}`;
    const run = entry.run;
    return {
      name,
      kind:
        data.has(name) || data.has(entry.version)
          ? ("data" as const)
          : undefined,
      sql: raw ? splitSqlStatements(raw) : undefined,
      run: run
        ? async (exec: DbExec) => {
            if ((await run(exec)) === MIGRATION_DEFERRED) {
              throw new Error(
                `Migration "${name}" deferred itself; store migrations cannot be deferred.`,
              );
            }
          }
        : undefined,
      legacy: { table, version: entry.version, name: entry.name },
    } satisfies StoreMigration;
  });
}
