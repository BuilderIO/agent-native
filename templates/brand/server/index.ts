import fs from "fs";
import { defineEventHandler } from "h3";
import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import { createFileSync } from "@agent-native/core/adapters/sync";
import { envKeys } from "./lib/env-config.js";
import { registerBrandRoutes } from "./routes/brand.js";
import { registerGenerationsRoutes } from "./routes/generations.js";

export async function createAppServer() {
  const { app, router } = createServer({ envKeys });

  // SSE file watcher for real-time sync
  const watcher = createFileWatcher("./data");

  // --- File sync (opt-in via FILE_SYNC_ENABLED=true) ---
  const syncResult = await createFileSync({ contentRoot: "./data" });
  if (syncResult.status === "error") {
    console.warn(`[app] File sync failed: ${syncResult.reason}`);
  }
  const extraEmitters =
    syncResult.status === "ready" ? [syncResult.sseEmitter] : [];

  // Diagnostic endpoint
  router.get(
    "/api/file-sync/status",
    defineEventHandler(() => {
      if (syncResult.status !== "ready")
        return { enabled: false, conflicts: 0 };
      return {
        enabled: true,
        connected: true,
        conflicts: syncResult.fileSync.conflictCount,
      };
    }),
  );

  router.get(
    "/api/events",
    createSSEHandler(watcher, { extraEmitters, contentRoot: "./data" }),
  );

  // Brand asset routes (includes static file serving)
  registerBrandRoutes(router);

  // Generations routes (includes static file serving)
  registerGenerationsRoutes(router);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    if (syncResult.status === "ready") await syncResult.shutdown();
    process.exit(0);
  });

  // Conflict notification
  if (syncResult.status === "ready") {
    syncResult.fileSync.syncEvents.on("sync", (event) => {
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

  return app;
}
