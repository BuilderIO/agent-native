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
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";
import { isMutationScopePath } from "./lib/mutation-scope.ts";

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
function installStryker(): string | null {
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

/**
 * Whether a spec can run against Stryker's sandbox copy of Core. A spec that
 * reads a source file's text sees the instrumented rewrite, and a relative
 * import that leaves Core (`../../../agentkit/src/...`) does not resolve from
 * the sandbox; either fails the dry run, which aborts every mutant.
 */
function runsInSandbox(text: string, directory: string): boolean {
  if (SOURCE_TEXT_READ.test(text) || REPO_ROOT_HARNESS.test(text)) return false;
  for (const [, specifier] of text.matchAll(RELATIVE_SPECIFIER)) {
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
 * sandbox are never selected. Returns the mutated files with no such spec
 * under `missing`.
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
      .filter((entry) => TEST_FILE.test(entry))
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
 * specs (worker builds, docs scans, self-imports of `@agent-native/core/*`)
 * that cannot run inside Stryker's sandbox copy, and one failing dry-run test
 * aborts the whole run.
 */
function writeVitestConfig(specs: readonly string[]): string | null {
  const { include, missing } = namedSpecs(
    specs,
    (directory) => readdirSync(path.join(CORE_ROOT, directory)),
    (file) => readFileSync(path.join(CORE_ROOT, file), "utf8"),
  );
  if (missing.length > 0) {
    return `no spec named after or importing ${missing.map((file) => `${CORE_DIR}/${file}`).join(", ")}, so no test can kill a mutant there`;
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

function main(): number {
  const added = requireAddedLines(REPO_ROOT, "mutation-changed");
  const specs = mutateSpecs(added);
  if (specs.length === 0) {
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
  const installFailure = installStryker();
  if (installFailure) {
    console.error(`mutation-changed: ${installFailure}`);
    return GUARD_EXIT_COULD_NOT_RUN;
  }
  const run = spawnSync(
    STRYKER_BIN,
    ["run", "stryker.config.json", "--mutate", specs.join(",")],
    { cwd: CORE_ROOT, stdio: "inherit" },
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
  process.exit(main());
}
