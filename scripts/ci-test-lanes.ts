#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isDocsPath,
  isInstructionPath,
  normalizeChangedPath,
} from "./ci-change-scope.ts";

const ROOT = process.cwd();
const CORE = "@agent-native/core";
const LANES = Math.max(1, Number(process.env.LANES || 5));
// Each lane pays ~100 s of checkout and install, so a shard smaller than this
// spends more time on setup than it saves.
const MIN_SHARD_FILES = 100;

const PACKAGE_PARENTS = ["packages", "templates"];
const COMMUNITY_TEMPLATES_PARENT = "community-templates";
const NESTED_TEMPLATE_DIRS = ["desktop", "chrome-extension"];
const CORE_FORCE_FULL_TEST_PATHS = new Set([
  "packages/core/src/vitest-config.ts",
  "packages/core/vitest.config.ts",
  "vitest.shared.ts",
]);
const FAST_TEST_EXCLUDES = [
  "**/*.db.test.ts",
  "**/*.integration.spec.ts",
  "**/*.integration.test.ts",
  "**/*.e2e.spec.ts",
  "**/*.e2e.test.ts",
  "**/e2e/**",
  "**/*.live.spec.ts",
  "**/*.live.test.ts",
  "**/*.perf.spec.ts",
  "**/*.perf.test.ts",
  "**/create-e2e.spec.ts",
] as const;

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
  shardable: boolean;
}

interface WeightedPkg {
  name: string;
  files: number;
  shardable?: boolean;
}

interface LaneItem {
  name: string;
  files: number;
  shard?: string;
}

type PnpmWorkspace = {
  name?: unknown;
};

