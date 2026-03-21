import fs from "fs";
import { definePlugin } from "nitro";
import { createFileSync } from "@agent-native/core/adapters/sync";
import { setSyncResult } from "../lib/watcher.js";
import { processJobs } from "../tasks/jobs/process.js";

export default definePlugin(async () => {
  // File sync (multi-user collaboration)
  const result = await createFileSync({ contentRoot: "./data" });
  setSyncResult(result);

  if (result.status === "error") {
    console.warn(`[app] File sync failed: ${result.reason}`);
  }

  // Conflict notification
  if (result.status === "ready") {
    result.fileSync.syncEvents.on("sync", (event: any) => {
      try {
        if (event.type === "conflict-needs-llm") {
          fs.mkdirSync("application-state", { recursive: true });
          fs.writeFileSync(
            "application-state/sync-conflict.json",
            JSON.stringify(event, null, 2),
          );
        } else if (event.type === "conflict-resolved") {
          fs.rmSync("application-state/sync-conflict.json", { force: true });
        }
      } catch {
        /* best-effort */
      }
    });
  }

  // Process scheduled jobs every minute (snooze + send-later)
  setInterval(() => {
    processJobs().catch((err: unknown) =>
      console.error("[jobs] Error processing jobs:", err),
    );
  }, 60_000);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    if (result.status === "ready") await result.shutdown();
    process.exit(0);
  });
});
