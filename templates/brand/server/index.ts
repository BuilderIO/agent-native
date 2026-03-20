import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import { envKeys } from "./lib/env-config.js";
import { registerBrandRoutes } from "./routes/brand.js";
import { registerGenerationsRoutes } from "./routes/generations.js";

export function createAppServer() {
  const { app, router } = createServer({ envKeys });

  // SSE file watcher for real-time sync
  const watcher = createFileWatcher("./data");
  router.get("/api/events", createSSEHandler(watcher));

  // Brand asset routes (includes static file serving)
  registerBrandRoutes(router);

  // Generations routes (includes static file serving)
  registerGenerationsRoutes(router);

  return app;
}
