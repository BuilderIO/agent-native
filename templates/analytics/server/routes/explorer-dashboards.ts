import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from "h3";
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

export const listExplorerDashboards = defineEventHandler((_event) => {
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
    return { dashboards };
  } catch (err: any) {
    setResponseStatus(_event, 500);
    return { error: err.message };
  }
});

export const getExplorerDashboard = defineEventHandler((event) => {
  ensureDir();
  const id = getRouterParam(event, "id");
  const filePath = path.join(DASHBOARD_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "Dashboard not found" };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { id, ...JSON.parse(raw) };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const saveExplorerDashboard = defineEventHandler(async (event) => {
  ensureDir();
  const id = getRouterParam(event, "id");
  const filePath = path.join(DASHBOARD_DIR, `${id}.json`);
  try {
    const body = await readBody(event);
    fs.writeFileSync(filePath, JSON.stringify(body, null, 2));
    return { id, success: true };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const deleteExplorerDashboard = defineEventHandler((event) => {
  ensureDir();
  const id = getRouterParam(event, "id");
  const filePath = path.join(DASHBOARD_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return { id, success: true };
});
