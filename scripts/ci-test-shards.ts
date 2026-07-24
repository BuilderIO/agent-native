#!/usr/bin/env node
/**
 * Compute which workspace packages need testing for a change, and pack them into
 * balanced parallel CI shards.
 *
 * Correctness contract (this must never under-select):
 *   - A changed file is attributed to the *longest* matching workspace package
 *     directory. Its tests, plus the tests of every package that transitively
 *     depends on it, are selected.
 *   - Any changed file that does not map into a single workspace package (repo
 *     root files, scripts/, tsconfig, lockfile, CI, unknown paths, ...) forces a
 *     FULL run. Only an explicit, provably-inert ignore list (changesets, docs,
 *     editor config) is exempt.
 *   - When the diff can't be trusted (missing, empty, or --full), run FULL.
 *
 * The dependency graph is built from workspace: deps, so a change to a shared
 * package (e.g. @agent-native/core) fans out to all dependents automatically.
 *
 * Runs on plain `node` (Node >= 22 strips types) with zero dependencies so CI
 * can invoke it before `pnpm install`.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Shard balance uses each package's live fast-test *file count* as its weight —
// counted from the working tree at run time, never a hardcoded table, so it
// auto-adapts as tests are added and needs no maintenance. It is only a balance
// hint; it never decides what runs. File count is a coarse proxy for time (an
// import-heavy file costs more than a trivial one), which is fine: full runs are
// rare (most PRs are affected-only) and the nightly full run is unsharded.
const TEST_FILE_RE = /\.(test|spec)\.(c|m)?[jt]sx?$/;
const SLOW_FILE_RE =
  /\.(db\.test|integration\.spec|integration\.test|e2e\.spec|e2e\.test|live\.spec|live\.test|perf\.spec|perf\.test)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  ".nitro",
  ".output",
  "coverage",
  "e2e", // excluded from fast tests via **/e2e/**
]);

// Top-level directories that hold workspace packages. Discovery scans these one
// level deep (plus the known nested template packages). A directory that is NOT
// found here is treated as "outside every package" and forces a full run, so a
// missing entry fails safe (over-runs) rather than skipping tests.
const PACKAGE_PARENTS = ["packages", "examples", "templates"];
const NESTED_TEMPLATE_DIRS = ["desktop", "chrome-extension"];

// Provably test-inert paths. A change limited to these never forces a full run
// and never selects a package. Keep this list conservative: only add a pattern
// once you are certain no vitest test can read it as an input.
const IGNORE = [
  /^\.changeset\//,
  /^\.vscode\//,
  /^\.idea\//,
  /^\.git\//,
  /^\.gitignore$/,
  /^\.gitattributes$/,
  /^LICENSE$/i,
  /^[^/]+\.md$/, // top-level markdown docs (README, CLAUDE, CHANGELOG, ...)
  /^\.agents\//, // agent skills/instructions — not test inputs
];

interface Pkg {
  name: string;
  dir: string; // repo-relative, posix
  hasTest: boolean;
  deps: Set<string>; // workspace dependency names
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

function discoverPackages(): Map<string, Pkg> {
  const dirs: string[] = [];
  for (const parent of PACKAGE_PARENTS) {
    const abs = path.join(ROOT, parent);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.posix.join(parent, entry.name);
      dirs.push(dir);
      // Known nested workspace packages (templates/<t>/desktop|chrome-extension).
      if (parent === "templates") {
        for (const nested of NESTED_TEMPLATE_DIRS) {
          const nestedAbs = path.join(ROOT, dir, nested);
          if (existsSync(path.join(nestedAbs, "package.json"))) {
            dirs.push(path.posix.join(dir, nested));
          }
        }
      }
    }
  }

  const byName = new Map<string, Pkg>();
  const nameByDir = new Map<string, string>();
  const rawDeps = new Map<string, Record<string, string>>();

  for (const dir of dirs) {
    const pjPath = path.join(ROOT, dir, "package.json");
    if (!existsSync(pjPath)) continue;
    const pj = readJson(pjPath);
    if (!pj.name) continue;
    if (byName.has(pj.name)) {
      throw new Error(
        `Duplicate workspace package name ${pj.name} (${byName.get(pj.name)!.dir} and ${dir}); shard filtering keys on name.`,
      );
    }
    byName.set(pj.name, {
      name: pj.name,
      dir,
      hasTest: Boolean(pj.scripts?.test),
      deps: new Set(),
    });
    nameByDir.set(dir, pj.name);
    rawDeps.set(pj.name, {
      ...pj.dependencies,
      ...pj.devDependencies,
      ...pj.peerDependencies,
      ...pj.optionalDependencies,
    });
  }

  // Edge name -> dep when the dep resolves to another workspace member.
  for (const [name, deps] of rawDeps) {
    const pkg = byName.get(name)!;
    for (const depName of Object.keys(deps)) {
      if (byName.has(depName) && depName !== name) pkg.deps.add(depName);
    }
  }

  return byName;
}

/** Longest-prefix match of a repo-relative file to a package dir. */
function packageForFile(file: string, pkgs: Map<string, Pkg>): Pkg | undefined {
  let best: Pkg | undefined;
  for (const pkg of pkgs.values()) {
    if (file === pkg.dir || file.startsWith(pkg.dir + "/")) {
      if (!best || pkg.dir.length > best.dir.length) best = pkg;
    }
  }
  return best;
}

