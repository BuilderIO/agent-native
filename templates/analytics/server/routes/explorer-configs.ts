import { RequestHandler } from "express";
import fs from "fs";
import path from "path";

const CONFIG_DIR = path.join(import.meta.dirname, "../../data/explorer-configs");

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export const listExplorerConfigs: RequestHandler = (_req, res) => {
  ensureDir();
  try {
    const files = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".json"));
    const configs = files.map((f) => {
      const raw = fs.readFileSync(path.join(CONFIG_DIR, f), "utf8");
      const data = JSON.parse(raw);
      return { id: f.replace(".json", ""), name: data.name ?? f.replace(".json", ""), ...data };
    });
    res.json({ configs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getExplorerConfig: RequestHandler = (req, res) => {
  ensureDir();
  const id = req.params.id;
  const filePath = path.join(CONFIG_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    res.json({ id, ...JSON.parse(raw) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const saveExplorerConfig: RequestHandler = (req, res) => {
  ensureDir();
  const id = req.params.id;
  const filePath = path.join(CONFIG_DIR, `${id}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
    res.json({ id, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteExplorerConfig: RequestHandler = (req, res) => {
  ensureDir();
  const id = req.params.id;
  const filePath = path.join(CONFIG_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  res.json({ id, success: true });
};
