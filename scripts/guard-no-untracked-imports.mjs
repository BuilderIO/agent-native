#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  execGuardCommand,
} from "./lib/changed-lines.mjs";

const SOURCE_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_RE = /(^|\/)(?:node_modules|dist|build|\.output|\.nitro|corpus)\//;

const GENERATED_RE = /(^|\/)\.generated\//;

const IMPORT_RE =
  /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*["'](\.[^"']+)["']|(?:^|[^\w.])import\s*\(\s*["'](\.[^"']+)["']/g;

const CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function git(args) {
  return execGuardCommand("git", args, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
}

// Repo-relative paths (`file`, `resolved`, the `tracked` set) always use "/",
// because that is how `git ls-files` reports them, on every OS. Only the
// filesystem reads join them onto `repoRoot` with the OS-specific `path`.
export function resolveImport(repoRoot, fromFile, specifier) {
  const base = path.posix.join(path.posix.dirname(fromFile), specifier);
  const rewritten = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
  for (const stem of base === rewritten ? [base] : [rewritten, base]) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = `${stem}${suffix}`;
      const absolute = path.join(repoRoot, candidate);
      if (existsSync(absolute) && statSync(absolute).isFile()) return candidate;
    }
    for (const suffix of CANDIDATE_SUFFIXES.slice(1)) {
      const candidate = path.posix.join(stem, `index${suffix}`);
      const absolute = path.join(repoRoot, candidate);
      if (existsSync(absolute) && statSync(absolute).isFile()) return candidate;
    }
  }
  return undefined;
}

/**
 * A deployment that overlays this repo's packages from a pinned checkout keeps
 * those files out of its own git, so imports into them look untracked. It lists
 * the overlaid source roots in this file. Absent upstream; build output is
 * never a root, since nothing guarantees it exists.
 */
export const PROVIDED_ROOTS_FILE =
  "guard-allowlists/untracked-import-roots.json";

export function readProvidedRoots(repoRoot) {
  const file = path.join(repoRoot, PROVIDED_ROOTS_FILE);
  if (!existsSync(file)) return [];
  const roots = JSON.parse(readFileSync(file, "utf8"));
  if (
    !Array.isArray(roots) ||
    roots.some(
      (root) =>
        typeof root !== "string" ||
        !root.endsWith("/") ||
        root.startsWith("/") ||
        root.split("/").includes("..") ||
        SKIP_RE.test(root),
    )
  ) {
    throw new Error(
      `${PROVIDED_ROOTS_FILE} must be a JSON array of repo-relative source directories ending in "/", outside node_modules and build output.`,
    );
  }
  return roots;
}

export function findUntrackedImports(repoRoot, tracked, providedRoots = []) {
  const violations = [];
  for (const file of tracked) {
    if (!SOURCE_RE.test(file) || SKIP_RE.test(file)) continue;
    let source;
    try {
      source = readFileSync(path.join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    if (
      !source.includes('from ".') &&
      !source.includes("from '.") &&
      !source.includes("import(")
    ) {
      continue;
    }
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const resolved = resolveImport(repoRoot, file, specifier);
      if (!resolved || tracked.has(resolved)) continue;
      if (providedRoots.some((root) => resolved.startsWith(root))) continue;
      if (GENERATED_RE.test(resolved)) continue;
      violations.push({ file, specifier, resolved });
    }
  }
  return violations;
}

function main() {
  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  const tracked = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
  let providedRoots;
  try {
    providedRoots = readProvidedRoots(repoRoot);
  } catch (error) {
    console.error(`guard-no-untracked-imports: ${error.message}`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
  const violations = findUntrackedImports(repoRoot, tracked, providedRoots);

  if (violations.length > 0) {
    console.error("guard-no-untracked-imports failed:");
    for (const { file, specifier, resolved } of violations) {
      console.error(
        `  - ${file} imports "${specifier}" -> ${resolved} (exists on disk, NOT tracked by git)`,
      );
    }
    console.error(
      "\nThe importing file would fail to build for anyone who does not have the\n" +
        "untracked file. Usually a .gitignore rule silently excluded it: check the\n" +
        "nearest .gitignore, add a negation, and `git add -f` the module.",
    );
    process.exit(1);
  }

  console.log(
    `guard-no-untracked-imports: clean (${tracked.size} tracked files scanned).`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