/** All packages that (transitively) depend on any package in `seed`. */
function withDependents(
  seed: Set<string>,
  pkgs: Map<string, Pkg>,
): Set<string> {
  const dependents = new Map<string, Set<string>>();
  for (const pkg of pkgs.values()) {
    for (const dep of pkg.deps) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep)!.add(pkg.name);
    }
  }
  const out = new Set(seed);
  const queue = [...seed];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const dep of dependents.get(cur) ?? []) {
      if (!out.has(dep)) {
        out.add(dep);
        queue.push(dep);
      }
    }
  }
  return out;
}

interface Selection {
  mode: "full" | "affected";
  reasons: string[]; // why full, or which packages changed
  selected: Pkg[]; // test-having packages to run
}

function selectPackages(
  changedFiles: string[] | null,
  pkgs: Map<string, Pkg>,
  forceFull: boolean,
): Selection {
  const testPkgs = [...pkgs.values()].filter((p) => p.hasTest);

  if (forceFull || !changedFiles || changedFiles.length === 0) {
    return {
      mode: "full",
      reasons: [forceFull ? "forced full (no trusted diff)" : "empty diff"],
      selected: testPkgs,
    };
  }

  const changedPkgNames = new Set<string>();
  const fullReasons: string[] = [];
  for (const file of changedFiles) {
    if (!file) continue;
    if (IGNORE.some((re) => re.test(file))) continue;
    const pkg = packageForFile(file, pkgs);
    if (pkg) {
      changedPkgNames.add(pkg.name);
    } else {
      fullReasons.push(file);
    }
  }

  if (fullReasons.length > 0) {
    return {
      mode: "full",
      reasons: [
        `${fullReasons.length} change(s) outside any package -> full run`,
        ...fullReasons.slice(0, 15),
      ],
      selected: testPkgs,
    };
  }

  const affectedAll = withDependents(changedPkgNames, pkgs);
  const selected = testPkgs.filter((p) => affectedAll.has(p.name));
  return {
    mode: "affected",
    reasons: [
      `changed packages: ${[...changedPkgNames].sort().join(", ") || "(none)"}`,
    ],
    selected,
  };
}

const countCache = new Map<string, number>();

function countTestFiles(dir: string): number {
  let n = 0;
  const stack = [path.join(ROOT, dir)];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path.join(cur, entry.name));
      } else if (
        entry.isFile() &&
        TEST_FILE_RE.test(entry.name) &&
        !SLOW_FILE_RE.test(entry.name)
      ) {
        n += 1;
      }
    }
  }
  return n;
}

