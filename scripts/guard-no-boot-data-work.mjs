#!/usr/bin/env node
/**
 * guard-no-boot-data-work.mjs
 *
 * These apps run as serverless functions, so a server plugin's startup body is
 * not "once per deploy" — it is once per COLD START, on the critical path of
 * the request unlucky enough to trigger it, and again on the next cold start.
 * Data work placed there is therefore paid over and over, forever, by users.
 *
 * This has cost real outages and sustained slowness, not hypothetical ones:
 * Slides startup slowness, Analytics paying startup cost on API calls, and a
 * production outage. The shape that did it looks like this, awaited in a
 * plugin's default export before anything can be served:
 *
 *   await migrations(nitroApp);
 *   await retypeBooleanColumnsOnPostgres();   // rewrites tables on Postgres
 *   await backfillLegacyClipsTables();
 *   await syncWorkspacesToOrganizations();
 *   await backfillRecordingOrgId();
 *
 * Schema DDL used to be exempt here, on the reasoning that migrations are
 * bounded and short-circuit cheaply. That was an assumption, and it was wrong:
 * on the Analytics production database (180 tables, 1920 columns) the migration
 * "fast path" measured 5.5s and the information_schema probe 8.3s. Health
 * checks timed out at 25s and the app was effectively down. The exemption is
 * how the pattern survived a cleanup meant to remove it — so there is no
 * exemption any more. Anything awaited in a plugin body is flagged, schema
 * setup included, and anything that truly must run first says so on the line.
 *
 * Where to put it instead — all three already exist in this repo:
 *   - a scheduled job / cron (see the `recurring-jobs` and `automations` skills),
 *   - a one-off CLI or script run at release time, deliberately, once,
 *   - lazily, behind the first caller that actually needs the data, memoized.
 *
 * Scope: only lines ADDED on this branch (via scripts/lib/changed-lines.mjs),
 * under a template's, app's, or package's server directory. The existing
 * boot-time backlog is a separate, schedulable cleanup — this stops the habit
 * from growing, which is the only thing a guard can honestly do.
 *
 * Opt-out, when the work genuinely must happen before serving and is bounded:
 *
 *   // guard:allow-boot-data-work — short reason
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved we say so loudly and exit 0, because a silent pass
 * here would look identical to a real clean run.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-boot-data-work\b/;

/** Server startup code. A route handler is per-request and not this guard's business. */
const IN_SCOPE =
  /^(templates\/[^/]+\/server\/|packages\/[^/]+\/src\/server\/|apps\/[^/]+\/server\/)/;
const SKIPPED = /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/)/;

/**
 * SCHEMA DDL IS NO LONGER EXEMPT. This guard originally waved through
 * `migrations`, `ensureTable`, `ensureAdditiveColumns` and friends on the
 * reasoning that they short-circuit cheaply once applied. Measured on the
 * Analytics production database, which has 180 tables and 1920 columns:
 *
 *   SELECT 1                                  1.96s
 *   SELECT MAX(version) FROM …_migrations      5.47s   <- the "fast path"
 *   information_schema probe (ensureAdditive)  8.26s
 *
 * Every cold start paid that before it could serve, health checks timed out at
 * 25s, and the app was effectively down. "Bounded and fast" was an assumption,
 * not a measurement, and the exemption is exactly how the pattern survived a
 * cleanup that was supposed to remove it.
 *
 * So: ANY awaited call in a server plugin body is flagged. Schema setup that
 * genuinely must run before serving is still allowed — it just has to say so
 * on the line, where a reviewer sees it, instead of inheriting a blanket
 * exemption written by someone who never measured it.
 */
