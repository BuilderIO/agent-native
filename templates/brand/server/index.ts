import express from "express";
import path from "path";
import { createServer, createFileWatcher, createSSEHandler } from "@agent-native/core";
import { envKeys } from "./lib/env-config.js";
import { brandRouter } from "./routes/brand.js";
import { generationsRouter } from "./routes/generations.js";

export function createAppServer() {
  const app = createServer({ envKeys });

  // SSE file watcher for real-time sync
  const watcher = createFileWatcher("./data");
  app.get("/api/events", createSSEHandler(watcher));

  // Serve uploaded brand assets
  app.use(
    "/api/brand/files",
    express.static(path.join(process.cwd(), "data", "brand"))
  );

  // Serve generated images
  app.use(
    "/api/generated",
    express.static(path.join(process.cwd(), "data", "generations"))
  );

  // Mount routes
  app.use("/api/brand", brandRouter);
  app.use("/api/generations", generationsRouter);

  return app;
}
