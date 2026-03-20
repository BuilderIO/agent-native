import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { sendStream, defineEventHandler, setResponseStatus } from "h3";
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

  // Serve uploaded brand assets
  router.get(
    "/api/brand/files/**",
    defineEventHandler(async (event) => {
      const url = event.path;
      const filename = url.replace("/api/brand/files/", "");
      const filepath = path.join(process.cwd(), "data", "brand", filename);
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
  router.get(
    "/api/generated/**",
    defineEventHandler(async (event) => {
      const url = event.path;
      const filename = url.replace("/api/generated/", "");
      const filepath = path.join(
        process.cwd(),
        "data",
        "generations",
        filename,
      );
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

  return app;
}
