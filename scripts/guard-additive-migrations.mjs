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
 *   - ADD COLUMN ... NOT NULL (or PRIMARY KEY) on an existing table with no
 *     usable DEFAULT and no self-filling value (SERIAL/IDENTITY/a stored
 *     generated column). Beta and production migrate independently against
 *     one shared database, so a not-null column with nothing to fill it
 *     breaks on the first existing row, and breaks any already-deployed
 *     INSERT that doesn't know the column exists yet. The ADD-COLUMN
 *     detector runs SQL comments, string literals, and quoted identifiers
 *     through `maskSqlNoise` first, so a keyword appearing inside one of
 *     those can't be mistaken for a real constraint; parses `ALTER TABLE`'s
 *     optional `IF EXISTS`/`ONLY` and quoted or schema-qualified relation
 *     names properly instead of assuming the table name is one bare token;
 *     and never confuses `ADD CONSTRAINT`/`CHECK`/`UNIQUE`/`PRIMARY
 *     KEY`/`FOREIGN KEY`/`EXCLUDE` (table-level, no column involved) for an
 *     `ADD COLUMN`. `DEFAULT` only counts when it's a real column default —
 *     `... ON DELETE SET DEFAULT` and `DEFAULT NULL` are both rejected as
 *     not providing an existing row a usable value.
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
 * legacy integer-backed boolean column landed as BIGINT on Postgres and
 * rejected JS booleans on insert. The fix always retypes to `boolean` with
 * an explicit `USING <col>::int::boolean`-style cast, which
 * is total and lossless for a column that only ever held 0/1. Retyping to
 * anything OTHER than boolean is still flagged unconditionally.
 *
 * Opt-out pragma for a genuinely reviewed one-off (place on the same file
 * line as the matched statement, or the line immediately above it):
 *
 *   // guard:allow-destructive-ddl — <reason>
 *
 * The blocking-not-null-column check has its own pragma, since it isn't
 * destructive DDL:
 *
 *   // guard:allow-blocking-column-default — <reason>
 *
 * SQL files may use either `//` or `--` for either pragma comment.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execGuardCommand } from "./lib/changed-lines.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRAGMA_RE = /^\s*(?:\/\/|--)\s*guard:allow-destructive-ddl\b/i;
const BLOCKING_COLUMN_PRAGMA_RE =
  /^\s*(?:\/\/|--)\s*guard:allow-blocking-column-default\b/i;

/**
 * The engine itself, not a migration list - its doc comments demonstrate
 * migration syntax (including conditional ALTER examples) and would be a
 * false-positive source if scanned as one.
 */
const NOT_A_MIGRATION_LIST = new Set(["packages/core/src/db/migrations.ts"]);

function findMigrationSourceFiles() {
  const tracked = execGuardCommand("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
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

function isPragmaed(lines, lineNumber, pragmaRe = PRAGMA_RE) {
  return (
    pragmaRe.test(lines[lineNumber - 1] ?? "") ||
    pragmaRe.test(lines[lineNumber - 2] ?? "")
  );
}

/**
 * Splits a comma-separated clause list at paren depth 0. Callers only ever
 * pass this function text that has already been through `maskSqlNoise`, so
 * string/identifier literals hold no real `(`/`)`/`,` characters any more —
 * this needs no quote-awareness of its own, only paren depth.
 */
function splitTopLevelClauseRanges(text) {
  const ranges = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      ranges.push({ start, end: i });
      start = i + 1;
    }
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

// Blanks out the content of block comments, '...' string literals, and
// "..." quoted identifiers to a same-length run of spaces (newlines
// preserved), while keeping every delimiter (the comment markers, the
// quote characters, and escaped '' / "" pairs) exactly where it was. This
// is what lets every keyword regex below (NOT NULL, PRIMARY KEY, DEFAULT,
// SERIAL, ...) search plain SQL text without also matching a column named
// not_null, a comment mentioning DEFAULT, or a string literal containing
// "PRIMARY KEY" — while the ALTER TABLE header parser can still see the
// quotes themselves to find where a quoted, possibly space-containing
// identifier ends. Because it's length-preserving, an offset computed
// against the masked text always lands on the same character in the
// original text.
function maskSqlNoise(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "/" && text[i + 1] === "*") {
      out += "/*";
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < text.length) {
        out += "*/";
        i += 2;
      }
      continue;
    }
    if (text[i] === "'" || text[i] === '"') {
      const quote = text[i];
      out += quote;
      i++;
      while (i < text.length) {
        if (text[i] === quote && text[i + 1] === quote) {
          out += quote + quote;
          i += 2;
          continue;
        }
        if (text[i] === quote) break;
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < text.length) {
        out += quote;
        i++;
      }
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

// A column with one of these gets a value on every existing row without an
// explicit DEFAULT, so NOT NULL is safe: SERIAL/BIGSERIAL/SMALLSERIAL assign
// the next sequence value, and GENERATED ... AS IDENTITY does the same.
const SELF_FILLING_COLUMN_RE =
  /\b(?:SMALL|BIG)?SERIAL\b|\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i;

// Optional IF EXISTS / ONLY, then a possibly schema-qualified, possibly
// double-quoted (with "" escapes) relation name, then an optional `*`
// (explicit "include descendants") marker — the actual PostgreSQL grammar
// for an ALTER TABLE header, so `ALTER TABLE ONLY "tenant orders" ADD ...`
// strips its whole header instead of leaving `"tenant orders" ADD ...`
// behind for the ADD-clause matcher to trip over.
const ALTER_TABLE_HEADER_RE =
  /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"(?:[^"]|"")+"|[A-Za-z_]\w*)(?:\.(?:"(?:[^"]|"")+"|[A-Za-z_]\w*))*\s*\*?\s*/i;

