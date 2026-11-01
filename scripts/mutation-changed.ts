#!/usr/bin/env tsx
/**
 * Mutation-test the packages/core source lines this branch added. Stryker
 * mutates only those lines (`--mutate file:start-end`) and runs the specs named
 * after each mutated file, from packages/core where its config lives.
 * Stryker itself is installed on demand under .tmp/stryker.
 *
 * Exit codes follow the guard contract: 0 passed (or no in-scope lines were
 * added), 1 the mutation score is under the break threshold or a mutated
 * file has no spec named after or importing it, 2 could not run
 * (base unresolvable, Stryker crashed or was misconfigured, no report).
 *
 *   pnpm mutation:changed
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  diffBaseCommit,
  requireAddedLines,
} from "./lib/changed-lines.mjs";
import { isMutationScopePath } from "./lib/mutation-scope.ts";
import {
  aggregateShardReceipts,
  createShardReceipt,
} from "./lib/mutation-shard-reports.ts";
import { parseMutationShard } from "./lib/mutation-shard-runner.mts";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CORE_DIR = "packages/core";
const CORE_ROOT = path.join(REPO_ROOT, CORE_DIR);
const REPORT_DIR = path.join(CORE_ROOT, "reports", "mutation");
const REPORT_PATH = path.join(REPORT_DIR, "mutation.json");

// Stryker stays out of the workspace lockfile on purpose: as a workspace
// dependency its @babel/core 8 became the peer that pnpm resolved for the
// react-native/metro Babel 7 plugins in packages/mobile-app and the templates.
const STRYKER_VERSION = "10.1.1";
const STRYKER_DIR = path.join(REPO_ROOT, ".tmp", "stryker", STRYKER_VERSION);
const STRYKER_BIN = path.join(STRYKER_DIR, "node_modules", ".bin", "stryker");

/**
 * Installs Stryker into its own directory and points its vitest peer at the
 * project's vitest, so the runner drives the same vitest the tests use.
 */
function installStryker(withVitestPeer = true): string | null {
  if (!existsSync(STRYKER_BIN)) {
    mkdirSync(STRYKER_DIR, { recursive: true });
    writeFileSync(
      path.join(STRYKER_DIR, "package.json"),
      `${JSON.stringify({ private: true }, null, 2)}\n`,
    );
    const install = spawnSync(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--legacy-peer-deps",
        `@stryker-mutator/core@${STRYKER_VERSION}`,
        `@stryker-mutator/vitest-runner@${STRYKER_VERSION}`,
      ],
      { cwd: STRYKER_DIR, stdio: "inherit" },
    );
    if (install.status !== 0 || !existsSync(STRYKER_BIN)) {
      return `npm install of Stryker ${STRYKER_VERSION} failed (exit ${install.status ?? install.signal})`;
    }
  }
  if (!withVitestPeer) return null;
  let vitest: string;
  try {
    vitest = realpathSync(path.join(CORE_ROOT, "node_modules", "vitest"));
  } catch {
    return "packages/core/node_modules/vitest is missing; run pnpm install first";
  }
  const link = path.join(STRYKER_DIR, "node_modules", "vitest");
  rmSync(link, { recursive: true, force: true });
  symlinkSync(vitest, link, "dir");
  return null;
}

type Mutant = {
  status: string;
  mutatorName: string;
  replacement: string;
  location: { start: { line: number; column: number } };
};
type MutationReport = { files: Record<string, { mutants: Mutant[] }> };

/** Merges sorted line numbers into inclusive [start, end] runs. */
export function contiguousRanges(lines: readonly number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges;
}

/** One `--mutate` entry per contiguous run of added lines in Core source. */
export function mutateSpecs(
  added: ReadonlyMap<string, ReadonlySet<number>>,
): string[] {
  const specs: string[] = [];
  for (const [absolute, lines] of [...added].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const repoPath = path
      .relative(REPO_ROOT, absolute)
      .split(path.sep)
      .join("/");
    if (!isMutationScopePath(repoPath)) continue;
    const corePath = path.posix.relative(CORE_DIR, repoPath);
    for (const [start, end] of contiguousRanges([...lines])) {
      specs.push(`${corePath}:${start}-${end}`);
    }
  }
  return specs;
}

export function survivingMutants(report: MutationReport): string[] {
  const survivors: string[] = [];
  for (const [file, { mutants }] of Object.entries(report.files)) {
    for (const mutant of mutants) {
      if (mutant.status !== "Survived" && mutant.status !== "NoCoverage") {
        continue;
      }
      const { line, column } = mutant.location.start;
      survivors.push(
        `${CORE_DIR}/${file}:${line}:${column}  ${mutant.status}  ${mutant.mutatorName}: ${mutant.replacement}`,
      );
    }
  }
  return survivors;
}

