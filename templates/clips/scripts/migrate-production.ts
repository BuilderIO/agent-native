import {
  closeDbExec,
  createDbExec,
  getMigrationDatabaseUrl,
  withMigrationRuntime,
} from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

import { buildRecordingMediaReferenceIndexes } from "../server/lib/recording-media-reference-indexes.js";
import { migrations as runClipsMigrations } from "../server/plugins/db.js";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    await runClipsMigrations(null);
    const indexDb = await createDbExec({ url: getMigrationDatabaseUrl() });
    try {
      // raw-sql-ok: the release helper supplies only fixed index DDL and a fixed catalog query, without runtime interpolation.
      await buildRecordingMediaReferenceIndexes((statement) =>
        indexDb.execute(statement),
      );
    } finally {
      await indexDb.close?.();
    }
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
