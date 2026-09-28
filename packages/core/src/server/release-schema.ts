/**
 * Release-time creation of every framework-owned table.
 *
 * The list is `store-registry.generated.ts`, produced from every
 * `defineStore()` export. Its imports are dynamic so a request cold start never
 * loads the store modules this step walks; `guard:release-schema-complete`
 * fails when a module defines schema outside a registered store or the
 * generated file is stale.
 */

import { isMigrationAuthorizedRuntime } from "../db/migration-runtime.js";
import { FRAMEWORK_STORES } from "../db/store-registry.generated.js";

type SchemaEnsure = readonly [name: string, run: () => Promise<void>];

const FRAMEWORK_SCHEMA_ENSURES: readonly SchemaEnsure[] = FRAMEWORK_STORES.map(
  ([id, load]) => [id, () => load().then((store) => store.ready())] as const,
);

export function frameworkSchemaEnsureNames(): string[] {
  return FRAMEWORK_SCHEMA_ENSURES.map(([name]) => name);
}

/**
 * Create every framework-owned table, in one pass, before the app serves
 * traffic. Callers must hold migration duty via `withMigrationRuntime`; without
 * it a store only verifies or replays and nothing is recorded in the ledger.
 *
 * Sequential on purpose: these run against one database at release time, where
 * total wall clock does not matter and concurrent `CREATE TABLE` on a shared
 * Neon instance contends for `ACCESS EXCLUSIVE` locks.
 *
 * A failure aborts the release rather than being collected and reported at the
 * end. A half-created schema that reports success is the failure mode this
 * module exists to remove.
 */
export async function runFrameworkSchemaEnsures(
  ensures: readonly SchemaEnsure[] = FRAMEWORK_SCHEMA_ENSURES,
): Promise<void> {
  if (!isMigrationAuthorizedRuntime()) {
    throw new Error(
      "runFrameworkSchemaEnsures must run inside withMigrationRuntime(); outside it no store is migrated.",
    );
  }
  for (const [name, run] of ensures) {
    try {
      await run();
    } catch (err) {
      throw new Error(
        `Release schema step failed while creating ${name}: ${
          (err as Error)?.message ?? String(err)
        }`,
        { cause: err },
      );
    }
  }
}
