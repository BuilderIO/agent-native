#!/usr/bin/env node
/**
 * guard-no-blob-column-predicate.mjs
 *
 * A `WHERE` predicate on a large text/JSON column makes `LIMIT` USELESS.
 *
 * Postgres stores big values out of line (TOAST). A predicate that reads such a
 * column forces a fetch and detoast of the full value for EVERY row the scan
 * touches — and that happens BEFORE `LIMIT` applies, so asking for fewer rows
 * does not cost less. The column does not even have to be selected.
 *
 * Measured in production on the agent chat sidebar list, which returns ~20 rows
 * of {title, updatedAt} and nothing else:
 *
 *   thread_data NOT LIKE '%"integrationDeliveryAttempted":true%'
 *
 *   with the predicate      2207ms / 2258ms   (8512 bytes returned)
 *   without it               222ms /  309ms   (same 8512 bytes)
 *   with it, at limit=5     3166ms            (2000 bytes returned)
 *
 * `limit=5` costing MORE than `limit=20` is the fingerprint of this bug: the
 * work is proportional to rows scanned and bytes detoasted, not rows returned.
 *
 * ## What is flagged, and what deliberately is not
 *
 * Flagged: a `LIKE` / `NOT LIKE` / `ILIKE` against a heavy column where the
 * pattern is a HARDCODED LITERAL. That shape is a marker lookup — some flag
 * buried inside a JSON blob — and a marker belongs in its own indexed column.
 * The one that caused the outage above was a legacy compensator for rows
 * written before `source_platform` existed; the fix was to backfill that column
 * once in a migration and delete the predicate.
 *
 * NOT flagged: the same match against a BOUND PARAMETER (`?`, `$1`). That is a
 * user-supplied search term, and searching inside message history is a real
 * feature with no cheaper implementation. `searchThreads` does exactly this and
 * must keep working. Distinguishing on literal-vs-parameter is what keeps this
 * guard from crying wolf at legitimate full-text search.
 *
 * If a literal match against a blob is genuinely the right call, say so on the
 * line so a reviewer sees the decision:
 *
 *   // guard:allow-blob-predicate — short reason
 *
 * Known limitation, stated so a pass is not misread as coverage: this matches
 * a PHYSICAL LINE. A predicate split across lines — the column at the end of
 * one, `NOT LIKE '…'` at the start of the next — is invisible here. Closing
 * that needs SQL-aware parsing of template literals, not a longer regex.
 * The formatting this codebase actually produces keeps the comparison on one
 * line (oxfmt does not break inside a template literal), which is why a
 * line-oriented check is worth having rather than nothing.
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED, because a silent pass would look identical
 * to a real clean run.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-blob-predicate\b/;

/**
 * All first-party source. Deliberately NOT narrowed to `server/` or `actions/`.
 *
 * The bug this guard exists for lived in
 * `packages/core/src/chat-threads/store.ts` — a store module under none of
 * those directories. A directory-shaped scope would have reported a clean pass
 * on the exact line it was written to catch, which is the same blind spot
 * `guard:no-boot-data-work` had. The predicate below is specific enough (a SQL
 * LIKE against a known-heavy column, with a literal pattern) that scanning
 * broadly costs nothing; missing the one file that matters costs everything.
 */
const IN_SCOPE = /^(packages|templates|apps)\//;
const SKIPPED = /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/)/;

/**
 * Column names that hold a value big enough to be TOASTed. Deliberately a name
 * list rather than schema analysis: the guard runs on a diff, and a name like
 * `thread_data` or `config` is the reliable signal available at that level.
 * Small columns a list legitimately filters on — title, preview, name, slug,
 * email — are absent on purpose.
 */
const HEAVY_COLUMN = String.raw`(?:\w*_)?(?:thread_?data|content|body|payload|config|layout|spec|tracks|snapshot|blob|html|markdown|messages|metadata|tool_?results|evidence_?json|options_?json|edits_?json|chapters_?json|json_?value|properties|data)`;

/**
 * `<heavy column> [NOT] LIKE/ILIKE '<literal>'` in raw SQL.
 *
 * Requires a quoted literal on the right-hand side. A `?` / `$1` placeholder is
 * a user search term and is intentionally not matched. The pattern is captured
 * so an INTERPOLATED template (`LIKE '%${term}%'`) can be excluded below — that
 * is a dynamic search term wearing a literal's punctuation.
 */
const RAW_SQL_LITERAL_MATCH = new RegExp(
  // `\)?` catches the common wrapped form, `LOWER(documents.content) LIKE '…'`,
  // which is strictly worse than the bare column: it materialises a lowercased
  // copy of the detoasted blob per row on top of the fetch.
  String.raw`\b${HEAVY_COLUMN}\b\s*\)?\s*(?:NOT\s+)?I?LIKE\s*(['"\`][^'"\`]*)`,
  "i",
);

/**
 * Drizzle form: `like(table.heavyColumn, "literal")` / `notLike(...)`.
 * A variable second argument (a bound search term) is not matched.
 */
const DRIZZLE_LITERAL_MATCH = new RegExp(
  String.raw`\b(?:not)?i?like\s*\(\s*[\w.]*\b${HEAVY_COLUMN}\b\s*,\s*(['"\`][^'"\`]*)`,
  "i",
);

/**
 * A quoted pattern containing `${` is built from a variable, so it is a search
 * term rather than a fixed marker — the same reason a `?` placeholder is
 * allowed. Flagging it would put the guard in the way of legitimate search.
 */
const INTERPOLATED = /\$\{/;

const added = requireAddedLines(REPO_ROOT, "guard-no-blob-column-predicate");

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
    const match =
      RAW_SQL_LITERAL_MATCH.exec(line) ?? DRIZZLE_LITERAL_MATCH.exec(line);
    if (!match) continue;
    if (INTERPOLATED.test(match[1] ?? "")) continue;
    if (PRAGMA.test(line) || PRAGMA.test(lines[lineNumber - 2] ?? "")) continue;
    violations.push({ rel, lineNumber, text: line.trim().slice(0, 140) });
  }
}

if (violations.length === 0) {
  console.log("guard-no-blob-column-predicate: clean");
  process.exit(0);
}

console.error(
  `\nguard-no-blob-column-predicate: ${violations.length} violation(s) found on lines this branch added.\n`,
);
for (const v of violations) {
  console.error(`  ${v.rel}:${v.lineNumber}  ${v.text}`);
}
console.error(`
Matching a literal against a large text/JSON column forces Postgres to fetch
and detoast that value for every row the scan touches, BEFORE LIMIT applies.
Measured on the chat sidebar list: 2207ms with the predicate, 222ms without,
and 3166ms at limit=5 — asking for fewer rows cost MORE.

A marker you match with a hardcoded string belongs in its own column:
  - add the column, backfill it once in a migration, then filter on it
  - a legacy compensator on a read path is a backfill you have not done yet,
    and you pay for it on every request until you do

Searching a blob against a BOUND PARAMETER is a real feature and is not
flagged; only hardcoded literals are.

If the literal match is genuinely right, say so on the line:
  // guard:allow-blob-predicate — short reason
`);
process.exit(1);
