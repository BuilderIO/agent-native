import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

import {
  createDesignSystemsOneDefaultIndex,
  healDuplicateDesignSystemDefaults,
} from "../server/lib/design-system-defaults.js";
import { runDesignMigrations } from "../server/plugins/db.js";

/**
 * Release-time schema entrypoint for Design.
 *
 * This script is the production owner of schema changes. It runs against the
 * direct migration endpoint selected by core, while request functions skip
 * all migration and ensure-table work automatically.
 */
async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await runDesignMigrations(null);

    // Reconcile any duplicate design-system defaults left by the race this
    // fix closes, then create the unique index that keeps new ones from
    // appearing. This is the authoritative production path: a normal
    // request/plugin-boot call can't run schema DDL in a hosted serverless
    // runtime (see design-system-defaults.ts), only this release script can.
    const healedCount = await healDuplicateDesignSystemDefaults();
    if (healedCount > 0) {
      console.info(
        `[migrate] cleared ${healedCount} stale duplicate design-system default(s)`,
      );
    }
    try {
      await createDesignSystemsOneDefaultIndex();
    } catch (err) {
      console.warn(
        "[migrate] design_systems_one_default_per_scope_idx not created:",
        err instanceof Error ? err.message : err,
      );
    }
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
