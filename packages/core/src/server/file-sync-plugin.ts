import fs from "fs";
import { setDefaultSyncResult } from "./default-watcher.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createFileSyncPlugin(options?: {
  contentRoot?: string;
}): NitroPluginDef {
  return async () => {
    // Dynamic import to avoid loading sync deps when not needed
    const { createFileSync } = await import("../adapters/sync/index.js");
    const result = await createFileSync({
      contentRoot: options?.contentRoot || "./data",
    });
    setDefaultSyncResult(result);

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
  };
}

export const defaultFileSyncPlugin: NitroPluginDef = createFileSyncPlugin();
