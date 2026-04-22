import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { writeFileSync } from "node:fs";

const CORE_SRC = join(import.meta.dirname, "../../core/src");
const OUTPUT = join(import.meta.dirname, "../public/source-index.json");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "__tests__"]);
const EXTENSIONS = new Set([".ts", ".tsx"]);
const MAX_FILE_SIZE = 50_000;

interface SourceEntry {
  path: string;
  content: string;
}

async function walkDir(dir: string, base: string): Promise<SourceEntry[]> {
  const entries: SourceEntry[] = [];
  const items = await readdir(dir, { withFileTypes: true });

  for (const item of items) {
    if (SKIP_DIRS.has(item.name) || item.name.startsWith(".")) continue;
    const fullPath = join(dir, item.name);

    if (item.isDirectory()) {
      entries.push(...(await walkDir(fullPath, base)));
    } else if (EXTENSIONS.has(item.name.slice(item.name.lastIndexOf(".")))) {
      const info = await stat(fullPath);
      if (info.size > MAX_FILE_SIZE) continue;

      const content = await readFile(fullPath, "utf-8");
      entries.push({
        path: relative(base, fullPath),
        content,
      });
    }
  }

  return entries;
}

async function main() {
  console.log(`Indexing source files from ${CORE_SRC}...`);
  const entries = await walkDir(CORE_SRC, CORE_SRC);
  console.log(`Indexed ${entries.length} source files`);

  writeFileSync(OUTPUT, JSON.stringify(entries));
  console.log(`Written to ${OUTPUT}`);
}

main().catch(console.error);
