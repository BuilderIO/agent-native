import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

import { runMailMigrations } from "../server/plugins/db.js";

/**
 * Release-time schema entrypoint for Mail.
 *
 * This script is the production owner of schema changes. It runs against the
 * direct migration endpoint selected by core, while request functions skip
 * all migration and ensure-table work automatically.
 */
async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await runMailMigrations(null);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
