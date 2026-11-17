/**
 * A shrink-only baseline: a checked-in JSON object whose values are arrays of
 * action names, keyed by a section (an app id, or "core" for framework
 * actions). A spec checks that every entry is still needed; a guard built on
 * `runShrinkOnlyBaselineGuard` compares the file with the merge-base and fails
 * on every id the branch adds, because a list inside the spec could be edited
 * in the same diff it is meant to stop.
 *
 * Outcomes, per the guard contract in AGENTS.md:
 * - the base ref or merge-base cannot be resolved, or a file cannot be read:
 *   exit 2 (could not run);
 * - neither the guard nor the baseline existed at the merge-base: the PR that
 *   introduces them may write the initial list. Allowed, and logged;
 * - the guard existed at the merge-base but the baseline did not exist at its
 *   path: exit 1. The path is fixed, so moving the file cannot restart the
 *   initial list;
 * - otherwise any added id fails.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { GUARD_EXIT_COULD_NOT_RUN, resolveDiffBase } from "./changed-lines.mjs";

export type ShrinkOnlyBaseline = Readonly<Record<string, readonly string[]>>;

/**
 * Parses a baseline: an object whose values are arrays of action names. Throws
 * on anything else, so a malformed file cannot read as an empty list and pass.
 */
export function parseShrinkOnlyBaseline(text: string): ShrinkOnlyBaseline {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("the baseline is not a JSON object.");
  }
  for (const [section, names] of Object.entries(value)) {
    if (
      !Array.isArray(names) ||
      !names.every((name) => typeof name === "string")
    ) {
      throw new Error(`"${section}" is not an array of action names.`);
    }
  }
  return value as ShrinkOnlyBaseline;
}

/** "<section>/<action name>" for every entry. */
export function shrinkOnlyBaselineIds(
  baseline: ShrinkOnlyBaseline,
): Set<string> {
  return new Set(
    Object.entries(baseline).flatMap(([section, names]) =>
      names.map((name) => `${section}/${name}`),
    ),
  );
}

export type ShrinkOnlyBaselineResult =
  | { status: "bootstrap"; count: number }
  | { status: "moved" }
  | { status: "ok"; count: number }
  | { status: "added"; added: string[] };

export interface MergeBaseState {
  /** The baseline's text at the merge-base, or null when it did not exist. */
  baseline: string | null;
  guardExists: boolean;
}

export function checkShrinkOnlyBaseline(
  base: MergeBaseState,
  headText: string,
): ShrinkOnlyBaselineResult {
  const head = shrinkOnlyBaselineIds(parseShrinkOnlyBaseline(headText));
  if (base.baseline === null) {
    return base.guardExists
      ? { status: "moved" }
      : { status: "bootstrap", count: head.size };
  }
  const previous = shrinkOnlyBaselineIds(
    parseShrinkOnlyBaseline(base.baseline),
  );
  const added = [...head].filter((id) => !previous.has(id)).sort();
  return added.length > 0
    ? { status: "added", added }
    : { status: "ok", count: head.size };
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // coercion-ok: unavailable Git probes become exit 2 in their callers.
    return null;
  }
}

export interface GuardOutcome {
  code: 0 | 1 | typeof GUARD_EXIT_COULD_NOT_RUN;
  message: string;
}

export interface ShrinkOnlyBaselineGuard {
  guardName: string;
  baselinePath: string;
  guardPath: string;
  /** What the ids are, as in "OK (12 <noun>, none added since …)". */
  idNoun: string;
  /** Why the path is fixed and what to do instead of moving the file. */
  movedHelp: string;
  /** Opens the failure: "<n> id(s) added to <addedTarget>." */
  addedTarget: string;
  /** What to do instead of adding an id. */
  addedHelp: string;
}

export function runShrinkOnlyBaselineGuard(
  cwd: string,
  guard: ShrinkOnlyBaselineGuard,
): GuardOutcome {
  const { guardName, baselinePath, guardPath } = guard;
  const couldNotRun = (reason: string, fix = ""): GuardOutcome => ({
    code: GUARD_EXIT_COULD_NOT_RUN,
    message: `${guardName}: ${reason}, so the check did not run.${fix}`,
  });

  const base = resolveDiffBase(cwd);
  const mergeBase = base
    ? git(["merge-base", base, "HEAD"], cwd)?.trim()
    : null;
  if (!base || !mergeBase) {
    return couldNotRun(
      base
        ? `could not find a merge-base between ${base} and HEAD`
        : "could not resolve a base ref (no GUARD_DIFF_BASE/GITHUB_BASE_REF, no origin/main or main)",
      "\n  Fix with:  git fetch origin main   (or set GUARD_DIFF_BASE=<ref>)",
    );
  }

  // Check the tree entries separately from reading the blob: cat-file returns
  // the same failure for an absent path and an unavailable referenced object.
  const basePaths = git(
    ["ls-tree", "-r", "--name-only", mergeBase, "--", baselinePath, guardPath],
    cwd,
  );
  if (basePaths === null) {
    return couldNotRun(`could not inspect merge-base ${mergeBase}`);
  }
  const pathsAtBase = new Set(basePaths.split(/\r?\n/));
  const baselineAtBase = pathsAtBase.has(baselinePath)
    ? git(["show", `${mergeBase}:${baselinePath}`], cwd)
    : null;
  if (pathsAtBase.has(baselinePath) && baselineAtBase === null) {
    return couldNotRun(
      `could not read ${baselinePath} at merge-base ${mergeBase}`,
    );
  }

  let result: ShrinkOnlyBaselineResult;
  try {
    result = checkShrinkOnlyBaseline(
      { baseline: baselineAtBase, guardExists: pathsAtBase.has(guardPath) },
      readFileSync(path.join(cwd, baselinePath), "utf8"),
    );
  } catch (error) {
    return couldNotRun(
      `could not read ${baselinePath}: ${(error as Error).message}`,
    );
  }

  const short = mergeBase.slice(0, 10);
  if (result.status === "bootstrap") {
    return {
      code: 0,
      message:
        `${guardName}: BOOTSTRAP - neither ${guardPath} nor ${baselinePath} exists at merge-base ${short}; ` +
        `allowing its initial ${result.count} ids. Later branches may only remove ids.`,
    };
  }
  if (result.status === "moved") {
    return {
      code: 1,
      message:
        `${guardName}: ${baselinePath} does not exist at merge-base ${short}, but this guard does.\n\n` +
        guard.movedHelp,
    };
  }
  if (result.status === "ok") {
    return {
      code: 0,
      message: `${guardName}: OK (${result.count} ${guard.idNoun}, none added since ${short})`,
    };
  }
  return {
    code: 1,
    message:
      `${guardName}: ${result.added.length} id(s) added to ${guard.addedTarget}.\n\n` +
      guard.addedHelp +
      "\n\n" +
      result.added.map((id) => `  ${baselinePath}: ${id}`).join("\n"),
  };
}
