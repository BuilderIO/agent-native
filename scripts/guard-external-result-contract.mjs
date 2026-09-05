#!/usr/bin/env node
/**
 * guard-external-result-contract.mjs
 *
 * Defensive CI guard for the external-agent result contract: an action any
 * external caller (Claude, ChatGPT, Codex, another app over A2A/MCP) can
 * invoke must never tell that caller to sit and wait for a human to answer
 * in the in-app chat — an external caller has no in-app chat to watch, so
 * that instruction is a dead end. And a new create-* action that IS
 * externally reachable must return a deep link the caller (or the human
 * behind it) can actually open, or the created thing is unreachable outside
 * the app that made it.
 *
 * This guard only scans lines ADDED on this branch (via
 * scripts/lib/changed-lines.mjs), scoped to
 * templates/*\/actions/**\/*.ts and packages/*\/src/**\/actions/**\/*.ts,
 * excluding *.spec.ts / *.test.ts.
 *
 * "External" classification mirrors `isActionExposedToExternalAgents` in
 * packages/core/src/action.ts:1234 — an action is external when `agentTool`
 * is not literally `false`, and either `mcpTool: true` is set, or `mcpTool`
 * is absent and `endsTurn` is not literally `true` (an action that ends the
 * in-app agent's turn is in-app only by default, because the answer flows
 * back through a chat surface an external caller isn't on).
 *
 * Checks:
 *   A. Wait-language — an external action's `description:` or
 *      `nextRequiredAction:` value must not tell the caller to wait for the
 *      user to answer/respond in-app.
 *   B. Deep link — a new `create-*.ts` action that is external must declare
 *      a `link:` result builder, or return an object with a `urlPath`/`url`
 *      field, so the created thing has a place to go back to. "New" means
 *      the `defineAction(` call itself is on a line this branch added; an
 *      existing action picking up an unrelated added line is not re-checked.
 *
 * Opt-out pragma (first 10 lines of the action file):
 *
 *   // guard:allow-result-contract — short reason
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED rather than a silent pass.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addedLines,
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRAGMA = /\/\/\s*guard:allow-result-contract\b/;

const IN_SCOPE =
  /^(templates\/[^/]+\/actions\/|packages\/[^/]+\/src\/.*\/actions\/)/;
const SKIPPED = /(\.spec\.|\.test\.)/;

const WAIT_RE =
  /\bwait(?:ing)? for the user|stop and wait|after the user (?:answers|responds|replies)|the user will (?:answer|respond|reply)|once the user (?:answers|responds|picks|chooses)\b/i;

const RESULT_KEY_RE = /\b(description|nextRequiredAction)\s*:/g;

/** Mirrors isActionExposedToExternalAgents(entry) in packages/core/src/action.ts:1234. */
function isExternal(source) {
  if (/\bagentTool\s*:\s*false\b/.test(source)) return false;
  if (/\bmcpTool\s*:\s*true\b/.test(source)) return true;
  const mcpToolPresent = /\bmcpTool\s*:/.test(source);
  const endsTurnTrue = /\bendsTurn\s*:\s*true\b/.test(source);
  return !mcpToolPresent && !endsTurnTrue;
}

/** Extract the source range of a property value, balancing brackets so an
 *  arrow-function value (nextRequiredAction: (x) => `...`) doesn't get cut
 *  off at its first internal comma. Stops at the first top-level comma or
 *  the enclosing object's closing brace. */
function extractPropertyValue(source, afterColonIndex) {
  let i = afterColonIndex;
  while (i < source.length && /\s/.test(source[i])) i++;
  const start = i;
  let depth = 0;
  let quote = null;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) break;
  }
  return { text: source.slice(start, i), start, end: i };
}

function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** Pure, testable core: given one file's path/source/added-line set, return
 *  the violations found in it. */
export function findExternalResultContractViolations(
  file,
  source,
  addedLineNumbers,
) {
  if (!inScope(file)) return [];
  const head = source.split("\n").slice(0, 10).join("\n");
  if (PRAGMA.test(head)) return [];
  const defineActionMatch = /\bdefineAction\s*\(\s*\{/.exec(source);
  if (!defineActionMatch) return [];
  if (!isExternal(source)) return [];

  const violations = [];

  RESULT_KEY_RE.lastIndex = 0;
  let match;
  while ((match = RESULT_KEY_RE.exec(source))) {
    const key = match[1];
    const { text, start, end } = extractPropertyValue(
      source,
      match.index + match[0].length,
    );
    if (!WAIT_RE.test(text)) continue;
    const startLine = lineAt(source, start);
    const endLine = lineAt(source, end);
    const touched = [...addedLineNumbers].some(
      (n) => n >= startLine && n <= endLine,
    );
    if (!touched) continue;
    violations.push({
      file,
      line: startLine,
      kind: "wait-language",
      reason: `external action's ${key} tells the caller to wait for the in-app user — an external caller has no in-app chat to wait on`,
    });
  }

  const basename = path.basename(file);
  // Scope check B to a NEW create-* action, not any touched one: an existing
  // action picks up an added line constantly (a tweaked description, a log
  // line) without its result contract changing at all. A file is "new" here
  // when the `defineAction(` call itself is on an added line — an existing
  // file's defineAction( call predates this branch's diff.
  const isNewFile = addedLineNumbers.has(
    lineAt(source, defineActionMatch.index),
  );
  if (isNewFile && /^create-.*\.ts$/.test(basename)) {
    const hasLink = /\blink\s*:/.test(source);
    const hasUrlField = /\b(?:urlPath|url)\s*:/.test(source);
    if (!hasLink && !hasUrlField) {
      violations.push({
        file,
        line: 1,
        kind: "missing-deep-link",
        reason:
          "external create-* action has no `link:` result builder and returns no urlPath/url — the created thing has nowhere for an external caller to go back to",
      });
    }
  }

  return violations;
}

function inScope(relPath) {
  if (SKIPPED.test(relPath)) return false;
  return IN_SCOPE.test(relPath) && relPath.endsWith(".ts");
}

export function checkExternalResultContract(cwd) {
  const added = addedLines(cwd);
  if (added === null) return null;

  const violations = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(cwd, absPath).replace(/\\/g, "/");
    if (!inScope(rel)) continue;

    let source;
    try {
      source = readFileSync(absPath, "utf8");
    } catch (err) {
      // An added file this guard cannot read is not a clean file — that
      // would coerce "unreadable" into "nothing to check". Report it and
      // stop the same way requireAddedLines reports could-not-run.
      console.error(
        `guard-external-result-contract: could not read added file ${rel} ` +
          `(${err?.message ?? err}), so the check did not run.`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }

    violations.push(
      ...findExternalResultContractViolations(rel, source, lineNumbers),
    );
  }

  return violations;
}

function main() {
  const violations = checkExternalResultContract(REPO_ROOT);
  if (violations === null) {
    requireAddedLines(REPO_ROOT, "guard-external-result-contract");
    return;
  }

  if (violations.length === 0) {
    console.log("guard-external-result-contract: OK");
    process.exit(0);
  }

  console.error(
    `guard-external-result-contract: ${violations.length} violation(s) found.`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.kind}`);
    console.error(`    ${v.reason}`);
  }
  console.error(
    "\nIf this is a deliberate, reviewed exception, add the opt-out pragma in\n" +
      "the first 10 lines of the action file:\n" +
      "  // guard:allow-result-contract — short reason\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
