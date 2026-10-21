import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";
import { creativeContextDbPlugin } from "@agent-native/creative-context/server";

import { runBuiltinDashboardPass } from "../server/lib/builtin-dashboard-pass.js";
import { repairPersistedFirstPartyDashboardQueries } from "../server/lib/first-party-dashboard-repair.js";
import { runAnalyticsMigrations } from "../server/plugins/db.js";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await creativeContextDbPlugin(null);
    await runAnalyticsMigrations(null);
    await repairPersistedFirstPartyDashboardQueries();
    console.log(
      "[migrate-production] built-in dashboards:",
      JSON.stringify(await runBuiltinDashboardPass()),
    );
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
