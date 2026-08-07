import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

import { runAnalyticsMigrations } from "../server/plugins/db.js";

/**
 * Release-time schema entrypoint for Analytics.
 *
 * This script is the production owner of schema changes. It runs against the
 * direct migration endpoint selected by core, while request functions skip
 * all migration and ensure-table work automatically.
 */
async function main(): Promise<void> {
  process.env.APP_NAME ??= "analytics";
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await runAnalyticsMigrations(null);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