// Weight = fast-test file count; floor of 1 so a package is never weightless.
function costOf(pkg: Pkg): number {
  if (!countCache.has(pkg.dir)) {
    countCache.set(pkg.dir, Math.max(1, countTestFiles(pkg.dir)));
  }
  return countCache.get(pkg.dir)!;
}

interface Shard {
  shard: string;
  filters: string;
  packages: string[];
  weight: number;
}

function packShards(selected: Pkg[], shardCount: number): Shard[] {
  if (selected.length === 0) return [];
  const n = Math.max(1, Math.min(shardCount, selected.length));
  const bins = Array.from({ length: n }, () => ({
    packages: [] as string[],
    weight: 0,
  }));
  const sorted = [...selected].sort((a, b) => costOf(b) - costOf(a));
  for (const pkg of sorted) {
    bins.sort((a, b) => a.weight - b.weight);
    bins[0].packages.push(pkg.name);
    bins[0].weight += costOf(pkg);
  }
  return bins
    .filter((b) => b.packages.length > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((b, i) => ({
      shard:
        b.packages.length === 1 ? shortLabel(b.packages[0]) : `group-${i + 1}`,
      filters: b.packages.map((p) => `--filter ${p}`).join(" "),
      packages: b.packages,
      weight: Math.round(b.weight),
    }));
}

function shortLabel(name: string): string {
  return name.replace(/^@agent-native\//, "").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function parseArgs(argv: string[]) {
  let full = false;
  let changedFile: string | undefined;
  let shards = Number(process.env.SHARDS || 7);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--full") full = true;
    else if (a === "--changed-file") changedFile = argv[++i];
    else if (a === "--shards") shards = Number(argv[++i]);
    else if (a.startsWith("--shards="))
      shards = Number(a.slice("--shards=".length));
  }
  return { full, changedFile, shards };
}

function main() {
  const { full, changedFile, shards } = parseArgs(process.argv.slice(2));

  let changed: string[] | null = null;
  if (!full) {
    if (changedFile && existsSync(changedFile)) {
      changed = readFileSync(changedFile, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } else if (process.env.CHANGED_FILES) {
      changed = process.env.CHANGED_FILES.split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    }
  }

  const pkgs = discoverPackages();
  const forceFull = full || changed === null;
  const sel = selectPackages(changed, pkgs, forceFull);
  const shardsOut = packShards(sel.selected, shards);
  const run = shardsOut.length > 0;

  // Machine outputs for the workflow.
  const matrix = { include: shardsOut };
  emitGithubOutput("run", String(run));
  emitGithubOutput("mode", sel.mode);
  emitGithubOutput("matrix", JSON.stringify(matrix));

  // Human summary.
  const lines: string[] = [];
  lines.push(`## Fast tests — ${sel.mode.toUpperCase()} run`);
  lines.push("");
  for (const r of sel.reasons) lines.push(`- ${r}`);
  lines.push("");
  if (run) {
    lines.push(
      `Packages selected: **${sel.selected.length}** across **${shardsOut.length}** shard(s)`,
    );
    lines.push("");
    lines.push("| shard | test files | packages |");
    lines.push("| --- | ---: | --- |");
    for (const s of shardsOut) {
      lines.push(`| ${s.shard} | ${s.weight} | ${s.packages.join(", ")} |`);
    }
  } else {
    lines.push("No test-bearing packages affected — nothing to run.");
  }
  const summary = lines.join("\n");
  emitStepSummary(summary);
  console.error(summary);
}

function emitGithubOutput(key: string, value: string) {
  const out = process.env.GITHUB_OUTPUT;
  const line = value.includes("\n")
    ? `${key}<<__EOF__\n${value}\n__EOF__\n`
    : `${key}=${value}\n`;
  if (out) appendFileSync(out, line);
  else process.stdout.write(line);
}

function emitStepSummary(md: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md + "\n");
}

main();
