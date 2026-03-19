import "dotenv/config";
import fs from "fs";
import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import { createFileSync } from "@agent-native/core/adapters/sync";

export async function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

  // --- File sync (opt-in via FILE_SYNC_ENABLED=true) ---
  const syncResult = await createFileSync({ contentRoot: "./data" });

  if (syncResult.status === "error") {
    console.warn(`[app] File sync failed: ${syncResult.reason}`);
  }

  const extraEmitters =
    syncResult.status === "ready" ? [syncResult.sseEmitter] : [];

  // --- Add your API routes here ---

  app.get("/api/hello", (_req, res) => {
    res.json({ message: "Hello from your @agent-native/core app!" });
  });

  // File sync status (diagnostic endpoint)
  app.get("/api/file-sync/status", (_req, res) => {
    if (syncResult.status !== "ready") {
      return res.json({ enabled: false, conflicts: 0 });
    }
    res.json({
      enabled: true,
      connected: true,
      conflicts: syncResult.fileSync.conflictCount,
    });
  });

  // SSE events (keep this last)
  app.get(
    "/api/events",
    createSSEHandler(watcher, { extraEmitters, contentRoot: "./data" }),
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    if (syncResult.status === "ready") await syncResult.shutdown();
    process.exit(0);
  });

  // Agent-native parity: notify agent of sync conflicts
  if (syncResult.status === "ready") {
    syncResult.fileSync.syncEvents.on("sync", (event) => {
      if (event.type === "conflict-needs-llm") {
        try {
          fs.mkdirSync("application-state", { recursive: true });
          fs.writeFileSync(
            "application-state/sync-conflict.json",
            JSON.stringify(event, null, 2),
          );
        } catch {
          /* best-effort */
        }
      }
    });
  }

  return app;
}
