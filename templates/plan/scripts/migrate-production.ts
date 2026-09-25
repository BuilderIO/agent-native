import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

import { runPlanMigrations } from "../server/plugins/db.js";

loadEnv();

/**
 * Release-time schema entrypoint for Plan.
 *
 * This script is the production owner of schema changes. It runs against the
 * direct migration endpoint selected by core, while request functions skip
 * all migration and ensure-table work automatically.
 */
async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await runPlanMigrations(null);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
