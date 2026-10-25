/**
 * guard-compiler-strictness.ts
 *
 * `packages/core/tsconfig.base.json`, which every template extends, turns on
 * four checks that catch the bugs agents ship most: an index read that may be
 * missing (`noUncheckedIndexedAccess`), an optional field set to `undefined`
 * where the type means "absent" (`exactOptionalPropertyTypes`), a subclass
 * method that silently stops overriding (`noImplicitOverride`), and a `case`
 * that falls into the next (`noFallthroughCasesInSwitch`).
 *
 * A project whose existing code has too many errors under one of them opts
 * out in its own tsconfig, so the backlog does not block CI. This guard is the
 * ratchet on those opt-outs:
 *
 * - a line this branch adds to a tsconfig may not set one of the four flags,
 *   or `strict`, to `false`: the opt-out list only shrinks;
 * - in a project that still opts out, every flag-caused error on a line this
 *   branch added fails. The guard runs `tsc` with and without the opted-out
 *   flags and reports only errors the flags add, so a missing generated file
 *   or any other pre-existing error is never blamed on the flags.
 *
 * Scoping to added lines instead of a per-project error count keeps a type
 * change in core from failing an unrelated branch over errors it moved in
 * untouched files, and leaves no baseline file to edit or merge.
 *
 * There is no opt-out pragma: fix the error. Outcomes, per the guard contract
 * in CLAUDE.md: exit 2 when the diff base, `tsc`, or a project config cannot
 * be read; exit 1 on a finding; exit 0 otherwise. The branch that introduces
 * this guard (absent at the merge-base) may write the initial opt-outs.
 *
 * `--report` measures every project and prints the error count each opted-out
 * flag would add, to pick the next project to flip.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
  resolveDiffBase,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:compiler-strictness";
const GUARD_PATH = "scripts/guard-compiler-strictness.ts";
const rootDir = path.resolve(import.meta.dirname, "..");

export const RATCHETED_FLAGS = [
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
] as const;
export type RatchetedFlag = (typeof RATCHETED_FLAGS)[number];

/** Configs `tsc` checks that are not a workspace's own `tsconfig.json`. */
const EXTRA_PROJECTS = ["packages/core/tsconfig.cli.json"];
const OPT_OUT = new RegExp(
  `"(${[...RATCHETED_FLAGS, "strict"].join("|")})"\\s*:\\s*false`,
);
const TS_SOURCE = /\.[cm]?tsx?$/;

export interface Diagnostic {
  file: string;
  line: number;
  code: string;
  message: string;
}

/** Parses `tsc --pretty false` output; continuation lines are dropped. */
export function parseTscOutput(output: string, cwd: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(raw);
    if (!match) continue;
    diagnostics.push({
      file: path.resolve(cwd, match[1]),
      line: Number(match[2]),
      code: match[3],
      message: match[4],
    });
  }
  return diagnostics;
}

const diagnosticKey = (d: Diagnostic) =>
  `${d.file}\0${d.line}\0${d.code}\0${d.message}`;

/** Diagnostics present only once the flags are on. */
export function flagCausedDiagnostics(
  without: readonly Diagnostic[],
  withFlags: readonly Diagnostic[],
): Diagnostic[] {
  const before = new Set(without.map(diagnosticKey));
  return withFlags.filter((d) => !before.has(diagnosticKey(d)));
}

/** Added tsconfig lines that switch a ratcheted flag or `strict` off. */
export function findAddedOptOuts(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): { file: string; line: number; text: string }[] {
  return source
    .split(/\r?\n/)
    .map((text, index) => ({ file, line: index + 1, text: text.trim() }))
    .filter(({ line, text }) => addedLines.has(line) && OPT_OUT.test(text));
}

type Outcome = { code: 0 | 1 | 2; message: string };
class CouldNotRun extends Error {}

function tscBin(): string {
  const bin = path.join(rootDir, "node_modules", ".bin", "tsc");
  if (!existsSync(bin)) throw new CouldNotRun(`${bin} is missing`);
  return bin;
}

