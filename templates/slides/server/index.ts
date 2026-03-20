import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core";
import { envKeys } from "./lib/env-config.js";
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { sendStream, defineEventHandler, setResponseStatus } from "h3";
import { createFileSync } from "@agent-native/core/adapters/sync";
import { handleDemo } from "./routes/demo";
import { generateImage, getImageGenStatus } from "./routes/image-gen";
import { generateSlides } from "./routes/generate-slides";
import { shareDeck, getSharedDeck } from "./routes/share";
import { listAssets, uploadAsset, deleteAsset } from "./routes/assets";
import { searchImages } from "./routes/image-search";
import {
  deckEvents,
  listDecks,
  getDeck,
  updateDeck,
  createDeck,
  deleteDeck,
} from "./routes/decks";
import { searchLogos, logoConfig } from "./routes/logo-search";
import { uploadFiles } from "./routes/uploads";
import { handleFeedback } from "./routes/feedback";

export async function createAppServer() {
  const { app, router } = createServer({ envKeys });

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

  // Example API routes
  router.get(
    "/api/ping",
    defineEventHandler((_event) => {
      const ping = process.env.PING_MESSAGE ?? "ping";
      return { message: ping };
    }),
  );

  router.get("/api/demo", handleDemo);

  // Image generation
  router.post("/api/image-gen/generate", generateImage);
  router.get("/api/image-gen/status", getImageGenStatus);

  // AI slide generation
  router.post("/api/generate-slides", generateSlides);

  // Sharing
  router.post("/api/share", shareDeck);
  router.get("/api/share/:token", getSharedDeck);

  // Asset library
  router.get("/api/assets", listAssets);
  router.post("/api/assets/upload", uploadAsset);
  router.delete("/api/assets/:filename", deleteAsset);

  // Image search
  router.get("/api/image-search", searchImages);

  // Logo search & config
  router.get("/api/logo/config", logoConfig);
  router.get("/api/logo/search", searchLogos);

  // File uploads (for prompt context)
  router.post("/api/uploads", uploadFiles);

  // Feedback
  router.post("/api/feedback", handleFeedback);

  // Decks CRUD (file-based)
  router.get("/api/decks/events", deckEvents);
  router.get("/api/decks", listDecks);
  router.get("/api/decks/:id", getDeck);
  router.put("/api/decks/:id", updateDeck);
  router.post("/api/decks", createDeck);
  router.delete("/api/decks/:id", deleteDeck);

  // Serve generated images from public/assets/generated
  const generatedDir = path.resolve(process.cwd(), "public/assets/generated");
  router.get(
    "/api/generated/**",
    defineEventHandler(async (event) => {
      const filename = event.path.replace("/api/generated/", "");
      const filepath = path.resolve(generatedDir, filename);
      if (!filepath.startsWith(generatedDir + path.sep)) {
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

  // Also serve from public/generated (used by image gen preview)
  const genPreviewDir = path.resolve(process.cwd(), "public/generated");
  router.get(
    "/api/gen-preview/**",
    defineEventHandler(async (event) => {
      const filename = event.path.replace("/api/gen-preview/", "");
      const filepath = path.resolve(genPreviewDir, filename);
      if (!filepath.startsWith(genPreviewDir + path.sep)) {
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

  // Serve preview HTML directly
  router.get(
    "/api/preview-images",
    defineEventHandler(async (event) => {
      const filepath = path.join(
        process.cwd(),
        "public/generated/preview.html",
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

  // File sync SSE (separate from deck-specific events at /api/decks/events)
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
