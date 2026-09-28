import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";
import { runDispatchMigrations } from "@agent-native/dispatch/server";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await runDispatchMigrations(null);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
