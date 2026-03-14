import { createServer } from "@agent-native/core";
import { envKeys } from "./lib/env-config.js";
import path from "path";
import express from "express";
import { handleDemo } from "./routes/demo";
import { generateImage, getImageGenStatus } from "./routes/image-gen";
import { generateSlides } from "./routes/generate-slides";
import { shareDeck, getSharedDeck } from "./routes/share";
import { assetsRouter } from "./routes/assets";
import { searchImages } from "./routes/image-search";
import { decksRouter } from "./routes/decks";
import { searchLogos, logoConfig } from "./routes/logo-search";
import { uploadsRouter } from "./routes/uploads";
import { handleFeedback } from "./routes/feedback";

export function createAppServer() {
  const app = createServer({ envKeys });

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  // Image generation
  app.post("/api/image-gen/generate", generateImage);
  app.get("/api/image-gen/status", getImageGenStatus);

  // AI slide generation
  app.post("/api/generate-slides", generateSlides);

  // Sharing
  app.post("/api/share", shareDeck);
  app.get("/api/share/:token", getSharedDeck);

  // Asset library
  app.use("/api/assets", assetsRouter);

  // Image search
  app.get("/api/image-search", searchImages);

  // Logo search & config
  app.get("/api/logo/config", logoConfig);
  app.get("/api/logo/search", searchLogos);

  // File uploads (for prompt context)
  app.use("/api/uploads", uploadsRouter);

  // Feedback
  app.post("/api/feedback", handleFeedback);

  // Decks CRUD (file-based)
  app.use("/api/decks", decksRouter);

  // Serve generated images from public/assets/generated
  app.use("/api/generated", express.static(path.join(process.cwd(), "public/assets/generated")));

  // Also serve from public/generated (used by image gen preview)
  app.use("/api/gen-preview", express.static(path.join(process.cwd(), "public/generated")));

  // Serve preview HTML directly
  app.get("/api/preview-images", (_req, res) => {
    res.sendFile(path.join(process.cwd(), "public/generated/preview.html"));
  });

  return app;
}
