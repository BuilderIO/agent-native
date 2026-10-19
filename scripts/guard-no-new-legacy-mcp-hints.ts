/**
 * guard-no-new-legacy-mcp-hints.ts
 *
 * packages/core/src/mcp/legacy-unreviewed-destructive-hint.json freezes the MCP
 * tools that could change data before every such tool had to declare
 * `mcpAnnotations.destructiveHint`. The list may only shrink: a new mutating
 * tool declares its hint on the action instead of joining it.
 *
 * The vitest spec checks that every entry is still needed. It cannot check
 * that no entry was added, because that is a comparison with the base branch,
 * and a count or snapshot inside the spec can be edited in the same diff. So
 * this guard compares the baseline's ids with the merge-base version and fails
 * on every id the branch adds, including one added while a stale id is removed.
 *
 * The baseline is plain JSON and the spec reads it through
 * `readLegacyBaseline` below, so the list this guard compares is the list the
 * spec uses: no code can extend it after it is read.
 *
 * Outcomes, per the guard contract in AGENTS.md:
 * - the base ref or merge-base cannot be resolved, or a file cannot be read:
 *   exit 2 (could not run);
 * - neither this guard nor the baseline existed at the merge-base: the PR that
 *   introduces them may write the initial list. Allowed, and logged;
 * - the guard existed at the merge-base but the baseline did not exist at
 *   BASELINE_PATH: exit 1. The path is fixed, so moving the file cannot
 *   restart the initial list;
 * - otherwise any added id fails.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  resolveDiffBase,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-new-legacy-mcp-hints";

export const BASELINE_PATH =
  "packages/core/src/mcp/legacy-unreviewed-destructive-hint.json";
export const GUARD_PATH = "scripts/guard-no-new-legacy-mcp-hints.ts";

export type LegacyBaseline = Readonly<Record<string, readonly string[]>>;

/**
 * Parses the baseline: an object whose values are arrays of action names,
 * keyed by the app whose action it is ("core" for framework tools). Throws on
 * anything else, so a malformed file cannot read as an empty list and pass.
 */
export function parseLegacyBaseline(text: string): LegacyBaseline {
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
  return value as LegacyBaseline;
}

/** The baseline as both this guard and the destructiveHint spec read it. */
export function readLegacyBaseline(root: string): LegacyBaseline {
  return parseLegacyBaseline(
    readFileSync(path.join(root, BASELINE_PATH), "utf8"),
  );
}

/** "<section>/<action name>" for every entry. */
export function legacyIds(baseline: LegacyBaseline): Set<string> {
  return new Set(
    Object.entries(baseline).flatMap(([section, names]) =>
      names.map((name) => `${section}/${name}`),
    ),
  );
}

export type LegacyBaselineResult =
  | { status: "bootstrap"; count: number }
  | { status: "moved" }
  | { status: "ok"; count: number }
  | { status: "added"; added: string[] };

export interface MergeBaseState {
  /** The baseline's text at the merge-base, or null when it did not exist. */
  baseline: string | null;
  guardExists: boolean;
}

export function checkLegacyBaseline(
  base: MergeBaseState,
  headText: string,
): LegacyBaselineResult {
  const head = legacyIds(parseLegacyBaseline(headText));
  if (base.baseline === null) {
    return base.guardExists
      ? { status: "moved" }
      : { status: "bootstrap", count: head.size };
  }
  const previous = legacyIds(parseLegacyBaseline(base.baseline));
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

export function runLegacyBaselineGuard(cwd: string): GuardOutcome {
  const couldNotRun = (reason: string, fix = ""): GuardOutcome => ({
    code: GUARD_EXIT_COULD_NOT_RUN,
    message: `${GUARD_NAME}: ${reason}, so the check did not run.${fix}`,
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
    [
      "ls-tree",
      "-r",
      "--name-only",
      mergeBase,
      "--",
      BASELINE_PATH,
      GUARD_PATH,
    ],
    cwd,
  );
  if (basePaths === null) {
    return couldNotRun(`could not inspect merge-base ${mergeBase}`);
  }
  const pathsAtBase = new Set(basePaths.split(/\r?\n/));
  const baselineAtBase = pathsAtBase.has(BASELINE_PATH)
    ? git(["show", `${mergeBase}:${BASELINE_PATH}`], cwd)
    : null;
  if (pathsAtBase.has(BASELINE_PATH) && baselineAtBase === null) {
    return couldNotRun(
      `could not read ${BASELINE_PATH} at merge-base ${mergeBase}`,
    );
  }

  let result: LegacyBaselineResult;
  try {
    result = checkLegacyBaseline(
      { baseline: baselineAtBase, guardExists: pathsAtBase.has(GUARD_PATH) },
      readFileSync(path.join(cwd, BASELINE_PATH), "utf8"),
    );
  } catch (error) {
    return couldNotRun(
      `could not read ${BASELINE_PATH}: ${(error as Error).message}`,
    );
  }

  const short = mergeBase.slice(0, 10);
  if (result.status === "bootstrap") {
    return {
      code: 0,
      message:
        `${GUARD_NAME}: BOOTSTRAP - neither ${GUARD_PATH} nor ${BASELINE_PATH} exists at merge-base ${short}; ` +
        `allowing its initial ${result.count} ids. Later branches may only remove ids.`,
    };
  }
  if (result.status === "moved") {
    return {
      code: 1,
      message:
        `${GUARD_NAME}: ${BASELINE_PATH} does not exist at merge-base ${short}, but this guard does.\n\n` +
        "The baseline path is fixed: the guard compares the file at that path with the merge-base,\n" +
        "and the destructiveHint spec reads the same path. Keep the baseline there; to clear an\n" +
        "entry, declare `mcpAnnotations` on the action and delete the id.",
    };
  }
  if (result.status === "ok") {
    return {
      code: 0,
      message: `${GUARD_NAME}: OK (${result.count} legacy ids, none added since ${short})`,
    };
  }
  return {
    code: 1,
    message:
      `${GUARD_NAME}: ${result.added.length} id(s) added to the legacy MCP destructiveHint baseline.\n\n` +
      "The baseline records tools that predate the destructiveHint contract and may only shrink.\n" +
      "Declare `mcpAnnotations: { readOnlyHint, destructiveHint, openWorldHint }` on the action\n" +
      "instead of adding it here (destructiveHint is true when it deletes, overwrites, or replaces\n" +
      "user content, recoverable Trash included).\n\n" +
      result.added.map((id) => `  ${BASELINE_PATH}: ${id}`).join("\n"),
  };
}

function main() {
  const outcome = runLegacyBaselineGuard(
    path.resolve(import.meta.dirname, ".."),
  );
  (outcome.code === 0 ? console.log : console.error)(outcome.message);
  process.exit(outcome.code);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
