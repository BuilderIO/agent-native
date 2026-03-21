import "dotenv/config";
import fs from "fs";
import { definePlugin } from "nitro";
import { createFileSync } from "@agent-native/core/adapters/sync";
import { setSyncResult } from "../lib/watcher";

export default definePlugin(async () => {
  const result = await createFileSync({ contentRoot: "./data" });
  setSyncResult(result);
  if (result.status === "error") {
    console.warn(`[app] File sync failed: ${result.reason}`);
  }
  process.on("SIGTERM", async () => {
    if (result.status === "ready") await result.shutdown();
    process.exit(0);
  });
  if (result.status === "ready") {
    result.fileSync.syncEvents.on("sync", (event: any) => {
      try {
        if (event.type === "conflict-needs-llm") {
          fs.mkdirSync("application-state", { recursive: true });
          fs.writeFileSync("application-state/sync-conflict.json", JSON.stringify(event, null, 2));
        } else if (event.type === "conflict-resolved") {
          fs.rmSync("application-state/sync-conflict.json", { force: true });
        }
      } catch { /* best-effort */ }
    });
  }
});
