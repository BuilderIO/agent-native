import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from "h3";
import fs from "fs";
import path from "path";

const CONFIG_DIR = path.join(
  import.meta.dirname,
  "../../data/explorer-configs",
);

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export const listExplorerConfigs = defineEventHandler((_event) => {
  ensureDir();
  try {
    const files = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".json"));
    const configs = files.map((f) => {
      const raw = fs.readFileSync(path.join(CONFIG_DIR, f), "utf8");
      const data = JSON.parse(raw);
      return {
        id: f.replace(".json", ""),
        name: data.name ?? f.replace(".json", ""),
        ...data,
      };
    });
    return { configs };
  } catch (err: any) {
    setResponseStatus(_event, 500);
    return { error: err.message };
  }
});

export const getExplorerConfig = defineEventHandler((event) => {
  ensureDir();
  const id = getRouterParam(event, "id");
  const filePath = path.join(CONFIG_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "Config not found" };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { id, ...JSON.parse(raw) };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const saveExplorerConfig = defineEventHandler(async (event) => {
  ensureDir();
  const id = getRouterParam(event, "id");
  const filePath = path.join(CONFIG_DIR, `${id}.json`);
  try {
    const body = await readBody(event);
    fs.writeFileSync(filePath, JSON.stringify(body, null, 2));
    return { id, success: true };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const deleteExplorerConfig = defineEventHandler((event) => {
  ensureDir();
  const id = getRouterParam(event, "id");
  const filePath = path.join(CONFIG_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return { id, success: true };
});
