/**
 * guard-no-new-mcp-parity-gaps.ts
 *
 * packages/core/src/mcp/mcp-parity-gaps.json freezes the actions an app's own
 * agent could call that its MCP server neither served nor ruled out when every
 * such action had to carry a decision. The list may only shrink: a new action
 * is served (`mcpTool: true`) or kept in-app (`mcpTool: false`, with a comment
 * saying why) instead of joining it.
 *
 * The parity spec (agent-mcp-parity.spec.ts) checks that every undecided
 * action is listed and every entry is still undecided. It cannot check that no
 * entry was added, because that is a comparison with the base branch, so this
 * guard compares the baseline's ids with the merge-base version and fails on
 * every id the branch adds. Both read the file through `readParityGaps`.
 *
 * The comparison and its outcomes live in `lib/shrink-only-baseline.ts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseShrinkOnlyBaseline,
  runShrinkOnlyBaselineGuard,
  type GuardOutcome,
  type ShrinkOnlyBaseline,
} from "./lib/shrink-only-baseline.js";

const GUARD_NAME = "guard:no-new-mcp-parity-gaps";

export const BASELINE_PATH = "packages/core/src/mcp/mcp-parity-gaps.json";
export const GUARD_PATH = "scripts/guard-no-new-mcp-parity-gaps.ts";

/** The baseline as both this guard and the parity spec read it. */
export function readParityGaps(root: string): ShrinkOnlyBaseline {
  return parseShrinkOnlyBaseline(
    readFileSync(path.join(root, BASELINE_PATH), "utf8"),
  );
}

export function runParityGapGuard(cwd: string): GuardOutcome {
  return runShrinkOnlyBaselineGuard(cwd, {
    guardName: GUARD_NAME,
    baselinePath: BASELINE_PATH,
    guardPath: GUARD_PATH,
    idNoun: "undecided actions",
    movedHelp:
      "The baseline path is fixed: the guard compares the file at that path with the merge-base,\n" +
      "and the parity spec reads the same path. Keep the baseline there; to clear an entry,\n" +
      "decide the action (`mcpTool: true` or `mcpTool: false`) and delete the id.",
    addedTarget: "the MCP parity baseline",
    addedHelp:
      "The baseline records actions that had no MCP decision when the parity check began, and\n" +
      "may only shrink. Decide the action instead of adding it here: `mcpTool: true` serves it\n" +
      "to outside agents (add a test that calls it over MCP), and `mcpTool: false` keeps it\n" +
      "in-app, with a comment on that line saying why.",
  });
}

function main() {
  const outcome = runParityGapGuard(path.resolve(import.meta.dirname, ".."));
  (outcome.code === 0 ? console.log : console.error)(outcome.message);
  process.exit(outcome.code);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
