#!/usr/bin/env node
/**
 * guard-no-heavy-dashboard-list-reads.mjs
 *
 * Dashboard collection paths are where the expensive reads hurt most: a list
 * or search endpoint that pulls every dashboard row, or worse the whole config
 * blob, turns ordinary navigation into repeated large payload transfers and
 * JSON parsing on the critical path. That cost shows up as slow dashboard
 * pages, cold starts that never really warm up, and shared DB pressure that
 * does not stay local to the one caller who triggered it.
 *
 * This guard only scans lines ADDED on this branch (via
 * scripts/lib/changed-lines.mjs) and only in server-side code. It flags new
 * dashboard collection reads that are obviously heavy:
 *   - unprojected selects from schema.dashboards
 *   - projections that spread the whole dashboards row
 *   - projections that read schema.dashboards.config on a collection path
 *   - obvious dashboards.findMany collection reads
 *
 * Point reads by id stay allowed, because a single dashboard detail view is a
 * different cost profile from a list/search path. If the heavy read is truly
 * intentional, reviewers must see the decision on the line:
 *
 *   // guard:allow-heavy-dashboard-list-read — short reason
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED, because a silent pass would look
 * identical to a real clean run.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addedLines, requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-heavy-dashboard-list-read\b/;

const IN_SCOPE =
  /^(templates\/[^/]+\/(?:server|actions)\/|packages\/[^/]+\/src\/(?:server|actions)\/|apps\/[^/]+\/(?:server|actions)\/)/;
const SKIPPED = /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/)/;

const DASHBOARD_TABLE = "schema.dashboards";
const EMPTY_SELECT_RE =
  /\b(?:\w+\.)*select\s*\(\s*\)\s*\.from\(schema\.dashboards\)/s;
const FULL_ROW_SELECT_RE =
  /\b(?:\w+\.)*select\s*\(\s*(?:schema\.dashboards\b|{\s*\.{3}\s*schema\.dashboards\b\s*})\s*\)\s*\.from\(schema\.dashboards\)/s;
const CONFIG_PROJECTION_RE =
  /\b(?:\w+\.)*select\s*\(\s*{[\s\S]*?(?:schema\.dashboards\.config|\bconfig\s*:)[\s\S]*?}\s*\)\s*\.from\(schema\.dashboards\)/s;
const FIND_MANY_RE =
  /\b(?:\w+\.)*query\.dashboards\.findMany\s*\(|\bdashboards\.findMany\s*\(/s;
const POINT_READ_RE =
  /\bwhere\b[\s\S]{0,240}\b(?:schema\.dashboards|dashboards)\.id\b|\beq\s*\(\s*(?:schema\.dashboards|dashboards)\.id\b/;

export function findHeavyDashboardListReadViolations(
  file,
  source,
  addedLineNumbers,
) {
  if (!inScope(file)) return [];

  const lines = source.split("\n");
  const violations = [];
  const seen = new Set();

  for (const lineNumber of [...addedLineNumbers].sort((a, b) => a - b)) {
    const line = lines[lineNumber - 1];
    if (line === undefined) continue;

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const snippet = collectStatementSnippet(lines, lineNumber);
    if (
      PRAGMA.test(trimmed) ||
      PRAGMA.test(lines[lineNumber - 2] ?? "") ||
      PRAGMA.test(snippet)
    ) {
      continue;
    }

    if (!snippet.includes(DASHBOARD_TABLE) && !FIND_MANY_RE.test(snippet)) {
      continue;
    }
    if (POINT_READ_RE.test(snippet)) continue;

    const match = findViolation(snippet);
    if (!match) continue;

    const key = `${match.kind}:${match.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      file,
      line: lineNumber,
      ...match,
    });
  }

  return violations;
}

export function checkHeavyDashboardListReads(cwd) {
  const added = addedLines(cwd);
  if (added === null) return null;

  const violations = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(cwd, absPath).replace(/\\/g, "/");
    if (!inScope(rel) || SKIPPED.test(rel)) continue;

    let source;
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    violations.push(
      ...findHeavyDashboardListReadViolations(rel, source, lineNumbers),
    );
  }

  return violations;
}

function findViolation(window) {
  if (EMPTY_SELECT_RE.test(window)) {
    return {
      kind: "empty-select",
      snippet: "db.select().from(schema.dashboards)",
      reason: "unprojected dashboard collection read pulls full rows",
    };
  }

  if (FULL_ROW_SELECT_RE.test(window)) {
    return {
      kind: "full-row-select",
      snippet: "db.select(schema.dashboards).from(schema.dashboards)",
      reason: "dashboard collection read selects the full row",
    };
  }

  if (CONFIG_PROJECTION_RE.test(window)) {
    return {
      kind: "config-projection",
      snippet:
        "db.select({ config: schema.dashboards.config }).from(schema.dashboards)",
      reason: "dashboard collection read selects the config blob",
    };
  }

  if (FIND_MANY_RE.test(window)) {
    return {
      kind: "findMany",
      snippet: "db.query.dashboards.findMany(...)",
      reason: "dashboard collection search returns full rows by default",
    };
  }

  return null;
}

function inScope(relPath) {
  if (SKIPPED.test(relPath)) return false;
  return IN_SCOPE.test(relPath);
}

function collectStatementSnippet(lines, lineNumber) {
  let start = lineNumber - 1;
  while (start > 0) {
    const previous = lines[start - 1]?.trim() ?? "";
    if (previous.length === 0) break;
    if (previous.endsWith(";")) break;
    if (previous === "}") break;
    start -= 1;
  }

  let end = lineNumber - 1;
  while (end + 1 < lines.length) {
    const current = lines[end]?.trim() ?? "";
    if (current.endsWith(";")) break;
    const next = lines[end + 1]?.trim() ?? "";
    if (next.length === 0) break;
    if (next === "}") break;
    end += 1;
  }

  return lines.slice(start, end + 1).join("\n");
}

function main() {
  const violations = checkHeavyDashboardListReads(REPO_ROOT);
  if (violations === null) {
    // `checkHeavyDashboardListReads` keeps returning a typed absent so its spec
    // can assert on it; only the process boundary turns that into an exit code.
    requireAddedLines(REPO_ROOT, "guard-no-heavy-dashboard-list-reads");
  }

  if (violations.length === 0) {
    console.log("guard-no-heavy-dashboard-list-reads: OK");
    process.exit(0);
  }

  console.error(
    `guard-no-heavy-dashboard-list-reads: ${violations.length} heavy dashboard list read(s) added.`,
  );
  console.error(
    "\nA dashboard list or search path should stay narrow. Use summary reads\n" +
      "for collections and reserve full rows or config blobs for point reads by id.\n",
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} — ${violation.snippet}`,
    );
    console.error(`    ${violation.reason}`);
  }
  console.error(
    "\nIf the heavy read is intentional and reviewed, put the opt-out comment on\n" +
      "the flagged line or the line immediately above it:\n" +
      "  // guard:allow-heavy-dashboard-list-read — short reason\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
