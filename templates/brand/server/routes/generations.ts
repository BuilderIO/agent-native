import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  sendStream,
  setResponseHeader,
  type H3Event,
} from "h3";
import type { Router } from "h3";
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import type { GenerationRecord } from "@shared/types.js";

const GENERATIONS_DIR = path.join(process.cwd(), "data", "generations");

function isSafePath(base: string, ...segments: string[]): boolean {
  const resolved = path.resolve(base, ...segments);
  return resolved.startsWith(path.resolve(base));
}

// GET /api/generations — list all generation records
export const listGenerations = defineEventHandler(async (_event: H3Event) => {
  if (!fs.existsSync(GENERATIONS_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(GENERATIONS_DIR)
    .filter((f) => f.endsWith(".json"));
  const records: GenerationRecord[] = files
    .map((f) => {
      const data = JSON.parse(
        fs.readFileSync(path.join(GENERATIONS_DIR, f), "utf-8"),
      );
      return data as GenerationRecord;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  return records;
});

// GET /api/generations/:id — get a specific generation
export const getGeneration = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  if (!isSafePath(GENERATIONS_DIR, `${id}.json`)) {
    setResponseStatus(event, 400);
    return { error: "Invalid id" };
  }
  const filePath = path.join(GENERATIONS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "Generation not found" };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as GenerationRecord;
});

// DELETE /api/generations/:id — delete a generation and its images
export const deleteGeneration = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") as string;
  if (!isSafePath(GENERATIONS_DIR, `${id}.json`)) {
    setResponseStatus(event, 400);
    return { error: "Invalid id" };
  }
  const metaPath = path.join(GENERATIONS_DIR, `${id}.json`);
  if (!fs.existsSync(metaPath)) {
    setResponseStatus(event, 404);
    return { error: "Generation not found" };
  }

  // Delete image files
  const record = JSON.parse(
    fs.readFileSync(metaPath, "utf-8"),
  ) as GenerationRecord;
  for (const output of record.outputs) {
    const imgPath = path.join(GENERATIONS_DIR, output.filename);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }

  // Delete metadata
  fs.unlinkSync(metaPath);
  return { deleted: true };
});

// GET /api/generated/** — serve static generated image files
export const serveGeneratedFile = defineEventHandler(
  async (event: H3Event) => {
    const filePath = event.path.replace("/api/generated/", "");
    const fullPath = path.join(GENERATIONS_DIR, filePath);
    if (!isSafePath(GENERATIONS_DIR, filePath)) {
      setResponseStatus(event, 400);
      return { error: "Invalid path" };
    }
    try {
      await stat(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
      };
      const mimeType = mimeMap[ext] ?? "application/octet-stream";
      setResponseHeader(event, "Content-Type", mimeType);
      setResponseHeader(event, "Cache-Control", "public, max-age=3600");
      return sendStream(event, createReadStream(fullPath));
    } catch {
      setResponseStatus(event, 404);
      return { error: "Not found" };
    }
  },
);

export function registerGenerationsRoutes(router: Router) {
  router.get("/api/generations", listGenerations);
  router.get("/api/generations/:id", getGeneration);
  router.delete("/api/generations/:id", deleteGeneration);
  router.get("/api/generated/**", serveGeneratedFile);
}
