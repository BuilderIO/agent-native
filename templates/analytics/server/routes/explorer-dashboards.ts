import { RequestHandler } from "express";
import fs from "fs";
import path from "path";

const DASHBOARD_DIR = path.join(
  import.meta.dirname,
  "../../data/explorer-dashboards",
);

function ensureDir() {
  if (!fs.existsSync(DASHBOARD_DIR)) {
    fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
  }
}

export const listExplorerDashboards: RequestHandler = (_req, res) => {
  ensureDir();
  try {
    const files = fs
      .readdirSync(DASHBOARD_DIR)
      .filter((f) => f.endsWith(".json"));
    const dashboards = files.map((f) => {
      const raw = fs.readFileSync(path.join(DASHBOARD_DIR, f), "utf8");
      const data = JSON.parse(raw);
      return { id: f.replace(".json", ""), ...data };
    });
    res.json({ dashboards });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getExplorerDashboard: RequestHandler = (req, res) => {
  ensureDir();
  const id = req.params.id;
  const filePath = path.join(DASHBOARD_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Dashboard not found" });
    return;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    res.json({ id, ...JSON.parse(raw) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const saveExplorerDashboard: RequestHandler = (req, res) => {
  ensureDir();
  const id = req.params.id;
  const filePath = path.join(DASHBOARD_DIR, `${id}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
    res.json({ id, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteExplorerDashboard: RequestHandler = (req, res) => {
  ensureDir();
  const id = req.params.id;
  const filePath = path.join(DASHBOARD_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  res.json({ id, success: true });
};
