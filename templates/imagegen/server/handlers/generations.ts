import fs from "fs";
import path from "path";
import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import type { Router } from "h3";
import type { GenerationRecord } from "@shared/types.js";

const GENERATIONS_DIR = path.join(process.cwd(), "data", "generations");

function isSafePath(base: string, ...segments: string[]): boolean {
  const resolved = path.resolve(base, ...segments);
  return resolved.startsWith(path.resolve(base));
}

export function registerGenerationsRoutes(router: Router) {
  router.get("/api/generations", listGenerations);
  router.get("/api/generations/:id", getGeneration);
  router.delete("/api/generations/:id", deleteGeneration);
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
  const id = getRouterParam(event, "id") ?? "";
  if (!isSafePath(GENERATIONS_DIR, `${id}.json`)) {
    setResponseStatus(event, 400);
    return { error: "Invalid id" };
  }
  const filePath = path.join(GENERATIONS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "Generation not found" };
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return data as GenerationRecord;
});

// DELETE /api/generations/:id — delete a generation and its images
export const deleteGeneration = defineEventHandler(async (event: H3Event) => {
  const id = getRouterParam(event, "id") ?? "";
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
