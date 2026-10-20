import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";
import { creativeContextDbPlugin } from "@agent-native/creative-context/server";

import {
  runContentMigrations,
  runContentSourceMigrations,
} from "../server/plugins/db.js";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await creativeContextDbPlugin(null);
    await runContentMigrations(null);
    await runContentSourceMigrations(null);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
