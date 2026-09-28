import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

import { repairPersistedFirstPartyDashboardQueries } from "../server/lib/first-party-dashboard-repair.js";
import { runAnalyticsMigrations } from "../server/plugins/db.js";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await runAnalyticsMigrations(null);
    await repairPersistedFirstPartyDashboardQueries();
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
