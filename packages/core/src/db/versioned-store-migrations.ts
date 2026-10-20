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
 *
 * Only for lists that existed before the store registry. A release-only list
 * converted this way runs nowhere but the release step, so an entry appended
 * to it never reaches local or self-hosted databases. New migrations belong in
 * `storeMigrationsFromEntries` (or plain store migrations) instead; the store
 * migrations lock rejects new entries on a release-only list.
 */
export function fromMigrationEntries(
  table: string,
  entries: readonly MigrationEntry[],
  options: {
    data?: readonly (string | number)[];
    /** The list also ran at plugin boot on main, not only at release. */
    ranAtBoot?: boolean;
  } = {},
): StoreMigration[] {
  const data = new Set(options.data ?? []);
  return entries.map((entry) => ({
    ...toStoreMigration(entry, data),
    legacy: {
      table,
      version: entry.version,
      name: entry.name,
      ranAtBoot: options.ranAtBoot,
      entry: options.ranAtBoot ? entry : undefined,
    },
  }));
}

/**
 * The same conversion without a `legacy` reference: ordinary store
 * migrations, applied by every runtime that owns its database (the release
 * step, local dev, tests, self-hosted servers). For entries added after their
 * old list was folded into a store, which no old bookkeeping table ever
 * recorded. A database that already applied one under its name skips it.
 */
export function storeMigrationsFromEntries(
  entries: readonly MigrationEntry[],
  options: { data?: readonly (string | number)[] } = {},
): StoreMigration[] {
  const data = new Set(options.data ?? []);
  return entries.map((entry) => toStoreMigration(entry, data));
}

function toStoreMigration(
  entry: MigrationEntry,
  data: ReadonlySet<string | number>,
): StoreMigration {
  const raw = typeof entry.sql === "string" ? entry.sql : entry.sql.postgres;
  const name = entry.name ?? `v${entry.version}`;
  const run = entry.run;
  return {
    name,
    kind:
      data.has(name) || data.has(entry.version) ? ("data" as const) : undefined,
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
  } satisfies StoreMigration;
}
