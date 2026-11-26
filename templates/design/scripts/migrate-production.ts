import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

import { ensureJourneyCanvasStageExpiryIndex } from "../server/lib/journey-canvas-stage-cleanup.js";
import { runDesignMigrations } from "../server/plugins/db.js";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null, { requirePostgres: true });
    await runDesignMigrations(null);
    await ensureJourneyCanvasStageExpiryIndex();
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