function discoverTestPackages(includeCommunityTemplates: boolean): Pkg[] {
  const out: Pkg[] = [];
  const dirs: string[] = [];
  const parents = includeCommunityTemplates
    ? [...PACKAGE_PARENTS, COMMUNITY_TEMPLATES_PARENT]
    : PACKAGE_PARENTS;
  for (const parent of parents) {
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
    // Only a bare Vitest script forwards `--shard` to the runner.
    const shardable = /^vitest(\s|$)/.test(pj.scripts.test);
    out.push({ name: pj.name, dir, shardable });
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

function weighPackages(pkgs: readonly Pkg[]): WeightedPkg[] {
  return pkgs.map((pkg) => ({
    name: pkg.name,
    files: Math.max(1, countTestFiles(pkg.dir)),
    shardable: pkg.shardable,
  }));
}

export function requiresFullCoreFastTests(paths: readonly string[]): boolean {
  return paths.some((path) => {
    const normalized = normalizeChangedPath(path);
    if (CORE_FORCE_FULL_TEST_PATHS.has(normalized)) return true;
    // Core tests read bundled skills and instructions from disk, outside the
    // module graph `vitest --changed` follows.
    if (isInstructionPath(normalized)) return true;
    if (!normalized.startsWith("packages/core/") || isDocsPath(normalized)) {
      return false;
    }
    return (
      !/\.(?:[cm]?[jt]sx?)$/u.test(normalized) ||
      /\.d\.(?:[cm]?ts)$/u.test(normalized)
    );
  });
}

function readCoreFastTestFiles(since?: string): string[] {
  const args = ["--filter", CORE, "exec", "vitest", "list", "--dir", "src"];
  if (since) args.push("--changed", since);
  args.push("--filesOnly", "--json", "--passWithNoTests");
  for (const exclude of FAST_TEST_EXCLUDES) {
    args.push("--exclude", exclude);
  }

  const output = execFileSync(pnpmCommand(), args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  let result: unknown;
  try {
    result = JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Vitest returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(result)) {
    throw new Error("Vitest did not return a test-file array");
  }

  return [
    ...new Set(
      result.map((entry, index) => {
        const file =
          entry && typeof entry === "object"
            ? (entry as { file?: unknown }).file
            : undefined;
        if (typeof file !== "string" || file.length === 0) {
          throw new Error(
            `Vitest returned an invalid test-file entry at index ${index}`,
          );
        }
        const coreRoot = path.join(ROOT, "packages/core");
        const absolute = path.isAbsolute(file)
          ? file
          : path.resolve(coreRoot, file);
        const relative = path.relative(coreRoot, absolute);
        if (!relative.startsWith(`src${path.sep}`)) {
          throw new Error(
            `Vitest returned a test file outside Core src: ${file}`,
          );
        }
        return relative.split(path.sep).join(path.posix.sep);
      }),
    ),
  ];
}

function readChangedPaths(baseSha: string): string[] {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "-z", `${baseSha}...HEAD`],
    { encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
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

interface PackageShard {
  name: string;
  shard: string;
}

interface Lane {
  lane: string;
  filters: string;
  packages: string[];
  packageShards: PackageShard[];
  files: number;
  coreShard: string;
  coreMode: "changed" | "full" | "";
}

function splitWeight(total: number, index: number, count: number): number {
  const remainder = total % count;
  return Math.floor(total / count) + (index < remainder ? 1 : 0);
}

function partition(pkgs: Pkg[], laneCount: number, core?: Pkg): Lane[] {
  return partitionWeighted(
    weighPackages(pkgs),
    laneCount,
    core ? Math.max(1, countTestFiles(core.dir)) : null,
  );
}

/**
 * Split each shardable package heavier than a fair lane share into Vitest
 * shards, so one large template no longer sets the floor for every lane.
 */
export function splitLargePackages(
  pkgs: readonly WeightedPkg[],
  laneCount: number,
  coreFiles: number,
): LaneItem[] {
  const total = coreFiles + pkgs.reduce((sum, pkg) => sum + pkg.files, 0);
  const fairShare = Math.max(1, Math.ceil(total / laneCount));
  return pkgs.flatMap((pkg) => {
    const count = pkg.shardable
      ? Math.min(
          laneCount,
          Math.ceil(pkg.files / fairShare),
          Math.floor(pkg.files / MIN_SHARD_FILES),
        )
      : 1;
    if (count < 2) return [{ name: pkg.name, files: pkg.files }];
    return Array.from({ length: count }, (_, index) => ({
      name: pkg.name,
      files: splitWeight(pkg.files, index, count),
      shard: `${index + 1}/${count}`,
    }));
  });
}

/**
 * Balance packages across lanes by test file count, with core Vitest-sharded
 * across them. An unshardable package can't be split, so the heaviest items
 * may each take a lane of their own while core shards across the rest; the
 * plan with the smallest largest lane wins. Stacking a core shard on top of
 * Design made one lane outrun the job timeout while the others finished early.
 */
export function partitionWeighted(
  pkgs: readonly WeightedPkg[],
  laneCount: number,
  coreFiles: number | null,
): Lane[] {
  const sorted = splitLargePackages(pkgs, laneCount, coreFiles ?? 0).sort(
    (a, b) => b.files - a.files,
  );
  const maxSolo =
    coreFiles === null ? 0 : Math.min(laneCount - 1, sorted.length);
  let best: LaneBin[] | null = null;
  for (let solo = 0; solo <= maxSolo; solo++) {
    const bins = planBins(sorted, laneCount, coreFiles, solo);
    if (!best || largestBin(bins) < largestBin(best)) best = bins;
  }
  return toLanes(best!, "full");
}

export function partitionTargetedWeighted(
  pkgs: readonly WeightedPkg[],
  laneCount: number,
  coreFiles: number,
  coreMode: "changed" | "full",
  coreTestFiles: readonly string[] = [],
): Lane[] {
  if (coreMode === "changed" && coreFiles !== coreTestFiles.length) {
    throw new Error("Changed core test count does not match its file list");
  }
  if (coreFiles === 0) return partitionWeighted(pkgs, laneCount, null);

  const sorted = splitLargePackages(pkgs, laneCount, coreFiles).sort(
    (a, b) => b.files - a.files,
  );
  const coreShardCount = Math.min(laneCount, coreFiles);
  const count = Math.min(laneCount, Math.max(coreShardCount, sorted.length));
  const bins: LaneBin[] = Array.from({ length: count }, (_, index) => ({
    items: [],
    files:
      index < coreShardCount
        ? splitWeight(coreFiles, index, coreShardCount)
        : 0,
    coreShard: index < coreShardCount ? `${index + 1}/${coreShardCount}` : "",
  }));

  for (const item of sorted) {
    const lightest = bins.reduce((best, bin) =>
      bin.files < best.files ? bin : best,
    );
    lightest.items.push(item);
    lightest.files += item.files;
  }

  return toLanes(bins, coreMode);
}

interface LaneBin {
  items: LaneItem[];
  files: number;
  coreShard: string;
}

function largestBin(bins: LaneBin[]): number {
  return Math.max(...bins.map((bin) => bin.files));
}

function planBins(
  sorted: readonly LaneItem[],
  laneCount: number,
  coreFiles: number | null,
  soloCount: number,
): LaneBin[] {
  const shared = sorted.slice(soloCount);
  const n =
    coreFiles !== null
      ? laneCount - soloCount
      : Math.max(1, Math.min(laneCount, shared.length));
  const sharedBins: LaneBin[] = Array.from({ length: n }, (_, index) => ({
    items: [],
    files: coreFiles !== null ? splitWeight(coreFiles, index, n) : 0,
    coreShard: coreFiles !== null ? `${index + 1}/${n}` : "",
  }));
  for (const item of shared) {
    sharedBins.sort((a, b) => a.files - b.files);
    sharedBins[0].items.push(item);
    sharedBins[0].files += item.files;
  }
  return [
    ...sorted
      .slice(0, soloCount)
      .map((item) => ({ items: [item], files: item.files, coreShard: "" })),
    ...sharedBins,
  ];
}

function toLanes(bins: LaneBin[], coreMode: "changed" | "full"): Lane[] {
  return bins
    .filter((b) => b.items.length > 0 || b.coreShard !== "")
    .sort((a, b) => b.files - a.files)
    .map((b, i) => {
      const packages = b.items
        .filter((item) => !item.shard)
        .map((item) => item.name);
      return {
        lane: `lane-${i + 1}`,
        filters: packages.map((p) => `--filter ${p}`).join(" "),
        packages,
        packageShards: b.items.flatMap((item) =>
          item.shard ? [{ name: item.name, shard: item.shard }] : [],
        ),
        files: b.files,
        coreShard: b.coreShard,
        coreMode: b.coreShard ? coreMode : "",
      };
    });
}

function isCompleteShardSet(shards: readonly string[]): boolean {
  const count = Number(shards[0]?.split("/")[1] ?? 0);
  return (
    count > 0 &&
    shards.length === count &&
    Array.from({ length: count }, (_, index) => `${index + 1}/${count}`).every(
      (shard) => shards.includes(shard),
    )
  );
}

export function assertFullCoverage(
  lanes: Lane[],
  expected: ReadonlyArray<{ name: string }>,
  core?: unknown,
): void {
  const covered = new Set<string>();
  const packageShards = new Map<string, string[]>();
  for (const lane of lanes) {
    for (const name of lane.packages) {
      if (covered.has(name)) {
        throw new Error(`Package ${name} assigned to more than one lane`);
      }
      covered.add(name);
    }
    for (const { name, shard } of lane.packageShards) {
      packageShards.set(name, [...(packageShards.get(name) ?? []), shard]);
    }
  }
  for (const [name, shards] of packageShards) {
    if (covered.has(name) || !isCompleteShardSet(shards)) {
      throw new Error(`Package ${name} test shards are missing or duplicated`);
    }
    covered.add(name);
  }
  const missing = expected
    .filter((p) => !covered.has(p.name))
    .map((p) => p.name);
  if (missing.length > 0) {
    throw new Error(`Packages missing from all lanes: ${missing.join(", ")}`);
  }

  if (
    core &&
    !isCompleteShardSet(lanes.map((lane) => lane.coreShard).filter(Boolean))
  ) {
    throw new Error("Core test shards are missing or duplicated");
  }
}

function emit(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${key}=${value}\n`);
  else process.stdout.write(`${key}=${value}\n`);
}

function summarize(
  lanes: Lane[],
  coreFiles: number,
  coreMode: Lane["coreMode"],
): void {
  const targeted = process.env.CI_WORKSPACE_FILTERS !== undefined;
  const coreShards = lanes.filter((lane) => lane.coreShard).length;
  const lines = [
    `## Fast tests — ${targeted ? "targeted" : "full suite"}, sharded`,
    "",
    targeted && lanes.length === 0
      ? "No affected workspace has a test script; targeted fast tests are skipped."
      : targeted && coreFiles > 0
        ? `Every affected test package runs exactly once across ${lanes.length} balanced lanes; ${CORE} has ${coreFiles} ${coreMode === "changed" ? "changed" : "full-suite"} fast-test files across ${coreShards} Vitest shards.`
        : targeted
          ? `Every affected test package runs exactly once across ${lanes.length} balanced lanes.`
          : `Every test package runs. \`${CORE}\` is split across ${coreShards} Vitest shards (${coreFiles} files); the rest share those balanced lanes.`,
    "",
    "| lane | test files | packages |",
    "| --- | ---: | --- |",
    ...lanes.map(
      (l) =>
        `| ${l.lane} | ${l.files} | ${[
          l.coreShard ? `${CORE} (${l.coreShard})` : "",
          ...l.packageShards.map(({ name, shard }) => `${name} (${shard})`),
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
  const filters = readTargetedFilters();
  const targeted = filters !== undefined;
  const all = discoverTestPackages(targeted);
  const selected = resolveTestPackages(all, filters);
  const core = all.find((p) => p.name === CORE);
  const rest = selected.filter((p) => p.name !== CORE);

  let coreFiles = 0;
  let coreTestFiles: string[] = [];
  let coreMode: Lane["coreMode"] = "";
  let lanes: Lane[];
  if (targeted) {
    const baseSha = process.env.CI_BASE_SHA;
    if (!baseSha) {
      throw new Error(
        "CI_BASE_SHA is required when targeted tests are planned",
      );
    }
    const fullCore = requiresFullCoreFastTests(readChangedPaths(baseSha));
    coreMode = fullCore ? "full" : "changed";
    coreTestFiles = readCoreFastTestFiles(fullCore ? undefined : baseSha);
    coreFiles = coreTestFiles.length;
    lanes = partitionTargetedWeighted(
      weighPackages(rest),
      LANES,
      coreFiles,
      coreMode,
      fullCore ? [] : coreTestFiles,
    );
  } else {
    coreFiles = core ? countTestFiles(core.dir) : 0;
    coreMode = core ? "full" : "";
    lanes = partition(rest, LANES, targeted ? undefined : core);
  }
  assertFullCoverage(lanes, rest, core && coreFiles > 0 ? core : null);

  emit("matrix", JSON.stringify({ include: lanes }));
  emit("has_tests", String(lanes.length > 0));
  emit(
    "core_test_files",
    JSON.stringify(coreMode === "changed" ? coreTestFiles : []),
  );
  summarize(lanes, coreFiles, coreMode);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
