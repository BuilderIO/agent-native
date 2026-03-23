import fs from "node:fs";
import path from "node:path";
import type { ScriptTool } from "../../agent/types.js";
import { parseArgs } from "../utils.js";

const MAX_RESULTS = 100;
const MAX_LINE_LEN = 200;

export const tool: ScriptTool = {
  description:
    "Search file contents for a text pattern (case-insensitive). Returns matching lines with file paths and line numbers.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Text pattern to search for",
      },
      path: {
        type: "string",
        description: 'Directory to search in (default: ".")',
      },
      glob: {
        type: "string",
        description: 'File extension filter, e.g. "ts" or "tsx" (without dot)',
      },
    },
    required: ["pattern"],
  },
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".output",
  "dist",
  ".cache",
  ".turbo",
  ".pnpm",
]);

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".mp3",
  ".zip",
  ".gz",
  ".tar",
  ".db",
  ".sqlite",
  ".pdf",
]);

function walkFiles(
  dir: string,
  ext: string | undefined,
  files: string[],
): void {
  if (files.length >= MAX_RESULTS * 10) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkFiles(full, ext, files);
    } else if (entry.isFile()) {
      const entryExt = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTS.has(entryExt)) continue;
      if (ext && entryExt !== `.${ext}`) continue;
      files.push(full);
    }
  }
}

export async function run(args: Record<string, string>): Promise<string> {
  const pattern = args.pattern;
  if (!pattern) return "Error: pattern is required";

  const searchDir = path.resolve(process.cwd(), args.path || ".");
  const ext = args.glob?.replace(/^\./, "");
  const cwd = process.cwd();

  const files: string[] = [];
  walkFiles(searchDir, ext, files);

  const results: string[] = [];
  const lowerPattern = pattern.toLowerCase();

  for (const file of files) {
    if (results.length >= MAX_RESULTS) break;

    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= MAX_RESULTS) break;
      if (lines[i].toLowerCase().includes(lowerPattern)) {
        const relPath = path.relative(cwd, file);
        let line = lines[i];
        if (line.length > MAX_LINE_LEN)
          line = line.slice(0, MAX_LINE_LEN) + "...";
        results.push(`${relPath}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  if (results.length === 0) {
    return `No matches found for "${pattern}"`;
  }

  const header =
    results.length >= MAX_RESULTS
      ? `Found ${MAX_RESULTS}+ matches for "${pattern}" (showing first ${MAX_RESULTS}):`
      : `Found ${results.length} match${results.length === 1 ? "" : "es"} for "${pattern}":`;

  return `${header}\n${results.join("\n")}`;
}

export default async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed.pattern) {
    console.error(
      "Usage: search-files --pattern <text> [--path <dir>] [--glob ts]",
    );
    process.exit(1);
  }
  console.log(await run(parsed));
}
