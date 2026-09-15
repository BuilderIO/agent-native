import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

/**
 * Release-time owner for the framework schema used by the public docs app.
 * Request functions opt out of these migrations so public SSR does not wait
 * on database setup during a cold start.
 */
async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
