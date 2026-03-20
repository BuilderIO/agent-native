import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { sendStream, defineEventHandler, setResponseStatus } from "h3";
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

  // Serve uploaded brand assets
  router.get(
    "/api/brand/files/**",
    defineEventHandler(async (event) => {
      const filename = event.path.replace("/api/brand/files/", "");
      const brandDir = path.resolve(process.cwd(), "data", "brand");
      const filepath = path.resolve(brandDir, filename);
      if (!filepath.startsWith(brandDir + path.sep)) {
        setResponseStatus(event, 403);
        return { error: "Forbidden" };
      }
      try {
        await stat(filepath);
        return sendStream(event, createReadStream(filepath));
      } catch {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
    }),
  );

  // Serve generated images
  const generationsDir = path.resolve(process.cwd(), "data", "generations");
  router.get(
    "/api/generated/**",
    defineEventHandler(async (event) => {
      const filename = event.path.replace("/api/generated/", "");
      const filepath = path.resolve(generationsDir, filename);
      if (!filepath.startsWith(generationsDir + path.sep)) {
        setResponseStatus(event, 403);
        return { error: "Forbidden" };
      }
      try {
        await stat(filepath);
        return sendStream(event, createReadStream(filepath));
      } catch {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
    }),
  );

  // Mount routes
  registerBrandRoutes(router);
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
