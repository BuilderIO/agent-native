import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".netlify",
  ".vercel",
  ".wrangler",
  ".react-router",
  ".generated",
  ".claude",
  "out",
  "coverage",
]);

export function* walk(
  dir: string,
  skipDirs: Set<string> = DEFAULT_SKIP_DIRS,
): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      yield* walk(full, skipDirs);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export function lineColForOffset(
  contents: string,
  offset: number,
): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (contents.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

export function isCommentLine(lineText: string): boolean {
  const trimmed = lineText.trimStart();
  return (
    trimmed.startsWith("*") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*")
  );
}

export function relPosix(root: string, file: string): string {
  return path.relative(root, file).replaceAll("\\", "/");
}

export function readFileSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function isExtraExempt(
  rel: string,
  extraExemptPaths: string[] | undefined,
): boolean {
  if (!extraExemptPaths || extraExemptPaths.length === 0) return false;
  return extraExemptPaths.includes(rel);
}
