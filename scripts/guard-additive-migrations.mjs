#!/usr/bin/env node
/**
 * guard-additive-migrations.mjs
 *
 * CLAUDE.md requires schema changes to be additive: "Never drop, rename,
 * truncate, or destructively alter tables or columns in migrations or
 * startup code." Nothing enforced that until now — guard-no-drizzle-push
 * only blocks the `drizzle-kit push` CLI, and guard-migration-manifest.ts
 * governs package *export* moves, not DDL.
 *
 * Background: schema drift has shown up as production 500s more than once,
 * including parallel branches that each extended the same migration list
 * with different DDL under the SAME version numbers. Whichever branch
 * deployed first recorded "vN..vM applied" in the bookkeeping table; the
 * other branch's migrations at those numbers were then silently skipped —
 * `MAX(version)` was already past them, so the runner never ran their DDL,
 * yet the bookkeeping row said "applied". See the "Name-based tracking"
 * doc comment on `runMigrations` in packages/core/src/db/migrations.ts for
 * the full incident writeup (the analytics template's v75-v83 range).
 *
 * This guard scans two kinds of migration sources (see git ls-files
 * filtering below): the JS/TS migration-entry arrays consumed by
 * `runMigrations()` (every "migrations.ts" module and every template's
 * "server/plugins/db.ts" plugin that embeds its array inline), and the raw
 * idempotent .sql files under a template's supabase/migrations directory.
 * It fails on:
 *
 *   - Destructive DDL: DROP TABLE, DROP COLUMN, DROP INDEX (IF EXISTS is
 *     only accepted for indexes — Postgres' own safe-drop escape hatch),
 *     TRUNCATE, ALTER COLUMN ... TYPE, RENAME TO, RENAME COLUMN, and
 *     DELETE FROM without a WHERE clause.
 *   - Two migration entries in the same array declaring the same
 *     `version` number — the exact parallel-branch collision above.
 *
 * The additive alternative is always available: add a new nullable column
 * (or table) and backfill it, rather than dropping/renaming/retyping the
 * old one in place.
 *
 * Known, reviewed exception baked into the scan itself (not a pragma,
 * because it recurs across templates and is a narrow, well-understood
 * case): `ALTER COLUMN ... TYPE boolean` is exempt. Several templates
 * carry a one-time repair for a real bug — `adaptSqlForPostgres` in
 * packages/core/src/db/migrations.ts rewrites `INTEGER` to `BIGINT`, so a
 * Drizzle `integer({ mode: "boolean" })` column landed as BIGINT on
 * Postgres and rejected JS booleans on insert. The fix always retypes to
 * `boolean` with an explicit `USING <col>::int::boolean`-style cast, which
 * is total and lossless for a column that only ever held 0/1. Retyping to
 * anything OTHER than boolean is still flagged unconditionally.
 *
 * Opt-out pragma for a genuinely reviewed one-off (place on the same file
 * line as the matched statement, or the line immediately above it):
 *
 *   // guard:allow-destructive-ddl — <reason>
 *
 * SQL files may use either `//` or `--` for the pragma comment.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRAGMA_RE = /^\s*(?:\/\/|--)\s*guard:allow-destructive-ddl\b/i;

/**
 * The engine itself, not a migration list — its doc comments demonstrate
 * migration syntax (including dialect-gated ALTER examples) and would be a
 * false-positive source if scanned as one.
 */
const NOT_A_MIGRATION_LIST = new Set(["packages/core/src/db/migrations.ts"]);

function findMigrationSourceFiles() {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  return tracked.filter((file) => {
    if (NOT_A_MIGRATION_LIST.has(file)) return false;
    if (file.endsWith(".spec.ts") || file.endsWith(".test.ts")) return false;
    if (path.basename(file) === "migrations.ts") return true;
    if (file.endsWith("server/plugins/db.ts")) return true;
    if (/\/supabase\/migrations\/.*\.sql$/.test(file)) return true;
    return false;
  });
}

/** Read a `` `...` `` template literal starting at the opening backtick. */
function readTemplateLiteral(src, start) {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === "`") return { text: src.slice(start + 1, i), end: i + 1 };
    i++;
  }
  return { text: src.slice(start + 1), end: src.length };
}

/** Every backtick-delimited literal in a file, with its absolute start offset. */
function extractBacktickLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === "`") {
      const { text, end } = readTemplateLiteral(src, i);
      out.push({ text, absStart: i + 1 });
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Only literals that look like an actual SQL statement are treated as
 * migration DDL — this is what keeps the scan from tripping over unrelated
 * template literals (log lines, error messages) that share these files
 * with the real migration entries.
 */
const SQL_START_RE =
  /^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|TRUNCATE|WITH|GRANT|REVOKE)\b/i;

/**
 * Advance from an opening bracket to its match, skipping over string/
 * template literals and comments so a `[`/`]`/`{`/`}` inside SQL text (JSON
 * defaults, Postgres `ARRAY[...]`) can't miscount the nesting depth.
 */
function findMatchingBracket(src, openIdx, openCh, closeCh) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "`") {
      i = readTemplateLiteral(src, i).end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === openCh) depth++;
    if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return src.length;
}

/**
 * Every top-level migration-entry array in a file: a `[` immediately
 * (modulo whitespace/line comments) followed by `{ version:`. This finds
 * both an inline `runMigrations([...])` argument and a `export const FOO =
 * [...]` list consumed elsewhere, without caring which — the version
 * numbers inside are the same shared bookkeeping-table namespace either
 * way. A file with more than one `runMigrations()` call (each against its
 * own bookkeeping table, e.g. Content's `content_migrations` and
 * `content_source_migrations`) yields one independent region per call, so
 * version numbers are never compared across the two.
 */
