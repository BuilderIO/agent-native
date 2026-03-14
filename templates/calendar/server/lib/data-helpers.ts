import fs from "fs";
import path from "path";

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(filePath: string, data: any): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function listJsonFiles<T>(dir: string): T[] {
  ensureDir(dir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const items: T[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      items.push(JSON.parse(content) as T);
    } catch {
      // Skip malformed files
    }
  }
  return items;
}

export function deleteJsonFile(filePath: string): boolean {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}
