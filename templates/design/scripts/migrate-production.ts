import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";
import { creativeContextDbPlugin } from "@agent-native/creative-context/server";

import { ensureJourneyCanvasStageExpiryIndex } from "../server/lib/journey-canvas-stage-cleanup.js";
import { runDesignMigrations } from "../server/plugins/db.js";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await creativeContextDbPlugin(null);
    await runDesignMigrations(null);
    await ensureJourneyCanvasStageExpiryIndex();
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
