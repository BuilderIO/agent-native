import {
  createServer,
  createFileWatcher,
  createSSEHandler,
} from "@agent-native/core/server";
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

function paramToPath(param: string | string[] | undefined): string {
  if (!param) return "";
  return Array.isArray(param) ? param.join("/") : param;
}

export function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

  app.get("/api/files", async (_req, res) => {
    try {
      const files = await getFileTree("./data");
      res.json(files);
    } catch {
      res.json([]);
    }
  });

  app.get("/api/files/*filepath", async (req, res) => {
    const relativePath = paramToPath(req.params.filepath);
    const filePath = path.join("./data", relativePath);
    try {
      const content = await readFile(filePath, "utf-8");
      res.json({ path: relativePath, content });
    } catch {
      res.status(404).json({ error: "File not found" });
    }
  });

  app.put("/api/files/*filepath", async (req, res) => {
    const relativePath = paramToPath(req.params.filepath);
    const filePath = path.join("./data", relativePath);
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, req.body.content, "utf-8");
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to write file" });
    }
  });

  app.get("/api/events", createSSEHandler(watcher));

  return app;
}

async function getFileTree(dir: string, prefix = ""): Promise<any[]> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.name.startsWith(".")) continue;

    if (entry.isDirectory()) {
      const children = await getFileTree(path.join(dir, entry.name), relativePath);
      results.push({ name: entry.name, path: relativePath, type: "directory", children });
    } else {
      const fileStat = await stat(path.join(dir, entry.name));
      results.push({
        name: entry.name,
        path: relativePath,
        type: "file",
        size: fileStat.size,
        modified: fileStat.mtime.toISOString(),
      });
    }
  }

  return results;
}
