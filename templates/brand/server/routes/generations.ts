import { Router } from "express";
import fs from "fs";
import path from "path";
import type { GenerationRecord } from "@shared/types.js";

const GENERATIONS_DIR = path.join(process.cwd(), "data", "generations");

export const generationsRouter = Router();

// GET /api/generations — list all generation records
generationsRouter.get("/", (_req, res) => {
  if (!fs.existsSync(GENERATIONS_DIR)) {
    res.json([]);
    return;
  }

  const files = fs.readdirSync(GENERATIONS_DIR).filter((f) => f.endsWith(".json"));
  const records: GenerationRecord[] = files
    .map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(GENERATIONS_DIR, f), "utf-8"));
      return data as GenerationRecord;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(records);
});

// GET /api/generations/:id — get a specific generation
generationsRouter.get("/:id", (req, res) => {
  const filePath = path.join(GENERATIONS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  res.json(data as GenerationRecord);
});

// DELETE /api/generations/:id — delete a generation and its images
generationsRouter.delete("/:id", (req, res) => {
  const id = req.params.id;
  const metaPath = path.join(GENERATIONS_DIR, `${id}.json`);
  if (!fs.existsSync(metaPath)) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }

  // Delete image files
  const record = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as GenerationRecord;
  for (const output of record.outputs) {
    const imgPath = path.join(GENERATIONS_DIR, output.filename);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }

  // Delete metadata
  fs.unlinkSync(metaPath);
  res.json({ deleted: true });
});
