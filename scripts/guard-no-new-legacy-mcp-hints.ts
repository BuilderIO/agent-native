/**
 * guard-no-new-legacy-mcp-hints.ts
 *
 * packages/core/src/mcp/legacy-unreviewed-destructive-hint.fixture.ts freezes
 * the MCP tools that could change data before every such tool had to declare
 * `mcpAnnotations.destructiveHint`. The list may only shrink: a new mutating
 * tool declares its hint on the action instead of joining it.
 *
 * The vitest spec checks that every entry is still needed. It cannot check
 * that no entry was added, because that is a comparison with the base branch,
 * and a count or snapshot inside the spec can be edited in the same diff. So
 * this guard compares the fixture's ids with the merge-base version and fails
 * on every id the branch adds, including one added while a stale id is removed.
 *
 * Three outcomes, per the guard contract in AGENTS.md:
 * - the base ref or merge-base cannot be resolved: exit 2 (could not run);
 * - the fixture did not exist at the merge-base: the PR that introduces it
 *   may write the initial list. Allowed, and logged;
 * - otherwise any added id fails.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  resolveDiffBase,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-new-legacy-mcp-hints";

export const FIXTURE_PATH =
  "packages/core/src/mcp/legacy-unreviewed-destructive-hint.fixture.ts";
const EXPORT_NAME = "LEGACY_UNREVIEWED";

/**
 * "<section>/<action name>" for every entry of the exported baseline object.
 * Throws on any shape it cannot read, so a reformatted fixture cannot parse as
 * an empty list and pass.
 */
export function parseLegacyIds(source: string): Set<string> {
  const file = ts.createSourceFile(
    FIXTURE_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (candidate) =>
        ts.isIdentifier(candidate.name) && candidate.name.text === EXPORT_NAME,
    );
  const object = declaration?.initializer;
  if (!object || !ts.isObjectLiteralExpression(object)) {
    throw new Error(`${EXPORT_NAME} is not an object literal.`);
  }
  const ids = new Set<string>();
  for (const property of object.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ||
      !ts.isArrayLiteralExpression(property.initializer)
    ) {
      throw new Error(
        `${EXPORT_NAME} has an entry that is not "section: [...]".`,
      );
    }
    for (const element of property.initializer.elements) {
      if (!ts.isStringLiteral(element)) {
        throw new Error(
          `${EXPORT_NAME}.${property.name.text} has an element that is not a string literal.`,
        );
      }
      ids.add(`${property.name.text}/${element.text}`);
    }
  }
  return ids;
}

export type LegacyBaselineResult =
  | { status: "bootstrap"; count: number }
  | { status: "ok"; count: number }
  | { status: "added"; added: string[] };

/** `baseSource` is null when the fixture did not exist at the merge-base. */
export function checkLegacyBaseline(
  baseSource: string | null,
  headSource: string,
): LegacyBaselineResult {
  const head = parseLegacyIds(headSource);
  if (baseSource === null) return { status: "bootstrap", count: head.size };
  const base = parseLegacyIds(baseSource);
  const added = [...head].filter((id) => !base.has(id)).sort();
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

  // Check the tree entry separately from reading the blob: cat-file returns
  // the same failure for an absent path and an unavailable referenced object.
  const basePaths = git(
    ["ls-tree", "-r", "--name-only", mergeBase, "--", FIXTURE_PATH],
    cwd,
  );
  if (basePaths === null) {
    return couldNotRun(
      `could not inspect ${FIXTURE_PATH} at merge-base ${mergeBase}`,
    );
  }
  const existsAtBase = basePaths.split(/\r?\n/).includes(FIXTURE_PATH);
  const baseSource = existsAtBase
    ? git(["show", `${mergeBase}:${FIXTURE_PATH}`], cwd)
    : null;
  if (existsAtBase && baseSource === null) {
    return couldNotRun(
      `could not read ${FIXTURE_PATH} at merge-base ${mergeBase}`,
    );
  }

  let result: LegacyBaselineResult;
  try {
    result = checkLegacyBaseline(
      baseSource,
      readFileSync(path.join(cwd, FIXTURE_PATH), "utf8"),
    );
  } catch (error) {
    return couldNotRun(
      `could not read ${FIXTURE_PATH}: ${(error as Error).message}`,
    );
  }

  const short = mergeBase.slice(0, 10);
  if (result.status === "bootstrap") {
    return {
      code: 0,
      message:
        `${GUARD_NAME}: BOOTSTRAP - ${FIXTURE_PATH} does not exist at merge-base ${short}; ` +
        `allowing its initial ${result.count} ids. Later branches may only remove ids.`,
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
      result.added.map((id) => `  ${FIXTURE_PATH}: ${id}`).join("\n"),
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
