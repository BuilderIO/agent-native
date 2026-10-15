---
name: framework-stores
description: >-
  How framework-owned tables in packages/core declare and change their schema
  with defineStore(). Use before adding a table, column, index, backfill or
  seed to a core store, before writing an ensure*Table() function, and when
  guard:release-schema-complete or SchemaNotMigratedError fires.
scope: dev
metadata:
  internal: true
---

# Framework stores

Every framework table in `packages/core/src` is owned by exactly one
`defineStore()` from `src/db/store-registry.ts`. The release step applies a
store's migrations once per database and records each in
`_an_store_migrations`. Hosted functions of release-owned apps only read that
ledger; they never issue DDL. Design and rollout: 
`docs/plans/2026-09-28-store-registry-schema-ownership.md`.

App-owned template tables are not covered here; they use `runMigrations` or
Drizzle (see `storing-data`).

## Rules

- **Schema lives in a store's migration list, nowhere else.** No
  `let _initPromise` memo, no `ensureTableExists` / `ensureColumnExists` /
  `ensureIndexExists` and no `CREATE`/`ALTER` outside a `defineStore()`
  migration. Keep the module's exported `ensure*()` as
  `return xStore.ready();` so callers do not change.
- **Append, never edit.** A database records a migration by name and never runs
  it again, so editing, renaming, reordering or deleting one never reaches
  databases that already applied it. To change a table, add a new named
  migration at the end. `store-migrations.lock.json` makes this a CI failure.
- **Baselines converge old tables.** A database created by any older core runs
  the baseline against whatever shape it has, so keep `CREATE TABLE IF NOT
  EXISTS` plus `ensureColumnExists` for every column ever added. Never squash a
  baseline into today's `CREATE TABLE`.
- **Idempotent and additive.** First runs can race and old functions keep
  serving during a release. New columns are nullable or defaulted.
- **One store's tables only.** Stores apply in registry order, which is by id,
  so a migration must not depend on another store's tables.
- **Mark data migrations.** Backfills and seeds get `kind: "data"`; a schema
  snapshot cannot replace them.
- **Never swallow a failure inside a migration.** The ledger would record it as
  applied and it would never retry. Rethrow at release
  (`isMigrationAuthorizedRuntime()`), as `widenIntColumnsToBigInt` does.
- **Literal declaration.** Write `export const xStore = defineStore({ id:
  "snake_case_id", migrations: [...] })`; the generator only reads that form,
  and the guard fails on any other. Ids are permanent.

## Adding or changing a store

```ts
export const widgetsStore = defineStore({
  id: "widgets",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        await ensureTableExists("widgets", CREATE_WIDGETS_SQL);
        await ensureColumnExists("widgets", "owner", `ALTER TABLE widgets ADD COLUMN IF NOT EXISTS owner TEXT`);
      },
    },
    { name: "owner-index", sql: `CREATE INDEX IF NOT EXISTS widgets_owner_idx ON widgets (owner)` },
    { name: "backfill-owner", kind: "data", sql: `UPDATE widgets SET owner = created_by WHERE owner IS NULL` },
  ],
});

export function ensureWidgetsTable(): Promise<void> {
  return widgetsStore.ready();
}
```

Then run, in this order:

1. `pnpm gen:store-registry` — rewrites `store-registry.generated.ts` and
   `store-migrations.lock.json`. Commit both.
2. `pnpm guard:release-schema-complete` and `pnpm guard:additive-migrations`.
3. The store's own spec, plus `src/db/store-registry.spec.ts` and
   `src/server/release-schema.cold-start.spec.ts` from `packages/core`.

## Readiness modes

`ready()` picks a mode from who owns the schema:

- **apply** — the release step (`withMigrationRuntime`). The only ledger writer.
- **verify** — hosted function of an app that migrates at release. One shared
  ledger read; `SchemaNotMigratedError` names missing migrations. A beta that
  borrows production's schema warns instead.
- **hosted-replay** / **replay** — hosted apps without release migrations,
  local dev, tests, self-hosted. Runs migrations idempotently, as before,
  without touching the ledger.

A `SchemaNotMigratedError` in production means the release step did not run
against that database, or ran older code. Fix the deploy; never catch the
error to make it go away.

## Reviewed exceptions

`// guard:allow-unreleased-schema — <reason>` exempts a module from schema
placement checks. Current exceptions: `sharing/indexes.ts` (indexes app and
framework share tables at release) and `triggers/event-queue.ts` (owned by a
versioned list until those fold into stores). A new one needs a reason a
reviewer can check.
