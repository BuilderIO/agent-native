import fs from "node:fs";
import path from "node:path";
import type { ActionTool } from "../../agent/types.js";
import { parseArgs } from "../utils.js";

const MAX_DEPTH = 3;
const MAX_ENTRIES = 500;

export const tool: ActionTool = {
  description:
    "List files and directories. Returns a tree-style listing. Use recursive=true to show nested contents (up to 3 levels deep).",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Directory path relative to the project root (default: ".")',
      },
      recursive: {
        type: "string",
        description: 'Set to "true" to list recursively (max 3 levels)',
      },
    },
  },
};

function listDir(
  dirPath: string,
  prefix: string,
  depth: number,
  results: string[],
): void {
  if (depth > MAX_DEPTH || results.length >= MAX_ENTRIES) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort: directories first, then files, alphabetical within each
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  // Skip common non-useful directories
  const skip = new Set([
    "node_modules",
    ".git",
    ".next",
    ".output",
    "dist",
    ".cache",
    ".turbo",
  ]);

  for (const entry of entries) {
    if (results.length >= MAX_ENTRIES) {
      results.push(`${prefix}... (truncated at ${MAX_ENTRIES} entries)`);
      return;
    }
    if (skip.has(entry.name)) continue;

    const isDir = entry.isDirectory();
    results.push(`${prefix}${isDir ? entry.name + "/" : entry.name}`);

    if (isDir && depth < MAX_DEPTH) {
      listDir(
        path.join(dirPath, entry.name),
        prefix + "  ",
        depth + 1,
        results,
      );
    }
  }
}

export async function run(args: Record<string, string>): Promise<string> {
  const dirPath = args.path || ".";
  const recursive = args.recursive === "true";
  const resolved = path.resolve(process.cwd(), dirPath);

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return `Error: ${dirPath} is not a directory`;
    }
  } catch (err: any) {
    if (err?.code === "ENOENT") return `Error: Directory not found: ${dirPath}`;
    return `Error: ${err?.message ?? String(err)}`;
  }

  const results: string[] = [];
  if (recursive) {
    listDir(resolved, "", 0, results);
  } else {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      results.push(entry.isDirectory() ? entry.name + "/" : entry.name);
    }
  }

  return `${dirPath}/\n${results.join("\n")}`;
}

export default async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  console.log(await run(parsed));
}
