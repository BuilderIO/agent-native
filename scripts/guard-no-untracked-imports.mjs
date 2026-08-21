#!/usr/bin/env node
/**
 * A tracked source file must not import a relative module that Git does not
 * track.
 *
 * `packages/docs/.gitignore` ignores `server/*` and re-admits directories one
 * at a time (`!server/routes/`, `!server/plugins/`). A new `server/lib/`
 * module was therefore silently left out of a commit while the two route files
 * importing it were committed, so `main` carried an unresolvable import and the
 * docs build would have failed on the next deploy. Nothing caught it: the file
 * was present and working on every developer's disk, and `git status` never
 * listed it because it was ignored, not untracked-and-pending.
 *
 * Ignore rules are the failure mode this guard exists for, so it deliberately
 * inspects the whole repository rather than the branch diff — a stale ignore
 * pattern can strand a file that an older commit added.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SOURCE_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_RE = /(^|\/)(?:node_modules|dist|build|\.output|\.nitro|corpus)\//;

// Written by the build, deliberately untracked, and regenerated before any
// consumer compiles. Only hand-authored modules are this guard's business.
const GENERATED_RE = /(^|\/)\.generated\//;

// `import x from "./y"`, `export * from "../y"`, `await import("./y")`.
const IMPORT_RE =
  /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*["'](\.[^"']+)["']|(?:^|[^\w.])import\s*\(\s*["'](\.[^"']+)["']/g;

// TypeScript source is imported with the compiled specifier, so `./x.js` on
// disk is `./x.ts`. Try the written path first, then the source twins.
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
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
}

const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
const tracked = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));

function resolveImport(fromFile, specifier) {
  const base = path.join(path.dirname(fromFile), specifier);
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
  // Unresolvable here means a type-only path, a virtual module, or an alias —
  // not this guard's business. Resolution failure is never reported as a
  // violation, so a miss stays silent rather than becoming a false alarm.
  return undefined;
}

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
    const resolved = resolveImport(file, specifier);
    if (!resolved || tracked.has(resolved)) continue;
    if (GENERATED_RE.test(resolved)) continue;
    violations.push({ file, specifier, resolved });
  }
}

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
