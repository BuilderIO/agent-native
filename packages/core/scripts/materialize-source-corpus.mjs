#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageDir, "..", "..");
const corpusDir = join(packageDir, "corpus");

const excludedDirNames = new Set([
  ".agent-native",
  ".auth",
  ".cache",
  ".git",
  ".netlify",
  ".next",
  ".output",
  ".react-router",
  ".turbo",
  ".vercel",
  ".wrangler",
  "build",
  "coverage",
  "corpus",
  "dist",
  "node_modules",
  "playwright-report",
  "scratch",
  "target",
  "test-results",
  "tmp",
]);

const excludedFileNames = new Set([
  ".DS_Store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const excludedFileSuffixes = [
  ".db",
  ".db-journal",
  ".db-shm",
  ".db-wal",
  ".log",
  ".tsbuildinfo",
];

function shouldSkipFile(name) {
  if (excludedFileNames.has(name)) return true;
  if (name === ".env") return true;
  if (name === ".env.local") return true;
  if (/^\.env\..*\.local$/.test(name)) return true;
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(name)) return true;
  if (/\.e2e-host\.[cm]?[jt]sx?$/.test(name)) return true;
  return excludedFileSuffixes.some((suffix) => name.endsWith(suffix));
}

function shouldSkipRelativePath(relativePath) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => excludedDirNames.has(segment))) return true;
  const name = segments[segments.length - 1];
  return shouldSkipFile(name);
}

function listTrackedFiles(rootRel) {
  try {
    const output = execFileSync(
      "git",
      ["-C", repoRoot, "ls-files", "-z", "--", rootRel],
      { encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] },
    );
    return output
      .toString("utf-8")
      .split("\0")
      .filter(Boolean)
      .map((file) => file.split("\\").join("/"));
  } catch {
    return null;
  }
}

function listFilesystemFiles(absRoot, relRoot) {
  if (!existsSync(absRoot)) return [];
  const files = [];
  for (const entry of readdirSync(absRoot, { withFileTypes: true })) {
    const abs = join(absRoot, entry.name);
    const rel = `${relRoot}/${entry.name}`.split("\\").join("/");
    if (entry.isDirectory()) {
      if (excludedDirNames.has(entry.name)) continue;
      files.push(...listFilesystemFiles(abs, rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

function sourceFilesFor(rootRel) {
  const tracked = listTrackedFiles(rootRel);
  const files =
    tracked ?? listFilesystemFiles(join(repoRoot, rootRel), rootRel);
  return files.filter((file) => !shouldSkipRelativePath(file)).sort();
}

function copySourceFiles(rootRel, targetName) {
  const files = sourceFilesFor(rootRel);
  const prefix = `${rootRel}/`;
  let copied = 0;
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const relToRoot = file.slice(prefix.length);
    const sourcePath = join(repoRoot, file);
    if (!existsSync(sourcePath)) continue;
    if (!lstatSync(sourcePath).isFile()) continue;
    const targetPath = join(corpusDir, targetName, relToRoot);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    copied += 1;
  }
  return { files: copied };
}

function writeCorpusReadme(stats) {
  const lines = [
    "# Agent Native Source Corpus",
    "",
    "This directory is generated when `@agent-native/core` is built for npm.",
    "It gives coding agents a version-matched, searchable reference corpus",
    "inside installed apps at `node_modules/@agent-native/core/corpus`.",
    "",
    "## Contents",
    "",
    "- `core/` -- source and package files for `@agent-native/core`.",
    "- `templates/` -- source-only copies of first-party Agent Native templates.",
    "",
    "Runtime data, local env files, dependency folders, caches, tests, and build",
    "output are intentionally excluded. Use this corpus for framework APIs,",
    "reusable patterns, and template best practices; use the app's own files as",
    "the source of truth for app-specific behavior.",
    "",
    "## Lookup",
    "",
    "```bash",
    'pnpm action source-search --query "defineAction useActionQuery"',
    "pnpm action source-search --path templates/plan/AGENTS.md",
    'rg -n "defineAction|useActionQuery" node_modules/@agent-native/core/corpus',
    "```",
    "",
    "## Generated Counts",
    "",
    `- core files: ${stats.coreFiles}`,
    `- template files: ${stats.templateFiles}`,
    "",
  ];
  writeFileSync(join(corpusDir, "README.md"), lines.join("\n"));
}

export function materializeSourceCorpus() {
  rmSync(corpusDir, { recursive: true, force: true });
  mkdirSync(corpusDir, { recursive: true });

  const coreStats = copySourceFiles("packages/core", "core");
  const templateStats = copySourceFiles("templates", "templates");

  writeCorpusReadme({
    coreFiles: coreStats.files,
    templateFiles: templateStats.files,
  });

  const size = relative(packageDir, corpusDir);
  console.log(
    `[agent-native] Materialized source corpus at ${size} (${coreStats.files} core files, ${templateStats.files} template files).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  materializeSourceCorpus();
}
