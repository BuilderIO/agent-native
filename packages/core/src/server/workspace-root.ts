import fs from "node:fs";
import path from "node:path";

export function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function findWorkspaceRoot(startDir = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const pkg = readJson(path.join(dir, "package.json"));
    if (typeof pkg?.["agent-native"]?.workspaceCore === "string") {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
