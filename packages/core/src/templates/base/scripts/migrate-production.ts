import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

/**
 * Release-time schema entrypoint.
 *
 * Every deploy runs this once, and request functions never touch schema. That
 * ordering is not an optimization: on serverless, "migrate on first use" means
 * migrate on EVERY cold start, and a production incident traced a multi-hour
 * outage to schema introspection running 4-6 times concurrently on the request
 * path.
 *
 * `withMigrationRuntime()` is load-bearing. The Netlify BUILD environment sets
 * NETLIFY=true, so this script looks like a serverless request to the guard in
 * `runMigrations` — it is allowed to migrate only because it claims duty here.
 * A release entrypoint that forgets the wrapper silently does nothing.
 *
 * If this app owns tables of its own, export its migration runner from
 * `server/plugins/db.ts` and call it inside the same block.
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
