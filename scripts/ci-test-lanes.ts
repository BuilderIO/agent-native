#!/usr/bin/env node
/**
 * Split fast-test packages into balanced CI lanes. Full-suite runs deliberately
 * have NO change-based selection: every workspace test package runs when the
 * suite is selected, so a test can never be silently skipped. Targeted runs
 * resolve the dependency closure from CI_WORKSPACE_FILTERS, then shard the
 * concrete test packages in that closure. Docs-only PRs bypass this script and
 * use the focused docs job.
 * This script only decides which lane each package or Core test shard runs in,
 * purely to parallelise wall-clock.
 *
 * @agent-native/core is sharded across the normal CI lanes because it is the
 * largest test package. Every other test package is partitioned across those
 * same lanes. In both modes, the script asserts the partition covers all
 * selected test packages exactly once - if a package is dropped, the lane plan
 * fails rather than passing silently.
 *
 * Balance weight is each package's live fast-test file count, read from the tree
 * at run time — no hardcoded table, nothing to maintain.
 *
 * Runs on plain `node --experimental-strip-types` with zero dependencies so CI
 * can invoke it before `pnpm install`.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const CORE = "@agent-native/core"; // split into Vitest shards across the lanes
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

type PnpmWorkspace = {
  name?: unknown;
};

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

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function readTargetedFilters(): string[] | undefined {
  const raw = process.env.CI_WORKSPACE_FILTERS;
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) {
    throw new Error(
      "CI_WORKSPACE_FILTERS must be a non-empty JSON array of non-empty strings",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `CI_WORKSPACE_FILTERS must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((filter) => typeof filter !== "string" || filter.length === 0)
  ) {
    throw new Error(
      "CI_WORKSPACE_FILTERS must be a non-empty JSON array of non-empty strings",
    );
  }

  return parsed;
}

function resolveTestPackages(all: Pkg[], filters: string[] | undefined): Pkg[] {
  if (!filters) return all;

  const args = [
    "-r",
    "list",
    ...filters.flatMap((filter) => ["--filter", filter]),
    "--depth=-1",
    "--json",
  ];
  const output = execFileSync(pnpmCommand(), args, {
    encoding: "utf8",
  });

  let workspaces: unknown;
  try {
    workspaces = JSON.parse(output);
  } catch (error) {
    throw new Error(
      `pnpm list returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(workspaces)) {
    throw new Error("pnpm list did not return a workspace array");
  }

  const selectedNames = new Set(
    workspaces.map((workspace, index) => {
      const name =
        workspace && typeof workspace === "object"
          ? (workspace as PnpmWorkspace).name
          : undefined;
      if (typeof name !== "string" || name.length === 0) {
        throw new Error(
          `pnpm list returned an invalid workspace entry at index ${index}`,
        );
      }
      return name;
    }),
  );
  const packages = all.filter((pkg) => selectedNames.has(pkg.name));

  return packages;
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
  coreShard: string;
}

function splitWeight(total: number, index: number, count: number): number {
  const remainder = total % count;
  return Math.floor(total / count) + (index < remainder ? 1 : 0);
}

function partition(pkgs: Pkg[], laneCount: number, core?: Pkg): Lane[] {
  const weight = new Map<string, number>();
  for (const p of pkgs) weight.set(p.name, Math.max(1, countTestFiles(p.dir)));

  const n = core ? laneCount : Math.max(1, Math.min(laneCount, pkgs.length));
  const coreFiles = core ? Math.max(1, countTestFiles(core.dir)) : 0;
  const bins = Array.from({ length: n }, (_, index) => ({
    packages: [] as string[],
    files: core ? splitWeight(coreFiles, index, n) : 0,
    coreShard: core ? `${index + 1}/${n}` : "",
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
    .filter((b) => b.packages.length > 0 || b.coreShard !== "")
    .sort((a, b) => b.files - a.files)
    .map((b, i) => ({
      lane: `lane-${i + 1}`,
      filters: b.packages.map((p) => `--filter ${p}`).join(" "),
      packages: b.packages,
      files: b.files,
      coreShard: b.coreShard,
    }));
}

function assertFullCoverage(lanes: Lane[], expected: Pkg[], core?: Pkg): void {
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

  if (core) {
    const shards = lanes.map((lane) => lane.coreShard).filter(Boolean);
    if (
      shards.length !== lanes.length ||
      new Set(shards).size !== lanes.length
    ) {
      throw new Error("Core test shards are missing or duplicated");
    }
  }
}

function emit(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${key}=${value}\n`);
  else process.stdout.write(`${key}=${value}\n`);
}

function summarize(lanes: Lane[], coreFiles: number): void {
  const targeted = process.env.CI_WORKSPACE_FILTERS !== undefined;
  const lines = [
    `## Fast tests — ${targeted ? "targeted" : "full suite"}, sharded`,
    "",
    targeted && lanes.length === 0
      ? "No affected workspace has a test script; targeted fast tests are skipped."
      : targeted && coreFiles > 0
        ? `Every affected test package runs exactly once across ${lanes.length} balanced lanes; ${CORE} is Vitest-sharded.`
        : targeted
          ? `Every affected test package runs exactly once across ${lanes.length} balanced lanes.`
          : `Every test package runs. \`${CORE}\` is split across ${lanes.length} Vitest shards (${coreFiles} files); the rest share those balanced lanes.`,
    "",
    "| lane | test files | packages |",
    "| --- | ---: | --- |",
    ...lanes.map(
      (l) =>
        `| ${l.lane} | ${l.files} | ${[
          l.coreShard ? `${CORE} (${l.coreShard})` : "",
          ...l.packages,
        ]
          .filter(Boolean)
          .join(", ")} |`,
    ),
  ];
  const md = lines.join("\n");
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md + "\n");
  console.error(md);
}

function main(): void {
  const all = discoverTestPackages();
  const selected = resolveTestPackages(all, readTargetedFilters());
  const core = selected.find((p) => p.name === CORE);
  const rest = selected.filter((p) => p.name !== CORE);

  const lanes = partition(rest, LANES, core);
  assertFullCoverage(lanes, rest, core);

  emit("matrix", JSON.stringify({ include: lanes }));
  emit("has_tests", String(lanes.length > 0));
  summarize(lanes, core ? countTestFiles(core.dir) : 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
