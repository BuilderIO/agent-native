#!/usr/bin/env tsx

/**
 * The deploy pass that moves pre-built-in dashboard copies onto built-ins
 * (it also runs from migrate-production on every deploy).
 *
 *   pnpm --filter analytics exec tsx scripts/builtin-dashboards.ts --dry-run   # counts only
 *   pnpm --filter analytics exec tsx scripts/builtin-dashboards.ts             # hide untouched copies
 *   pnpm --filter analytics exec tsx scripts/builtin-dashboards.ts --restore   # unhide every copy it hid
 */

import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";

import {
  restoreBuiltinDashboardPass,
  runBuiltinDashboardPass,
} from "../server/lib/builtin-dashboard-pass.js";
import { runAnalyticsMigrations } from "../server/plugins/db.js";

loadEnv();

try {
  await withMigrationRuntime(async () => {
    await runAnalyticsMigrations(null);
    const result = process.argv.includes("--restore")
      ? await restoreBuiltinDashboardPass()
      : await runBuiltinDashboardPass({
          dryRun: process.argv.includes("--dry-run"),
        });
    console.log(JSON.stringify(result, null, 2));
  });
} finally {
  await closeDbExec();
}
