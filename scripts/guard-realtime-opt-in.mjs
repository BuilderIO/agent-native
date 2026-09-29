#!/usr/bin/env node
/**
 * Require an explicit, route-scoped reason before opening a realtime transport.
 * Only changed source lines are inspected; inability to resolve the base exits 2.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-realtime-opt-in\b/;
const SKIPPED = /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/)/;
const FORBIDDEN_PATH =
  /^(?:packages\/docs\/|packages\/core\/docs\/)|(?:^|\/)(?:public|marketing|docs|ssr)(?:\/|\.|$)/i;
const OPT_IN = /^\s*realtime\s*:/;
const REASON = /\breason\s*:\s*["'`]\s*[^"'`\s][^"'`]*["'`]/;

export function findRealtimeOptInViolations(file, source, addedLineNumbers) {
  if (SKIPPED.test(file) || !/\.(?:ts|tsx|js|jsx)$/.test(file)) return [];
  const lines = source.split("\n");
  const violations = [];
  for (const lineNumber of [...addedLineNumbers].sort((a, b) => a - b)) {
    const line = lines[lineNumber - 1];
    if (!line || !OPT_IN.test(line)) continue;
    const around = lines
      .slice(
        Math.max(0, lineNumber - 3),
        Math.min(lines.length, lineNumber + 12),
      )
      .join("\n");
    if (
      PRAGMA.test(line) ||
      PRAGMA.test(lines[lineNumber - 2] ?? "") ||
      PRAGMA.test(around)
    ) {
      continue;
    }

    const optInIndex = around.indexOf("realtime:");
    const expression = around.slice(optInIndex, optInIndex + 260);
    const reasonPresent = REASON.test(expression);
    const routeScoped =
      /\bpathname\b/.test(expression) &&
      /\?/.test(expression) &&
      /:\s*undefined\b/.test(expression);
    const forbidden = FORBIDDEN_PATH.test(file);

    if (!reasonPresent || forbidden || !routeScoped) {
      violations.push({
        file,
        line: lineNumber,
        missingReason: !reasonPresent,
        forbidden,
        missingRouteGate: !routeScoped,
      });
    }
  }
  return violations;
}

function main() {
  const added = requireAddedLines(REPO_ROOT, "guard-realtime-opt-in");
  const violations = [];
  for (const [absPath, lineNumbers] of added) {
    const file = path.relative(REPO_ROOT, absPath).replace(/\\/g, "/");
    if (SKIPPED.test(file) || !/\.(?:ts|tsx|js|jsx)$/.test(file)) continue;
    let source;
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    violations.push(...findRealtimeOptInViolations(file, source, lineNumbers));
  }

  if (violations.length === 0) {
    console.log("guard-realtime-opt-in: OK");
    process.exit(0);
  }

  console.error(
    `guard-realtime-opt-in: ${violations.length} realtime opt-in(s) need review.`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    if (violation.missingReason)
      console.error("    add a non-empty reason string");
    if (violation.forbidden)
      console.error(
        "    public, docs, marketing, and SSR routes must stay opted out",
      );
    if (violation.missingRouteGate)
      console.error(
        "    guard the opt-in by a private route pathname and return undefined elsewhere",
      );
  }
  console.error(
    "\nRealtime creates a shared background transport and a poll per open tab. " +
      "Opt in only when data changes without the user's action and must appear before refresh.\n" +
      "Reviewed exceptions may use: // guard:allow-realtime-opt-in — short reason",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
