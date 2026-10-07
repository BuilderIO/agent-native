import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
  });
}

// Guard: closeDbExec() below tears down the shared database pool, so this
// script must run only as its own process (`pnpm migrate:production`). The
// framework's action auto-discovery would otherwise mount it as a live route
// and running the teardown in-process breaks every other request with "Cannot
// use a pool after calling end on the pool." Throw instead of tearing down a
// pool this process does not own.
function isProcessEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      pathToFileURL(realpathSync(entry)).href ===
      pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    );
  } catch {
    // coercion-ok: an unresolvable entry path is not this script, so the guard below throws.
    return false;
  }
}

if (!isProcessEntrypoint()) {
  throw new Error(
    "scripts/migrate-production.ts must run as its own process " +
      "(pnpm migrate:production); it closes the shared database pool when it " +
      "finishes, so importing or invoking it in-process — e.g. via an " +
      "auto-discovered action route — would break every other request.",
  );
}

try {
  await main();
} finally {
  await closeDbExec();
}
