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
 * The comparison and its outcomes live in `lib/shrink-only-baseline.ts`,
 * which other shrink-only baselines share.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  checkShrinkOnlyBaseline,
  parseShrinkOnlyBaseline,
  runShrinkOnlyBaselineGuard,
  shrinkOnlyBaselineIds,
  type GuardOutcome,
  type MergeBaseState,
  type ShrinkOnlyBaseline,
  type ShrinkOnlyBaselineResult,
} from "./lib/shrink-only-baseline.js";

export type { GuardOutcome, MergeBaseState };

const GUARD_NAME = "guard:no-new-legacy-mcp-hints";

export const BASELINE_PATH =
  "packages/core/src/mcp/legacy-unreviewed-destructive-hint.json";
export const GUARD_PATH = "scripts/guard-no-new-legacy-mcp-hints.ts";

export type LegacyBaseline = ShrinkOnlyBaseline;
export type LegacyBaselineResult = ShrinkOnlyBaselineResult;

/**
 * Parses the baseline: an object whose values are arrays of action names,
 * keyed by the app whose action it is ("core" for framework tools). Throws on
 * anything else, so a malformed file cannot read as an empty list and pass.
 */
export const parseLegacyBaseline = parseShrinkOnlyBaseline;

/** The baseline as both this guard and the destructiveHint spec read it. */
export function readLegacyBaseline(root: string): LegacyBaseline {
  return parseLegacyBaseline(
    readFileSync(path.join(root, BASELINE_PATH), "utf8"),
  );
}

/** "<section>/<action name>" for every entry. */
export const legacyIds = shrinkOnlyBaselineIds;

export const checkLegacyBaseline = checkShrinkOnlyBaseline;

export function runLegacyBaselineGuard(cwd: string): GuardOutcome {
  return runShrinkOnlyBaselineGuard(cwd, {
    guardName: GUARD_NAME,
    baselinePath: BASELINE_PATH,
    guardPath: GUARD_PATH,
    idNoun: "legacy ids",
    movedHelp:
      "The baseline path is fixed: the guard compares the file at that path with the merge-base,\n" +
      "and the destructiveHint spec reads the same path. Keep the baseline there; to clear an\n" +
      "entry, declare `mcpAnnotations` on the action and delete the id.",
    addedTarget: "the legacy MCP destructiveHint baseline",
    addedHelp:
      "The baseline records tools that predate the destructiveHint contract and may only shrink.\n" +
      "Declare `mcpAnnotations: { readOnlyHint, destructiveHint, openWorldHint }` on the action\n" +
      "instead of adding it here (destructiveHint is true when it deletes, overwrites, or replaces\n" +
      "user content, recoverable Trash included).",
  });
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
