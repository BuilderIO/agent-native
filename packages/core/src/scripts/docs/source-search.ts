/**
 * Core script: source-search
 *
 * Search and read the packaged Agent Native source corpus.
 * The corpus is generated into @agent-native/core/corpus during package build.
 *
 * Usage:
 *   pnpm action source-search --query "defineAction"
 *   pnpm action source-search --path templates/plan/AGENTS.md
 *   pnpm action source-search --list
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "../../server/agents-bundle.js";
import { isValidPath, parseArgs } from "../utils.js";

interface SourceFile {
  relativePath: string;
  absolutePath: string;
}

const MAX_FILE_BYTES = 1_000_000;
const MAX_READ_CHARS = 40_000;
const MAX_RESULTS = 20;
const MAX_SNIPPETS_PER_FILE = 3;
const TEXT_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".cts",
  ".css",
  ".csv",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsonl",
  ".jsx",
  ".md",
  ".mdc",
  ".mdx",
  ".mjs",
  ".mts",
  ".plist",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
  ".zsh",
]);

function getCorpusRoot(): string {
  // Resolve from the package root:
  //   src/scripts/docs/source-search.ts -> corpus/
  //   dist/scripts/docs/source-search.js -> corpus/
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../corpus",
  );
}

function isProbablyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filePath);
  return (
    base === ".dockerignore" ||
    base === ".gitignore" ||
    base === ".ignore" ||
    base === ".npmignore" ||
    base === ".npmrc" ||
    base === ".prettierignore" ||
    base === ".prettierrc" ||
    base === ".taurignore" ||
    base === "AGENTS.md" ||
    base === "DEVELOPING.md" ||
    base === "README.md" ||
    base === "_gitignore" ||
    base === "_redirects" ||
    base === "package.json" ||
    base.startsWith(".env.example") ||
    base.startsWith(".prettier")
  );
}

function toCorpusRelativePath(
  corpusRoot: string,
  absolutePath: string,
): string {
  return path.relative(corpusRoot, absolutePath).split(path.sep).join("/");
}

function getSkillRootRelativePath(relativePath: string): string | null {
  const segments = relativePath.split("/").filter(Boolean);
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (
      (segments[index] === ".agents" || segments[index] === ".agent") &&
      segments[index + 1] === "skills"
    ) {
      return segments.slice(0, index + 3).join("/");
    }
  }
  return null;
}

function getSkillEntryRelativePath(skillRootRelativePath: string): string {
  return skillRootRelativePath.toLowerCase().endsWith(".md")
    ? skillRootRelativePath
    : `${skillRootRelativePath}/SKILL.md`;
}

function isRuntimeVisibleCorpusPath(
  corpusRoot: string,
  absolutePath: string,
): boolean {
  const relativePath = toCorpusRelativePath(corpusRoot, absolutePath);
  const skillRootRelativePath = getSkillRootRelativePath(relativePath);
  if (!skillRootRelativePath) return true;

  const skillEntryPath = path.join(
    corpusRoot,
    ...getSkillEntryRelativePath(skillRootRelativePath).split("/"),
  );
  if (!fs.existsSync(skillEntryPath)) return true;

  try {
    const raw = fs.readFileSync(skillEntryPath, "utf-8");
    return parseSkillFrontmatter(raw).scope !== "dev";
  } catch {
    return true;
  }
}

function listFiles(
  dir: string,
  base = dir,
  corpusRoot = getCorpusRoot(),
): SourceFile[] {
  if (!fs.existsSync(dir)) return [];
  const files: SourceFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (!isRuntimeVisibleCorpusPath(corpusRoot, abs)) continue;
    if (entry.isDirectory()) {
      files.push(...listFiles(abs, base, corpusRoot));
    } else if (entry.isFile() && isProbablyTextFile(abs)) {
      const stat = fs.statSync(abs);
      if (stat.size <= MAX_FILE_BYTES) {
        files.push({
          absolutePath: abs,
          relativePath: path.relative(base, abs).split(path.sep).join("/"),
        });
      }
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function lineSnippet(line: string, terms: string[]): string {
  const trimmed = line.trim();
  if (trimmed.length <= 220) return trimmed;
  const lower = trimmed.toLowerCase();
  const hit = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (hit ?? 0) - 80);
  const end = Math.min(trimmed.length, start + 220);
  return `${start > 0 ? "..." : ""}${trimmed.slice(start, end)}${
    end < trimmed.length ? "..." : ""
  }`;
}

function searchCorpus(query: string): Array<{
  file: string;
  score: number;
  snippets: string[];
}> {
  const corpusRoot = getCorpusRoot();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];

  const results: Array<{ file: string; score: number; snippets: string[] }> =
    [];
  for (const file of listFiles(corpusRoot)) {
    let raw = "";
    try {
      raw = fs.readFileSync(file.absolutePath, "utf-8");
    } catch {
      continue;
    }
    const lowerPath = file.relativePath.toLowerCase();
    const lowerRaw = raw.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (lowerPath.includes(term)) score += 8;
      const occurrences = lowerRaw.split(term).length - 1;
      score += Math.min(occurrences, 10);
    }
    if (score <= 0) continue;

    const snippets: string[] = [];
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const lowerLine = lines[index].toLowerCase();
      if (!terms.some((term) => lowerLine.includes(term))) continue;
      snippets.push(`${index + 1}: ${lineSnippet(lines[index], terms)}`);
      if (snippets.length >= MAX_SNIPPETS_PER_FILE) break;
    }

    results.push({ file: file.relativePath, score, snippets });
  }

  return results.sort(
    (a, b) => b.score - a.score || a.file.localeCompare(b.file),
  );
}

function readCorpusPath(relative: string): string {
  if (!isValidPath(relative)) {
    return `Invalid corpus path: ${relative}`;
  }
  const corpusRoot = getCorpusRoot();
  const target = path.resolve(corpusRoot, relative);
  if (!target.startsWith(corpusRoot + path.sep) && target !== corpusRoot) {
    return `Invalid corpus path: ${relative}`;
  }
  if (!fs.existsSync(target)) {
    return `Corpus path not found: ${relative}`;
  }
  if (!isRuntimeVisibleCorpusPath(corpusRoot, target)) {
    return `Corpus path is not available to runtime source-search: ${relative}`;
  }

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(target, { withFileTypes: true })
      .filter((entry) =>
        isRuntimeVisibleCorpusPath(corpusRoot, path.join(target, entry.name)),
      )
      .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
      .sort();
    const shown = entries.slice(0, 200);
    return [
      `# ${relative || "."}`,
      "",
      ...shown,
      entries.length > shown.length
        ? `... ${entries.length - shown.length} more entries`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (!stat.isFile()) return `Unsupported corpus path: ${relative}`;
  if (!isProbablyTextFile(target)) return `Not a text corpus file: ${relative}`;
  if (stat.size > MAX_FILE_BYTES) {
    return `Corpus file is too large to read through source-search: ${relative}`;
  }

  const raw = fs.readFileSync(target, "utf-8");
  if (raw.length <= MAX_READ_CHARS) return raw;
  return `${raw.slice(0, MAX_READ_CHARS)}\n\n... truncated at ${MAX_READ_CHARS} characters. Use a narrower path or direct rg for more context.`;
}

function listCorpus(): unknown {
  const corpusRoot = getCorpusRoot();
  const sections = ["core", "templates"];
  return sections.map((section) => {
    const sectionRoot = path.join(corpusRoot, section);
    const files = listFiles(sectionRoot);
    const children = fs.existsSync(sectionRoot)
      ? fs
          .readdirSync(sectionRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      : [];
    return {
      section,
      path: section,
      files: files.length,
      directories: children,
    };
  });
}

export default async function sourceSearchScript(
  args: string[],
): Promise<void> {
  const parsed = parseArgs(args);
  const corpusRoot = getCorpusRoot();

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action source-search [options]

Options:
  --query <text>    Search source corpus by keyword
  --path <path>     Read a corpus file or list a corpus directory
  --list            List corpus sections
  --help            Show this help message`);
    return;
  }

  if (!fs.existsSync(corpusRoot)) {
    console.log(
      `Source corpus not found at ${corpusRoot}. Build or reinstall @agent-native/core so node_modules/@agent-native/core/corpus exists.`,
    );
    return;
  }

  if (parsed.list === "true") {
    console.log(JSON.stringify(listCorpus(), null, 2));
    return;
  }

  if (parsed.path) {
    console.log(readCorpusPath(parsed.path));
    return;
  }

  if (parsed.query) {
    const results = searchCorpus(parsed.query);
    if (results.length === 0) {
      console.log(`No source files found matching "${parsed.query}".`);
      return;
    }
    console.log(
      `Found ${results.length} source file(s) matching "${parsed.query}":\n`,
    );
    for (const result of results.slice(0, MAX_RESULTS)) {
      console.log(`${result.file}  (score ${result.score})`);
      for (const snippet of result.snippets) {
        console.log(`  ${snippet}`);
      }
      console.log("");
    }
    console.log("Use --path <file> to read a specific corpus file.");
    return;
  }

  console.log("Provide --query, --path, or --list. Use --help for details.");
}