const VITEST_CONFIG = "vitest.mutation.generated.mts";
const TEST_FILE = /\.(spec|test)\.tsx?$/;
// Mirrors the fast-test lanes' --exclude list in ci.yml: these specs need a
// database or other service the mutation job does not start.
const SERVICE_TEST_FILE =
  /\.(?:integration|e2e|live|perf)\.(?:spec|test)\.tsx?$|\.db\.test\.tsx?$/;

/** The file part of a `file:start-end` spec. */
function specFile(spec: string): string {
  const colon = spec.lastIndexOf(":");
  if (colon === -1) throw new Error(`mutation spec has no line range: ${spec}`);
  return spec.slice(0, colon);
}

const SOURCE_FILE = /\.tsx?$/;

/** Whether a spec such as `index.browser.spec.ts` names a sibling module (`index.browser.ts`). */
function namesSiblingSource(
  spec: string,
  base: string,
  sources: ReadonlySet<string>,
): boolean {
  const stem = spec.replace(/\.(?:spec|test)\.tsx?$/, "");
  if (stem === base) return false;
  return sources.has(`${stem}.ts`) || sources.has(`${stem}.tsx`);
}

/** Whether `text` imports `./<base>` statically, re-exports it, or imports it dynamically. */
function importsModule(text: string, base: string): boolean {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const target = `\\./${escaped}(?:\\.jsx?|\\.tsx?)?["']`;
  const trivia = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*`;
  return new RegExp(
    `(?:\\bfrom|\\bimport)\\s*["']${target}|\\bimport\\s*\\(${trivia}["']${target}`,
  ).test(text);
}

