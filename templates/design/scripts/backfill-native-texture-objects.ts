import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { closeDbExec } from "@agent-native/core/db";

import { backfillDesignNativeTextureObjectsBatch } from "../server/lib/design-native-texture-backfill.js";

export async function runNativeTextureBackfill(): Promise<void> {
  let migrated = 0;
  try {
    for (let batch = 0; batch < 50; batch += 1) {
      const result = await backfillDesignNativeTextureObjectsBatch();
      migrated += result.migrated;
      if (result.complete) {
        console.log(JSON.stringify({ status: "complete", migrated }));
        return;
      }
    }
    throw new Error(
      "Native texture backfill is incomplete after 50 bounded batches; rerun to continue.",
    );
  } finally {
    await closeDbExec();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await runNativeTextureBackfill();
}