const REGION_START_RE =
  /\[\s*(?:\/\/[^\n]*\n\s*)*\{\s*(?:\/\/[^\n]*\n\s*)*version:/g;

function findMigrationRegions(src) {
  const regions = [];
  let searchFrom = 0;
  while (searchFrom < src.length) {
    REGION_START_RE.lastIndex = searchFrom;
    const m = REGION_START_RE.exec(src);
    if (!m) break;
    const end = findMatchingBracket(src, m.index, "[", "]");
    regions.push({ start: m.index, end });
    searchFrom = end + 1;
  }
  return regions;
}

/** Split a SQL blob into statements, respecting '...' strings and -- comments. */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let stmtStart = 0;
  let i = 0;
  let inSingle = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inSingle && ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "'") {
      buf += ch;
      if (inSingle && next === "'") {
        buf += next;
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (ch === ";" && !inSingle) {
      if (buf.trim()) out.push({ text: buf, offset: stmtStart });
      buf = "";
      i++;
      stmtStart = i;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push({ text: buf, offset: stmtStart });
  return out;
}

const DESTRUCTIVE_CHECKS = [
  { name: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  // DROP INDEX's own IF EXISTS is the one accepted safe-drop form; an
  // optional CONCURRENTLY can sit between INDEX and IF EXISTS on Postgres.
  {
    name: "DROP INDEX without IF EXISTS",
    re: /\bDROP\s+INDEX\s+(?!(?:CONCURRENTLY\s+)?IF\s+EXISTS\b)/i,
  },
  { name: "TRUNCATE", re: /\bTRUNCATE\b/i },
  // See the module doc comment: retyping TO boolean is the one recurring,
  // reviewed exception (a lossless fix for a real INTEGER→BIGINT bug).
  // Retyping to anything else still fails.
  {
    name: "ALTER COLUMN ... TYPE",
    re: /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\s+(?!boolean\b)\w/i,
  },
  { name: "RENAME TO", re: /\bRENAME\s+TO\b/i },
  { name: "RENAME COLUMN", re: /\bRENAME\s+COLUMN\b/i },
];

function destructiveMatches(statementText) {
  const hits = [];
  for (const check of DESTRUCTIVE_CHECKS) {
    if (check.re.test(statementText)) hits.push(check.name);
  }
  if (
    /^\s*DELETE\s+FROM\b/i.test(statementText) &&
    !/\bWHERE\b/i.test(statementText)
  ) {
    hits.push("DELETE FROM without WHERE");
  }
  return hits;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

function isPragmaed(lines, lineNumber) {
  return (
    PRAGMA_RE.test(lines[lineNumber - 1] ?? "") ||
    PRAGMA_RE.test(lines[lineNumber - 2] ?? "")
  );
}

function scanFile(file) {
  const violations = [];
  const src = readFileSync(path.join(REPO_ROOT, file), "utf8");
  const lines = src.split("\n");
  const isSql = file.endsWith(".sql");

  const blobs = isSql
    ? [{ text: src, absStart: 0 }]
    : extractBacktickLiterals(src).filter((b) => SQL_START_RE.test(b.text));

  for (const blob of blobs) {
    for (const stmt of splitStatements(blob.text)) {
      const hits = destructiveMatches(stmt.text);
      if (hits.length === 0) continue;
      const line = lineOf(src, blob.absStart + stmt.offset);
      if (isPragmaed(lines, line)) continue;
      violations.push({
        file,
        line,
        message:
          `matched ${hits.join(", ")} in: ${stmt.text.trim().slice(0, 120)} — ` +
          "migrations must be additive-only; add a new nullable column (or " +
          "table) and backfill it instead of dropping/renaming/retyping in " +
          "place. If this is a genuinely reviewed exception, add " +
          "`// guard:allow-destructive-ddl — <reason>` on this line or the " +
          "line above.",
      });
    }
  }

  if (!isSql) {
    for (const region of findMigrationRegions(src)) {
      const regionText = src.slice(region.start, region.end);
      const seenAtLine = new Map();
      const versionRe = /version:\s*(\d+)/g;
      let m;
      while ((m = versionRe.exec(regionText))) {
        const version = m[1];
        const line = lineOf(src, region.start + m.index);
        const firstLine = seenAtLine.get(version);
        if (firstLine === undefined) {
          seenAtLine.set(version, line);
          continue;
        }
        violations.push({
          file,
          line,
          message:
            `duplicate migration version ${version} (first declared at line ${firstLine}) — ` +
            "two migrations in the same list share a version number, which is " +
            "exactly the parallel-branch collision that lets one of them get " +
            "recorded as applied while its DDL never ran. Give the newer entry " +
            "the next unused version number (and a stable `name:` slug).",
        });
      }
    }
  }

  return violations;
}

function main() {
  const files = findMigrationSourceFiles();
  const violations = files.flatMap(scanFile);

  if (violations.length === 0) {
    console.log(
      `guard-additive-migrations: OK (${files.length} migration source file(s) scanned)`,
    );
    process.exit(0);
  }

  console.error(
    `\nguard-additive-migrations: ${violations.length} violation(s) found.\n`,
  );
  console.error(
    "Schema changes must be additive-only (see CLAUDE.md). Destructive DDL " +
      "in a migration can silently corrupt the applied-migrations bookkeeping " +
      "in production — see the header comment in this script for the incident " +
      "this rule prevents.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.message}`);
  }
  console.error("");
  process.exit(1);
}

main();
