import "dotenv/config";
import fs from "fs";
import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { createFileSync } from "@agent-native/core/adapters/sync";
import { handleDemo } from "./routes/demo";
import { handleSaveCompositionDefaults } from "./routes/save-composition";

export async function createAppServer() {
  const { app, router } = createServer();

  const watcher = createFileWatcher("./data");

  const syncResult = await createFileSync({ contentRoot: "./data" });
  if (syncResult.status === "error") {
    console.warn(`[app] File sync failed: ${syncResult.reason}`);
  }
  const extraEmitters =
    syncResult.status === "ready" ? [syncResult.sseEmitter] : [];

  // File sync diagnostic endpoint
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

  router.get("/api/demo", handleDemo);

  // Save composition defaults to registry
  router.post("/api/save-composition-defaults", handleSaveCompositionDefaults);

  // File sync SSE
  router.get(
    "/api/events",
    createSSEHandler(watcher, { extraEmitters, contentRoot: "./data" }),
  );

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