function runTsc(project: string, extra: readonly string[]): Diagnostic[] {
  const cwd = path.dirname(project);
  const result = spawnSync(
    tscBin(),
    [
      "-p",
      project,
      "--noEmit",
      "--incremental",
      "false",
      "--pretty",
      "false",
      ...extra,
    ],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.error) throw new CouldNotRun(result.error.message);
  const output = `${result.stdout}${result.stderr}`;
  const diagnostics = parseTscOutput(output, cwd);
  if (result.status !== 0 && diagnostics.length === 0) {
    throw new CouldNotRun(
      `tsc -p ${path.relative(rootDir, project)} failed without diagnostics:\n${output.slice(0, 2000)}`,
    );
  }
  if (diagnostics.some((d) => d.code.startsWith("TS5"))) {
    throw new CouldNotRun(
      `tsc -p ${path.relative(rootDir, project)} rejected its options:\n${output.slice(0, 2000)}`,
    );
  }
  return diagnostics;
}

function effectiveOptions(project: string): Record<string, unknown> {
  const result = spawnSync(tscBin(), ["-p", project, "--showConfig"], {
    cwd: path.dirname(project),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    return JSON.parse(result.stdout).compilerOptions ?? {};
  } catch {
    throw new CouldNotRun(
      `could not read the effective config of ${path.relative(rootDir, project)}`,
    );
  }
}

// `exactOptionalPropertyTypes` needs `strictNullChecks`; a project without it
// is still non-strict, which only `strict` itself can ratchet.
function nullChecked(project: string): boolean {
  const options = effectiveOptions(project);
  return (options.strictNullChecks ?? options.strict) === true;
}

function disabledFlags(project: string): RatchetedFlag[] {
  const options = effectiveOptions(project);
  const checksNull = nullChecked(project);
  return RATCHETED_FLAGS.filter(
    (flag) =>
      options[flag] !== true &&
      (flag !== "exactOptionalPropertyTypes" || checksNull),
  );
}

/** Every tsconfig `pnpm typecheck` checks, deepest directory first. */
export function listProjects(): string[] {
  const packageJsons = execFileSync(
    "git",
    [
      "ls-files",
      "--",
      "packages/*/package.json",
      "templates/**/package.json",
      "community-templates/*/package.json",
    ],
    { cwd: rootDir, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  const projects = packageJsons.flatMap((rel) => {
    const dir = path.join(rootDir, path.dirname(rel));
    const tsconfig = path.join(dir, "tsconfig.json");
    if (!existsSync(tsconfig)) return [];
    const scripts = JSON.parse(readFileSync(path.join(rootDir, rel), "utf8"))
      .scripts as Record<string, string> | undefined;
    return scripts?.typecheck ? [tsconfig] : [];
  });
  projects.push(...EXTRA_PROJECTS.map((rel) => path.join(rootDir, rel)));
  return projects.sort(
    (a, b) => path.dirname(b).length - path.dirname(a).length,
  );
}

function guardExistedAtMergeBase(): boolean {
  const base = resolveDiffBase(rootDir);
  if (!base) throw new CouldNotRun("could not resolve a base ref");
  try {
    const mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], {
      cwd: rootDir,
      encoding: "utf8",
    }).trim();
    return (
      execFileSync("git", ["ls-tree", "--name-only", mergeBase, GUARD_PATH], {
        cwd: rootDir,
        encoding: "utf8",
      }).trim() !== ""
    );
  } catch {
    throw new CouldNotRun("could not inspect the merge-base");
  }
}

export function runCompilerStrictnessGuard(): Outcome {
  const added = requireAddedLines(rootDir, GUARD_NAME);
  const findings: string[] = [];

  if (guardExistedAtMergeBase()) {
    for (const [absPath, lines] of added) {
      if (!/tsconfig[^/]*\.json$/.test(absPath)) continue;
      const rel = path.relative(rootDir, absPath);
      for (const optOut of findAddedOptOuts(
        rel,
        readFileSync(absPath, "utf8"),
        lines,
      )) {
        findings.push(
          `${optOut.file}:${optOut.line} adds the opt-out ${optOut.text}`,
        );
      }
    }
  }

  const projects = listProjects();
  const changedByProject = new Map<string, string[]>();
  for (const absPath of added.keys()) {
    if (!TS_SOURCE.test(absPath) || absPath.endsWith(".d.ts")) continue;
    const project = projects.find((p) =>
      absPath.startsWith(path.dirname(p) + path.sep),
    );
    if (!project) continue;
    changedByProject.set(project, [
      ...(changedByProject.get(project) ?? []),
      absPath,
    ]);
  }

  let checked = 0;
  for (const project of changedByProject.keys()) {
    const flags = disabledFlags(project);
    if (flags.length === 0) continue;
    checked += 1;
    const caused = flagCausedDiagnostics(
      runTsc(project, []),
      runTsc(
        project,
        flags.flatMap((flag) => [`--${flag}`, "true"]),
      ),
    );
    for (const d of caused) {
      if (!added.get(d.file)?.has(d.line)) continue;
      findings.push(
        `${path.relative(rootDir, d.file)}:${d.line} ${d.code} ${d.message}  [${path.relative(rootDir, project)} opts out of ${flags.join(", ")}]`,
      );
    }
  }

  if (findings.length === 0) {
    return {
      code: 0,
      message: `${GUARD_NAME}: OK (${checked} opted-out project(s) checked on added lines)`,
    };
  }
  return {
    code: 1,
    message:
      `${GUARD_NAME}: ${findings.length} finding(s).\n\n` +
      findings.map((f) => `  ${f}`).join("\n") +
      "\n\nThese projects opt out of strict compiler checks only for their existing\n" +
      "backlog; new and changed lines must pass them. Narrow an index read before\n" +
      "use (`const item = list[i]; if (!item) ...`), omit an optional field instead\n" +
      "of setting it to `undefined` (or type it `T | undefined`), mark overrides\n" +
      "with `override`, and end each `case` with break/return. Never add a new\n" +
      "`false` for these flags or `strict` to a tsconfig.",
  };
}

/**
 * The errors each flag adds on its own, measured against a run with all four
 * off, so a project's current settings do not hide any. A flag the project
 * cannot take (`exactOptionalPropertyTypes` without `strictNullChecks`) is
 * absent from the result.
 */
export function measureFlags(
  project: string,
): Partial<Record<RatchetedFlag, number>> {
  const allOff = RATCHETED_FLAGS.flatMap((flag) => [`--${flag}`, "false"]);
  const checksNull = nullChecked(project);
  const applicable = RATCHETED_FLAGS.filter(
    (flag) => flag !== "exactOptionalPropertyTypes" || checksNull,
  );
  const without = runTsc(project, allOff);
  const counts: Partial<Record<RatchetedFlag, number>> = {};
  for (const flag of applicable) {
    const withFlag = allOff.map((arg, i) =>
      allOff[i - 1] === `--${flag}` ? "true" : arg,
    );
    counts[flag] = flagCausedDiagnostics(
      without,
      runTsc(project, withFlag),
    ).length;
  }
  return counts;
}

function report() {
  const rows: string[] = [];
  for (const project of listProjects()) {
    const rel = path.relative(rootDir, project);
    try {
      const counts = Object.entries(measureFlags(project)).map(
        ([flag, count]) => `${flag}=${count}`,
      );
      rows.push(`${rel}: ${counts.join(" ")}`);
    } catch (error) {
      if (!(error instanceof CouldNotRun)) throw error;
      rows.push(`${rel}: could not measure (${error.message.split("\n")[0]})`);
    }
  }
  console.log(rows.join("\n"));
}

function main() {
  try {
    if (process.argv.includes("--report")) {
      report();
      return;
    }
    const outcome = runCompilerStrictnessGuard();
    (outcome.code === 0 ? console.log : console.error)(outcome.message);
    process.exit(outcome.code);
  } catch (error) {
    if (!(error instanceof CouldNotRun)) throw error;
    console.error(
      `${GUARD_NAME}: ${error.message}, so the check did not run.\n` +
        "  Fix with:  git fetch origin main   (or set GUARD_DIFF_BASE=<ref>), and pnpm install",
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
