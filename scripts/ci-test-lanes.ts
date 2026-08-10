#!/usr/bin/env node
/**
 * Split the full fast-test suite into balanced CI lanes. There is deliberately
 * NO change-based selection here: every workspace test package runs on every
 * PR, so a test can never be silently skipped. This script only decides which
 * lane each package runs in, purely to parallelise wall-clock.
 *
 * @agent-native/core is handled by its own dedicated CI job (isolated so it can
 * run uncapped), so it is excluded here. Every OTHER test package is partitioned
 * across the lanes, and the script asserts the partition covers all of them
 * exactly once — if a new package is added it lands in a lane automatically, and
 * a bug that dropped one would fail this job rather than pass silently.
 *
 * Balance weight is each package's live fast-test file count, read from the tree
 * at run time — no hardcoded table, nothing to maintain.
 *
 * Runs on plain `node --experimental-strip-types` with zero dependencies so CI
 * can invoke it before `pnpm install`.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CORE = "@agent-native/core"; // isolated in its own CI job
const LANES = Math.max(1, Number(process.env.LANES || 5));

// Must track the package globs in pnpm-workspace.yaml. A package under a glob
// not listed here would be missed, so keep this in sync when workspaces change.
const PACKAGE_PARENTS = ["packages", "examples", "templates"];
const NESTED_TEMPLATE_DIRS = ["desktop", "chrome-extension"];

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

interface Pkg {
  name: string;
  dir: string;
}

function discoverTestPackages(): Pkg[] {
  const out: Pkg[] = [];
  const dirs: string[] = [];
  for (const parent of PACKAGE_PARENTS) {
    const abs = path.join(ROOT, parent);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.posix.join(parent, entry.name);
      dirs.push(dir);
      if (parent === "templates") {
        for (const nested of NESTED_TEMPLATE_DIRS) {
          if (existsSync(path.join(ROOT, dir, nested, "package.json"))) {
            dirs.push(path.posix.join(dir, nested));
          }
        }
      }
    }
  }
  const seen = new Set<string>();
  for (const dir of dirs) {
    const pjPath = path.join(ROOT, dir, "package.json");
    if (!existsSync(pjPath)) continue;
    const pj = JSON.parse(readFileSync(pjPath, "utf8"));
    if (!pj.name || !pj.scripts?.test) continue;
    if (seen.has(pj.name)) {
      throw new Error(`Duplicate workspace package name ${pj.name}`);
    }
    seen.add(pj.name);
    out.push({ name: pj.name, dir });
  }
  return out;
}

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

interface Lane {
  lane: string;
  filters: string;
  packages: string[];
  files: number;
}

function partition(pkgs: Pkg[], laneCount: number): Lane[] {
  const weight = new Map<string, number>();
  for (const p of pkgs) weight.set(p.name, Math.max(1, countTestFiles(p.dir)));

  const n = Math.max(1, Math.min(laneCount, pkgs.length));
  const bins = Array.from({ length: n }, () => ({
    packages: [] as string[],
    files: 0,
  }));
  // Greedy: heaviest first into the currently-lightest bin.
  for (const p of [...pkgs].sort(
    (a, b) => weight.get(b.name)! - weight.get(a.name)!,
  )) {
    bins.sort((a, b) => a.files - b.files);
    bins[0].packages.push(p.name);
    bins[0].files += weight.get(p.name)!;
  }
  return bins
    .filter((b) => b.packages.length > 0)
    .sort((a, b) => b.files - a.files)
    .map((b, i) => ({
      lane: `lane-${i + 1}`,
      filters: b.packages.map((p) => `--filter ${p}`).join(" "),
      packages: b.packages,
      files: b.files,
    }));
}

function assertFullCoverage(lanes: Lane[], expected: Pkg[]): void {
  const covered = new Set<string>();
  for (const lane of lanes) {
    for (const name of lane.packages) {
      if (covered.has(name)) {
        throw new Error(`Package ${name} assigned to more than one lane`);
      }
      covered.add(name);
    }
  }
  const missing = expected
    .filter((p) => !covered.has(p.name))
    .map((p) => p.name);
  if (missing.length > 0) {
    throw new Error(`Packages missing from all lanes: ${missing.join(", ")}`);
  }
}

function emit(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${key}=${value}\n`);
  else process.stdout.write(`${key}=${value}\n`);
}

function summarize(lanes: Lane[], coreFiles: number): void {
  const lines = [
    "## Fast tests — full suite, sharded",
    "",
    `Every test package runs. \`${CORE}\` runs on its own uncapped lane (${coreFiles} files); the rest are split across ${lanes.length} balanced lanes.`,
    "",
    "| lane | test files | packages |",
    "| --- | ---: | --- |",
    `| core | ${coreFiles} | ${CORE} |`,
    ...lanes.map(
      (l) => `| ${l.lane} | ${l.files} | ${l.packages.join(", ")} |`,
    ),
  ];
  const md = lines.join("\n");
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md + "\n");
  console.error(md);
}

function main(): void {
  const all = discoverTestPackages();
  const core = all.find((p) => p.name === CORE);
  const rest = all.filter((p) => p.name !== CORE);

  const lanes = partition(rest, LANES);
  assertFullCoverage(lanes, rest);

  emit("matrix", JSON.stringify({ include: lanes }));
  summarize(lanes, core ? countTestFiles(core.dir) : 0);
}

main();