const SOURCE_TEXT_READ =
  /new URL\(\s*["'][^"']+\.tsx?["']\s*,\s*import\.meta\.url/;
// The harness resolves the monorepo's `templates/` from its own location; the
// sandbox holds only Core, so a spec importing it dies on ENOENT.
const REPO_ROOT_HARNESS = /advertised-catalog\.harness/;
const RELATIVE_SPECIFIER =
  /(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;
const RELATIVE_FILE_URL =
  /\bnew\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url/g;

/**
 * Whether a spec can run against Stryker's sandbox copy of Core. A spec that
 * reads a source file's text sees the instrumented rewrite, and a relative
 * import that leaves Core (`../../../agentkit/src/...`) does not resolve from
 * the sandbox; either fails the dry run, which aborts every mutant.
 * Self-imports of `@agent-native/core/*` resolve through the sandbox's
 * package.json exports to its `dist/`, so stryker.config.json must not list
 * `/dist` in `ignorePatterns`.
 */
function runsInSandbox(text: string, directory: string): boolean {
  if (SOURCE_TEXT_READ.test(text) || REPO_ROOT_HARNESS.test(text)) return false;
  for (const [, specifier] of text.matchAll(RELATIVE_SPECIFIER)) {
    if (specifier === undefined) continue;
    if (path.posix.join(directory, specifier).startsWith("../")) return false;
  }
  for (const [, specifier] of text.matchAll(RELATIVE_FILE_URL)) {
    if (specifier === undefined) continue;
    if (path.posix.join(directory, specifier).startsWith("../")) return false;
  }
  return true;
}

/**
 * The specs that exercise each mutated file, relative to Core. The first
 * choice is a spec named after the file: for `src/a2a/task-store.ts`,
 * `task-store.spec.ts` and `task-store.db.spec.ts` in the same directory. A
 * dash extends the module name, so `task-store-lifecycle.spec.ts` names a
 * `task-store-lifecycle` module and is not counted. Only when no such spec
 * exists does a same-directory spec or test count, if its text imports or
 * re-exports `./task-store` (optionally `.js` or `.ts`). `readFile` takes a
 * path relative to Core and must throw on failure: an empty string would look
 * like a spec that does not import the module. Specs that cannot run in the
 * sandbox, or that need a service (`*.integration.spec.ts` and the other
 * fast-test exclusions), are never selected. Returns the mutated files with
 * no such spec under `missing`.
 */
export function namedSpecs(
  specs: readonly string[],
  listDirectory: (directory: string) => readonly string[],
  readFile: (file: string) => string,
): { include: string[]; missing: string[] } {
  const include = new Set<string>();
  const missing: string[] = [];
  const files = [...new Set(specs.map(specFile))].sort();
  for (const file of files) {
    const directory = path.posix.dirname(file);
    const base = path.posix.basename(file).replace(/\.tsx?$/, "");
    const entries = listDirectory(directory);
    // `index.browser.spec.ts` beside `index.browser.ts` is that module's spec,
    // not `index.ts`'s, so a variant naming a sibling source file is skipped.
    const sources = new Set(
      entries.filter(
        (entry) => SOURCE_FILE.test(entry) && !TEST_FILE.test(entry),
      ),
    );
    const tests = entries
      .filter(
        (entry) => TEST_FILE.test(entry) && !SERVICE_TEST_FILE.test(entry),
      )
      .map((entry) => ({ entry, text: readFile(`${directory}/${entry}`) }))
      .filter(({ text }) => runsInSandbox(text, directory));
    let selected = tests
      .filter(
        ({ entry }) =>
          entry.startsWith(`${base}.`) &&
          !namesSiblingSource(entry, base, sources),
      )
      .map(({ entry }) => entry);
    if (selected.length === 0) {
      selected = tests
        .filter(({ text }) => importsModule(text, base))
        .map(({ entry }) => entry);
    }
    if (selected.length === 0) missing.push(file);
    for (const entry of selected) include.add(`${directory}/${entry}`);
  }
  return { include: [...include].sort(), missing };
}

/**
 * Mutants run against the specs named after their file rather than vitest's
 * import-graph `related` set or the whole directory. Those reach unrelated
 * specs (worker builds, docs scans) that cannot run inside Stryker's sandbox
 * copy, and one failing dry-run test aborts the whole run.
 */
function writeVitestConfig(specs: readonly string[]): string | null {
  const { include, missing } = namedSpecs(
    specs,
    (directory) => readdirSync(path.join(CORE_ROOT, directory)),
    (file) => readFileSync(path.join(CORE_ROOT, file), "utf8"),
  );
  if (missing.length > 0) {
    return `no fast spec named after or importing ${missing.map((file) => `${CORE_DIR}/${file}`).join(", ")}, so no test can kill a mutant there`;
  }
  writeFileSync(
    path.join(CORE_ROOT, VITEST_CONFIG),
    [
      "// Generated by scripts/mutation-changed.ts; gitignored.",
      'import config from "./vitest.config";',
      "",
      "export default {",
      "  ...config,",
      `  test: { ...config.test, include: ${JSON.stringify(include)} },`,
      "};",
      "",
    ].join("\n"),
  );
  return null;
}

function readReport(): MutationReport {
  return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as MutationReport;
}

export function mutationShardCount(specs: readonly string[]): number {
  const lines = specs.reduce((total, spec) => {
    const range = /:(\d+)-(\d+)$/.exec(spec);
    if (!range) throw new Error(`Invalid mutation range: ${spec}`);
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start
    )
      throw new Error(`Invalid mutation range: ${spec}`);
    return total + end - start + 1;
  }, 0);
  return Math.max(1, Math.min(64, Math.ceil(lines / 32)));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readStrykerConfiguration() {
  const input: unknown = JSON.parse(
    readFileSync(path.join(CORE_ROOT, "stryker.config.json"), "utf8"),
  );
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Stryker configuration must be an object");
  const original = input as Record<string, unknown>;
  const thresholds = original.thresholds;
  if (
    !thresholds ||
    typeof thresholds !== "object" ||
    !("break" in thresholds) ||
    typeof thresholds.break !== "number" ||
    !Number.isFinite(thresholds.break) ||
    thresholds.break < 0 ||
    thresholds.break > 100
  )
    throw new Error("Stryker break threshold is unavailable");
  const appendPlugins: string[] = [];
  if (original.appendPlugins !== undefined) {
    if (!Array.isArray(original.appendPlugins))
      throw new Error("Stryker appendPlugins must be an array");
    for (const plugin of original.appendPlugins as unknown[]) {
      if (typeof plugin !== "string")
        throw new Error("Stryker plugin path must be a string");
      appendPlugins.push(plugin);
    }
  }
  return {
    ...original,
    thresholds: { ...thresholds, break: thresholds.break },
    appendPlugins,
  };
}

function shardMetadata(specs: readonly string[], shardCount: number) {
  const base = diffBaseCommit(REPO_ROOT);
  if (!base) throw new Error("Mutation diff base could not be resolved");
  const config = readFileSync(
    path.join(CORE_ROOT, "stryker.config.json"),
    "utf8",
  );
  const plugin = readFileSync(
    path.join(REPO_ROOT, "scripts/mutation-shard-plugin.mts"),
    "utf8",
  );
  const runner = readFileSync(
    path.join(REPO_ROOT, "scripts/lib/mutation-shard-runner.mts"),
    "utf8",
  );
  const runId = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`
    : process.env.MUTATION_RUN_ID;
  if (!runId)
    throw new Error(
      "Sharded mutation reports require a shared MUTATION_RUN_ID outside Actions",
    );
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim(),
    base,
    configHash: digest(
      JSON.stringify([STRYKER_VERSION, config, plugin, runner, runId]),
    ),
    scopeHash: digest(JSON.stringify(specs)),
    testScopeHash: digest(
      readFileSync(path.join(CORE_ROOT, VITEST_CONFIG), "utf8"),
    ),
    shardCount,
  };
}

async function aggregateReports(
  directory: string,
  specs: readonly string[],
): Promise<number> {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (
    entries.some(
      (entry) => !entry.isFile() || !/^shard-\d+\.json$/.test(entry.name),
    )
  ) {
    throw new Error("Mutation artifact directory contains an unexpected entry");
  }
  const receipts: unknown[] = entries.map((entry) =>
    JSON.parse(readFileSync(path.join(directory, entry.name), "utf8")),
  );
  const merged = aggregateShardReceipts(
    receipts,
    shardMetadata(specs, mutationShardCount(specs)),
  );
  const installFailure = installStryker(false);
  if (installFailure) throw new Error(installFailure);
  const require = createRequire(path.join(STRYKER_DIR, "package.json"));
  const metricsModule: unknown = await import(
    pathToFileURL(require.resolve("mutation-testing-metrics")).href
  );
  if (
    !metricsModule ||
    typeof metricsModule !== "object" ||
    !("calculateMetrics" in metricsModule) ||
    typeof metricsModule.calculateMetrics !== "function"
  ) {
    throw new Error("Pinned Stryker metrics implementation is unavailable");
  }
  const result: unknown = metricsModule.calculateMetrics(merged.files);
  if (
    !result ||
    typeof result !== "object" ||
    !("metrics" in result) ||
    !result.metrics ||
    typeof result.metrics !== "object" ||
    !("mutationScore" in result.metrics) ||
    typeof result.metrics.mutationScore !== "number"
  ) {
    throw new Error("Pinned Stryker metrics returned an invalid score");
  }
  const score = result.metrics.mutationScore;
  const config = readStrykerConfiguration();
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        schemaVersion: "1.0",
        thresholds: config.thresholds,
        files: merged.files,
      },
      null,
      2,
    ),
  );
  const total = Object.values(merged.files).reduce(
    (count, file) => count + file.mutants.length,
    0,
  );
  if (total === 0) {
    console.log(
      "mutation-changed: complete shard inventory contains no generated mutants; score is not applicable.",
    );
    return 0;
  }
  if (!Number.isFinite(score))
    throw new Error("Global mutation score could not be computed");
  for (const survivor of survivingMutants({ files: merged.files }))
    console.log(`  ${survivor}`);
  console.log(
    `mutation-changed: complete global score ${score.toFixed(2)}%; required ${config.thresholds.break}%; ${total} mutants.`,
  );
  return score >= config.thresholds.break ? 0 : 1;
}

async function main(): Promise<number> {
  const added = requireAddedLines(REPO_ROOT, "mutation-changed");
  const specs = mutateSpecs(added);
  const args = process.argv.slice(2);
  const planMode = args.length === 1 && args[0] === "--plan";
  const aggregateMode = args.length === 2 && args[0] === "--aggregate";
  const shard =
    args.length === 3 && args[0] === "--shard"
      ? parseMutationShard(args[1], args[2])
      : null;
  if (args.length > 0 && !planMode && !aggregateMode && !shard)
    throw new Error(
      "Expected --plan, --shard <index> <count>, or --aggregate <directory>",
    );
  if (planMode) {
    const count = mutationShardCount(specs);
    const matrix = {
      include: Array.from({ length: count }, (_, index) => ({ index, count })),
    };
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `matrix=${JSON.stringify(matrix)}\nhas_ranges=${specs.length > 0}\n`,
      );
    console.log(JSON.stringify(matrix));
    return 0;
  }
  if (specs.length === 0) {
    if (shard)
      throw new Error("Sharded mutation run selected without source ranges");
    console.log(
      "mutation-changed: no added packages/core source lines in scope; nothing to mutate.",
    );
    return 0;
  }
  // Stryker splits --mutate on commas, so a comma in a path would silently
  // mutate the wrong file.
  const comma = specs.find((spec) => spec.includes(","));
  if (comma) {
    console.error(`mutation-changed: cannot pass ${comma} to Stryker (comma).`);
    return GUARD_EXIT_COULD_NOT_RUN;
  }

  // A report left by an earlier run would let a crashed run look like a
  // completed one, so the report must come from this run.
  rmSync(REPORT_DIR, { recursive: true, force: true });
  console.log(`mutation-changed: ${specs.length} range(s):`);
  for (const spec of specs) console.log(`  ${spec}`);

  const untested = writeVitestConfig(specs);
  if (untested) {
    console.error(`mutation-changed: ${untested}.`);
    return 1;
  }
  if (aggregateMode) return aggregateReports(path.resolve(args[1]), specs);
  const installFailure = installStryker();
  if (installFailure) {
    console.error(`mutation-changed: ${installFailure}`);
    return GUARD_EXIT_COULD_NOT_RUN;
  }
  let configFile = "stryker.config.json";
  if (shard) {
    if (shard.count !== mutationShardCount(specs))
      throw new Error("Mutation shard count differs from the current plan");
    mkdirSync(path.join(STRYKER_DIR, "lib"), { recursive: true });
    copyFileSync(
      path.join(REPO_ROOT, "scripts/mutation-shard-plugin.mts"),
      path.join(STRYKER_DIR, "mutation-shard-plugin.mts"),
    );
    copyFileSync(
      path.join(REPO_ROOT, "scripts/lib/mutation-shard-runner.mts"),
      path.join(STRYKER_DIR, "lib/mutation-shard-runner.mts"),
    );
    const original = readStrykerConfiguration();
    mkdirSync(path.join(CORE_ROOT, ".tmp"), { recursive: true });
    configFile = path.join(CORE_ROOT, ".tmp/mutation-shard.generated.json");
    // A shard produces an owner-only report. Only the aggregate evaluates the original global threshold.
    writeFileSync(
      configFile,
      JSON.stringify(
        {
          ...original,
          testRunner: "sharded-vitest",
          appendPlugins: [
            ...(original.appendPlugins ?? []),
            path.join(STRYKER_DIR, "mutation-shard-plugin.mts"),
          ],
          reporters: ["json", "progress"],
          thresholds: { ...original.thresholds, break: 0 },
        },
        null,
        2,
      ),
    );
  }
  const run = spawnSync(
    STRYKER_BIN,
    ["run", configFile, "--mutate", specs.join(",")],
    {
      cwd: CORE_ROOT,
      stdio: "inherit",
      ...(shard
        ? {
            env: {
              ...process.env,
              MUTATION_SHARD_INDEX: String(shard.index),
              MUTATION_SHARD_COUNT: String(shard.count),
            },
          }
        : {}),
    },
  );
  if (run.error || run.signal !== null || run.status === null) {
    console.error(
      `mutation-changed: Stryker could not run: ${run.error?.message ?? run.signal ?? "no exit status"}`,
    );
    return GUARD_EXIT_COULD_NOT_RUN;
  }

  let report: MutationReport;
  try {
    report = readReport();
  } catch (error) {
    console.error(
      `mutation-changed: no readable Stryker report at ${path.relative(REPO_ROOT, REPORT_PATH)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return GUARD_EXIT_COULD_NOT_RUN;
  }

  if (shard) {
    if (run.status !== 0)
      throw new Error(`Mutation report shard failed with exit ${run.status}`);
    const receipt = createShardReceipt(report, {
      ...shardMetadata(specs, shard.count),
      shardIndex: shard.index,
    });
    const directory = path.join(REPO_ROOT, ".tmp/mutation-shards");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, `shard-${shard.index}.json`),
      JSON.stringify(receipt),
    );
    console.log(
      `mutation-changed: owner-only report shard ${shard.index + 1}/${shard.count} complete; global threshold has not been evaluated.`,
    );
    return 0;
  }

  const survivors = survivingMutants(report);
  if (survivors.length > 0) {
    console.log(`\nmutation-changed: ${survivors.length} surviving mutant(s):`);
    for (const survivor of survivors) console.log(`  ${survivor}`);
  }

  if (run.status === 0) {
    console.log("mutation-changed: passed (score meets the break threshold).");
    return 0;
  }
  // Stryker exits 1 both for a score under `thresholds.break` and for a
  // misconfiguration. The report is written only after a completed run, so
  // exit 1 with a report means the score failed.
  if (run.status === 1) {
    console.error(
      "mutation-changed: mutation score is under the break threshold.",
    );
    return 1;
  }
  console.error(`mutation-changed: Stryker exited ${run.status}.`);
  return GUARD_EXIT_COULD_NOT_RUN;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error: unknown) => {
      console.error(
        `mutation-changed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = GUARD_EXIT_COULD_NOT_RUN;
    });
}