// Matches only an actual ADD-COLUMN clause. `COLUMN` is optional in real
// PostgreSQL grammar, so when it's absent this also has to reject the
// table-level forms that share the same "ADD <keyword>" shape — ADD
// CONSTRAINT/CHECK/UNIQUE/PRIMARY KEY/FOREIGN KEY/EXCLUDE — none of which
// name a column at all, let alone one that needs a default.
const ADD_COLUMN_CLAUSE_RE =
  /^\s*ADD\s+(?:COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?\S|(?:IF\s+NOT\s+EXISTS\s+)?(?!(?:CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b)\S)/i;

/**
 * A real, usable column default: `DEFAULT` is only ever a column-default
 * keyword here once the referential-action phrase `... SET DEFAULT` (from
 * `ON DELETE`/`ON UPDATE SET DEFAULT`) is stripped out, and `DEFAULT NULL`
 * is rejected outright — it backfills existing rows with NULL, which is
 * exactly what a `NOT NULL` addition cannot tolerate.
 */
function hasUsableColumnDefault(maskedClause) {
  const withoutReferentialAction = maskedClause.replace(
    /\bSET\s+DEFAULT\b/gi,
    "",
  );
  if (!/\bDEFAULT\b/i.test(withoutReferentialAction)) return false;
  if (/\bDEFAULT\s+NULL\b/i.test(withoutReferentialAction)) return false;
  return true;
}

/**
 * True for `GENERATED ALWAYS AS ( <expr> ) STORED` — a stored generated
 * column computes its value from the row's other columns, so it fills in
 * on every existing row the same way a DEFAULT would. Depth-matches the
 * parens (reusing the same helper the migration-array scanner uses below)
 * instead of a non-greedy regex, so a generation expression with its own
 * nested call — `COALESCE(a, b)`, `CONCAT(x, y)` — doesn't truncate the
 * match at the first `)` it contains.
 */
function hasStoredGeneratedExpression(maskedClause) {
  const marker = /GENERATED\s+ALWAYS\s+AS\s*\(/i.exec(maskedClause);
  if (!marker) return false;
  const openIdx = marker.index + marker[0].length - 1;
  const closeIdx = findMatchingBracket(maskedClause, openIdx, "(", ")");
  if (closeIdx >= maskedClause.length) return false;
  return /^\s*STORED\b/i.test(maskedClause.slice(closeIdx + 1));
}

/**
 * `ADD COLUMN ... NOT NULL` (or `PRIMARY KEY`, which implies NOT NULL) with
 * no DEFAULT and no self-filling type breaks on the first existing row —
 * and breaks any already-deployed code path that inserts without knowing
 * the new column exists. The additive fix is always available: make the
 * column nullable, or give it a DEFAULT, and backfill separately if needed.
 */
function blockingAddColumnMatches(statementText) {
  if (!/\bALTER\s+TABLE\b/i.test(statementText)) return [];
  const maskedStatement = maskSqlNoise(statementText);
  const header = ALTER_TABLE_HEADER_RE.exec(maskedStatement);
  if (!header) return [];
  const headerLength = header[0].length;
  const maskedAfterTable = maskedStatement.slice(headerLength);
  const originalAfterTable = statementText.slice(headerLength);

  const hits = [];
  for (const range of splitTopLevelClauseRanges(maskedAfterTable)) {
    const maskedClause = maskedAfterTable.slice(range.start, range.end);
    if (!ADD_COLUMN_CLAUSE_RE.test(maskedClause)) continue;
    const requiresValue =
      /\bNOT\s+NULL\b/i.test(maskedClause) ||
      /\bPRIMARY\s+KEY\b/i.test(maskedClause);
    if (!requiresValue) continue;
    if (hasUsableColumnDefault(maskedClause)) continue;
    if (
      SELF_FILLING_COLUMN_RE.test(maskedClause) ||
      hasStoredGeneratedExpression(maskedClause)
    ) {
      continue;
    }
    const originalClause = originalAfterTable.slice(range.start, range.end);
    hits.push(originalClause.trim().slice(0, 120));
  }
  return hits;
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
      const line = lineOf(src, blob.absStart + stmt.offset);

      const hits = destructiveMatches(stmt.text);
      if (hits.length > 0 && !isPragmaed(lines, line)) {
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

      const blockingColumns = blockingAddColumnMatches(stmt.text);
      if (
        blockingColumns.length > 0 &&
        !isPragmaed(lines, line, BLOCKING_COLUMN_PRAGMA_RE)
      ) {
        violations.push({
          file,
          line,
          message:
            `ADD COLUMN with no DEFAULT is not backward compatible: ${blockingColumns.join("; ")} — ` +
            "an existing row has no value for this column, and code already " +
            "deployed against the old schema doesn't know to provide one on " +
            "insert. Make the column nullable, or give it a DEFAULT, then " +
            "backfill separately if needed. If this is a genuinely reviewed " +
            "exception, add `// guard:allow-blocking-column-default — <reason>` " +
            "on this line or the line above.",
        });
      }
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
