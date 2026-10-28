#!/usr/bin/env node
/**
 * guard-e2e-harness.mjs
 *
 * Hygiene for the shared E2E harness, learned from a sweep where 63 Design
 * specs were red and most causes were harness drift rather than product bugs:
 *
 *   - `responsive-overview-regressions.spec.ts` defaulted to 127.0.0.1:9340
 *     while the config serves 9333. All four of its tests failed in ~50ms
 *     against a dead port, in CI, for eight weeks. Every spec that repeats a
 *     port literal is one rename away from the same silence.
 *   - Six specs grew their own `openEditor`, each waiting on slightly
 *     different chrome, so the same product change broke them unevenly.
 *   - `designFrame(page)` resolves `.last()`. Once a fixture mounts a second
 *     screen, ~17 assertions silently read the wrong document.
 *   - Six specs hand-rolled `.click().catch(() => {})` to "optionally" expand
 *     the layers tree. A click on a locator that matches nothing waits out the
 *     full 15s actionTimeout and, once caught, is indistinguishable from a
 *     successful click. That one idiom cost 30s per drag-and-drop test —
 *     42s -> 11.5s once bounded.
 *
 * Scope: lines ADDED on this branch only, so the existing backlog stays a
 * separate cleanup and this just stops the regrowth. Opt out with an inline
 * `e2e-harness-ignore` comment and say why.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const RULES = [
  {
    re: /127\.0\.0\.1:/,
    message:
      "hardcoded host:port in an E2E spec — read the served base URL instead " +
      "(project.use.baseURL ?? E2E_BASE_URL ?? E2E_PORT). A stale literal " +
      "fails in milliseconds against a port nothing serves.",
  },
  {
    re: /waitForTimeout\(\s*(?:[1-9]\d{3,}|\d+_\d+)/,
    message:
      "new waitForTimeout of 1s or more — wait for the state you actually " +
      "need (expect(...).toBeVisible(), toHaveCount, expect.poll) so it " +
      "passes as soon as it is true instead of always paying the sleep.",
  },
  {
    re: /^\s*(?:async\s+)?function\s+openEditor\s*\(/,
    message:
      "another local openEditor — import gotoEditor from ./helpers so every " +
      "spec waits on the same editor-ready contract.",
  },
];

function inScope(relPath) {
  return /^templates\/[^/]+\/e2e\/.*\.ts$/.test(relPath);
}

const added = requireAddedLines(REPO_ROOT, "guard-e2e-harness");
const violations = [];

for (const [absFile, lineNumbers] of added) {
  const relPath = path.relative(REPO_ROOT, absFile).replace(/\\/g, "/");
  if (!inScope(relPath)) continue;
  if (relPath.endsWith("/e2e/helpers.ts")) continue;

  let lines;
  try {
    lines = readFileSync(absFile, "utf8").split("\n");
  } catch {
    continue;
  }

  for (const lineNumber of [...lineNumbers].sort((a, b) => a - b)) {
    const text = lines[lineNumber - 1];
    if (text === undefined || text.includes("e2e-harness-ignore")) continue;
    for (const rule of RULES) {
      if (rule.re.test(text)) {
        violations.push(`  ${relPath}:${lineNumber}: ${rule.message}`);
      }
    }
  }
}

const COERCED_DEFAULTS = {
  false: [/\.toBe\(\s*false\s*\)/],
  0: [
    /\.toBe\(\s*0\s*\)/,
    /\.toHaveLength\(\s*0\s*\)/,
    /\.toHaveCount\(\s*0\s*\)/,
  ],
  null: [/(?<!not)\.toBeNull\(\)/],
  "[]": [/\.toEqual\(\s*\[\s*\]\s*\)/, /\.toHaveLength\(\s*0\s*\)/],
};

for (const [absFile, lineNumbers] of added) {
  const relPath = path.relative(REPO_ROOT, absFile).replace(/\\/g, "/");
  if (!inScope(relPath)) continue;
  let src;
  try {
    src = readFileSync(absFile, "utf8");
  } catch {
    continue;
  }
  const lines = src.split("\n");
  const coerce = /\.catch\(\(\s*\)\s*=>\s*(\[\s*\]|null|0|false)\s*\)/g;
  for (const match of src.matchAll(coerce)) {
    const key = match[1].replace(/\s+/g, "");
    const patterns = COERCED_DEFAULTS[key];
    if (!patterns) continue;
    const ahead = src.slice(match.index + match[0].length, match.index + 900);
    if (!patterns.some((re) => re.test(ahead))) continue;
    const lineNumber = src.slice(0, match.index).split("\n").length;
    if (!lineNumbers.has(lineNumber)) continue;
    if ((lines[lineNumber - 1] ?? "").includes("e2e-harness-ignore")) continue;
    violations.push(
      `  ${relPath}:${lineNumber}: read failure coerced to \`${key}\`, which is ` +
        `also what this asserts — an unreadable value would satisfy the ` +
        `assertion. Let the read throw, or check the thing exists first.`,
    );
  }
}

const SWALLOWED_ACTION =
  /\.(click|hover|fill|press|dblclick|check|uncheck|selectOption|setInputFiles|focus|tap|dragTo|waitFor|scrollIntoViewIfNeeded)\(/;
const SWALLOW =
  /\.catch\(\(\s*\)\s*=>\s*(?:\{\s*\}|false|null|undefined|0|""|'')\s*\)/g;

for (const [absFile, lineNumbers] of added) {
  const relPath = path.relative(REPO_ROOT, absFile).replace(/\\/g, "/");
  if (!inScope(relPath)) continue;
  let src;
  try {
    src = readFileSync(absFile, "utf8");
  } catch {
    continue;
  }
  const lines = src.split("\n");
  for (const match of src.matchAll(SWALLOW)) {
    const awaitAt = src.lastIndexOf("await", match.index);
    if (awaitAt === -1) continue;
    const expression = src.slice(awaitAt, match.index + match[0].length);
    if (expression.includes(";")) continue;
    const action = SWALLOWED_ACTION.exec(expression);
    if (!action) continue;
    if (/timeout:\s*\d/.test(expression)) continue;
    const lineNumber = src.slice(0, match.index).split("\n").length;
    if (!lineNumbers.has(lineNumber)) continue;
    if ((lines[lineNumber - 1] ?? "").includes("e2e-harness-ignore")) continue;
    violations.push(
      `  ${relPath}:${lineNumber}: swallowed .${action[1]}() — an absent ` +
        `locator waits out the full actionTimeout and the catch makes that ` +
        `look like success. Check presence first (count()/isVisible()) or ` +
        `pass an explicit short timeout.`,
    );
  }
}

for (const [absFile] of added) {
  const relPath = path.relative(REPO_ROOT, absFile).replace(/\\/g, "/");
  if (!inScope(relPath) || relPath.endsWith("/e2e/helpers.ts")) continue;
  let src;
  try {
    src = readFileSync(absFile, "utf8");
  } catch {
    continue;
  }
  if (src.includes("e2e-harness-ignore")) continue;
  const scopesSelection = /\{[ \t]*screenId:[ \t]*\w/.test(src);
  const unscopedRead = /\bdesignFrame\([ \t]*[\w.]+[ \t]*\)/.test(src);
  if (scopesSelection && unscopedRead) {
    violations.push(
      `  ${relPath}: passes a screenId to a selection helper but also reads ` +
        `designFrame(page) unscoped — those can resolve different screens. ` +
        `Pass the same screenId to both, or read the screen explicitly.`,
    );
  }
}

if (violations.length > 0) {
  console.error("guard-e2e-harness failed:\n");
  console.error(violations.join("\n"));
  console.error(
    "\nIf an added line is genuinely correct, append an inline " +
      "`e2e-harness-ignore` comment with the reason.",
  );
  process.exit(1);
}

console.log("guard-e2e-harness: OK — no new harness drift on added lines.");
