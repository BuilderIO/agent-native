import "dotenv/config";
import { createServer, createFileWatcher, createSSEHandler } from "@agent-native/core";

export function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

  // --- Add your API routes here ---

  app.get("/api/hello", (_req, res) => {
    res.json({ message: "Hello from your @agent-native/core app!" });
  });

  // SSE events (keep this last)
  app.get("/api/events", createSSEHandler(watcher));

  return app;
}