const DATA_WORK = new RegExp(
  String.raw`\bawait\s+(` +
    [
      // Schema/migration work. Bounded in principle, 5-8s in practice on a
      // large database — and paid on every cold start, forever.
      "\\w*[Mm]igrations?\\w*",
      "ensureTable\\w*",
      "ensureColumn\\w*",
      "ensureAdditiveColumns",
      "ensureSchema\\w*",
      "ensure\\w*Index\\w*",
      "widen\\w*",
      "retypeBoolean\\w*",
      "backfill\\w*",
      "retype\\w*",
      "reconcile\\w*",
      "recompute\\w*",
      "aggregate\\w*",
      "rollup\\w*",
      "\\w*Rollup",
      "sweep\\w*",
      "prune\\w*",
      "resync\\w*",
      "sync\\w+To\\w+",
      "rebuildIndex\\w*",
      "reindex\\w*",
      "warmCache\\w*",
      "preload\\w*",
      "seed\\w*",
      // Data seeding wearing an `ensure*` name: INSERTs per owner or per org,
      // whose cost grows with the workspace.
      "ensureDefault\\w*",
      "ensure\\w*Configs?",
      "ensure\\w*Automations?",
      "ensure\\w*Jobs?",
    ].join("|") +
    `)\\s*\\(`,
);

/**
 * A plugin's default export body and module scope both run at startup. This is
 * a line-oriented approximation: a call sitting at low indentation in a server
 * plugin is startup code, while one nested inside a handler or callback is not.
 * Cheap and wrong in the safe direction — deep nesting is skipped, so the guard
 * under-reports rather than crying wolf.
 */
const MAX_STARTUP_INDENT = 4;

function isStartupContext(line, file) {
  const indent = line.length - line.trimStart().length;
  if (indent > MAX_STARTUP_INDENT) return false;
  // Plugin files are startup by definition; elsewhere only module scope counts.
  if (/\/server\/plugins\//.test(file)) return true;
  return indent === 0;
}

const added = addedLines(REPO_ROOT);
if (added === null) {
  console.error(
    "guard-no-boot-data-work: cannot resolve a diff base (no origin/main or main).",
  );
  console.error(
    "  This is NOT a clean result — nothing was checked. Fetch main and re-run.",
  );
  process.exit(0);
}

const violations = [];
for (const [absPath, lineNumbers] of added) {
  const rel = path.relative(REPO_ROOT, absPath);
  if (!IN_SCOPE.test(rel) || SKIPPED.test(rel)) continue;
  if (!/\.(ts|tsx|mjs|js)$/.test(rel)) continue;

  let lines;
  try {
    lines = readFileSync(absPath, "utf8").split("\n");
  } catch {
    continue; // deleted or renamed since the diff was computed
  }

  for (const lineNumber of lineNumbers) {
    const line = lines[lineNumber - 1];
    if (!line) continue;
    const match = DATA_WORK.exec(line);
    if (!match) continue;
    if (!isStartupContext(line, rel)) continue;
    if (PRAGMA.test(line) || PRAGMA.test(lines[lineNumber - 2] ?? "")) continue;
    violations.push({ file: rel, line: lineNumber, call: match[1] });
  }
}

if (violations.length === 0) {
  console.log("guard-no-boot-data-work: OK");
  process.exit(0);
}

console.error(
  `guard-no-boot-data-work: ${violations.length} data operation(s) added to server startup.`,
);
console.error(
  "\nA server plugin body runs on every COLD START, before the process can answer\n" +
    "anything. Work whose cost grows with the table gets paid there over and over,\n" +
    "by whichever user's request triggered the cold start. This exact pattern has\n" +
    "caused sustained slowness and a production outage here.\n",
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} — await ${v.call}(...)`);
}
console.error(
  "\nMove it to one of the places that already exist for this:\n" +
    "  - a scheduled job (see the `recurring-jobs` / `automations` skills)\n" +
    "  - a one-off CLI or release-time script, run deliberately once\n" +
    "  - lazily behind the first caller that needs it, memoized\n",
);
console.error(
  "Schema DDL is NOT exempt. On a 180-table database the migration fast path\n" +
    "measured 5.5s and the information_schema probe 8.3s — paid on every cold\n" +
    "start, which took an app down. Bounded is not the same as fast.\n\n" +
    "If it genuinely must run before this app can serve a correct response, say\n" +
    "so on the line so a reviewer sees the decision:\n" +
    "  // guard:allow-boot-data-work — short reason\n",
);

process.exit(1);
