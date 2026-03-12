import "dotenv/config";
import { createServer, createFileWatcher, createSSEHandler } from "agentnative/server";

export function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

  // --- Add your API routes here ---

  app.get("/api/hello", (_req, res) => {
    res.json({ message: "Hello from your agentnative app!" });
  });

  // SSE events (keep this last)
  app.get("/api/events", createSSEHandler(watcher));

  return app;
}
