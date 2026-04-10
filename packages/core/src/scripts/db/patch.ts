/**
 * Core script: db-patch
 *
 * Surgical search-and-replace on a text column in any SQL table. Instead of
 * re-sending the full column value (as `db-exec UPDATE` would require), the
 * agent sends one or more `{find, replace}` pairs. The script reads the row,
 * applies the edits in memory, and writes the result back in a single UPDATE.
 *
 * ## When to use which tool
 *
 *   Large text field, small slice to change       → db-patch (this)
 *     e.g. fix one paragraph in a 50KB document, tweak one key in a dashboard
 *     JSON blob, rename a label in a slide HTML string.
 *
 *   Short field, set outright                     → db-exec UPDATE
 *     e.g. `UPDATE forms SET status = 'published' WHERE id = '...'`.
 *
 *   Multiple columns / computed values            → db-exec UPDATE
 *     e.g. `UPDATE meals SET calories = calories + 50, ...`.
 *
 *   Domain-specific action exists                 → use that action
 *     e.g. `edit-document` or `update-slide` — they also push live Yjs
 *     updates to any open collaborative editor. db-patch is the generic
 *     fallback for tables without a bespoke action.
 *
 * ## Why it's faster
 *
 *   The agent only has to transmit the diff (the `find` + `replace`
 *   strings), not the full new value. For large text fields — multi-kilobyte
 *   markdown documents, slide HTML, dashboard/form JSON — this dramatically
 *   reduces tokens per edit and keeps concurrent edits composable.
 *
 * ## Security
 *
 *   In production mode, the same per-user / per-org temp view scoping that
 *   `db-exec` uses applies here: the SELECT and UPDATE both go through the
 *   scoped view, so you can never read or write rows outside the current
 *   user's data. The WHERE clause is validated against a keyword denylist
 *   (no ;, no chained statements, no DDL).
 *
 * ## Usage
 *
 *   pnpm action db-patch --table <t> --column <c> --where "<clause>" \
 *     --find "old" --replace "new"
 *
 *   pnpm action db-patch --table decks --column data --where "id='d1'" \
 *     --edits '[{"find":"Q3","replace":"Q4"},{"find":"$1M","replace":"$1.2M"}]'
 */

import path from "path";
import { createClient } from "@libsql/client";
import { getDatabaseUrl, getDatabaseAuthToken } from "../../db/client.js";
import { parseArgs, fail } from "../utils.js";
import { buildScopingPostgres, buildScopingSqlite } from "./scoping.js";

interface TextEdit {
  find: string;
  replace: string;
}

interface EditResult {
  index: number;
  status: "replaced" | "deleted" | "not-found";
  detail: string;
  occurrences: number;
}

interface PatchOutput {
  table: string;
  column: string;
  applied: number;
  total: number;
  bytesBefore: number;
  bytesAfter: number;
  results: EditResult[];
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

/** Only unquoted [A-Za-z_][A-Za-z0-9_]* identifiers are allowed — no spaces,
 *  no quoting, no dotted names. This is deliberately strict: it stops the
 *  agent from sneaking SQL into the table/column slots. */
function isValidIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/** Reject WHERE clauses that could chain statements or hide DDL. This isn't
 *  a full SQL parser — just a keyword/character denylist to keep the surface
 *  area equivalent to what db-exec already allows. */
function validateWhere(where: string): void {
  if (where.includes(";")) {
    fail("--where must not contain ';' (no statement chaining)");
  }
  // Strip inline strings before keyword scanning so "WHERE name = 'DROP TABLE'"
  // doesn't trip the denylist.
  const stripped = where
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .toUpperCase();

  const blocked = [
    " INSERT ",
    " UPDATE ",
    " DELETE ",
    " DROP ",
    " ALTER ",
    " CREATE ",
    " ATTACH ",
    " DETACH ",
    " PRAGMA ",
    " VACUUM ",
    "--",
    "/*",
  ];
  const padded = " " + stripped + " ";
  for (const kw of blocked) {
    if (padded.includes(kw)) {
      fail(`--where must not contain "${kw.trim()}"`);
    }
  }
}

function parseEdits(parsed: Record<string, string>): TextEdit[] {
  let edits: TextEdit[];

  if (parsed.edits) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(parsed.edits);
    } catch (e: any) {
      fail(`Invalid --edits JSON: ${e.message}`);
    }
    if (!Array.isArray(parsedJson) || parsedJson.length === 0) {
      fail("--edits must be a non-empty JSON array of {find, replace} objects");
    }
    edits = parsedJson as TextEdit[];
  } else if (parsed.find !== undefined) {
    if (parsed.find === "") fail("--find cannot be empty");
    edits = [{ find: parsed.find, replace: parsed.replace ?? "" }];
  } else {
    fail("Either --find/--replace or --edits is required");
  }

  for (const edit of edits!) {
    if (typeof edit.find !== "string" || edit.find === "") {
      fail("Each edit must have a non-empty 'find' string");
    }
    if (edit.replace === undefined || edit.replace === null) {
      edit.replace = "";
    }
    if (typeof edit.replace !== "string") {
      fail("Each edit's 'replace' field must be a string");
    }
  }

  return edits!;
}

function preview(s: string): string {
  const max = 60;
  const trimmed = s.replace(/\s+/g, " ");
  return trimmed.length > max ? trimmed.slice(0, max) + "..." : trimmed;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/** Apply edits sequentially. By default replaces only the first occurrence
 *  of each `find` (matching the behavior of the template-specific
 *  `edit-document` action). `--all` switches to replace-every-occurrence. */
function applyEdits(
  content: string,
  edits: TextEdit[],
  replaceAll: boolean,
): { content: string; results: EditResult[]; applied: number } {
  let out = content;
  const results: EditResult[] = [];
  let applied = 0;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const idx = out.indexOf(edit.find);

    if (idx === -1) {
      results.push({
        index: i,
        status: "not-found",
        detail: `NOT FOUND: "${preview(edit.find)}"`,
        occurrences: 0,
      });
      continue;
    }

    if (replaceAll) {
      const occurrences = countOccurrences(out, edit.find);
      // Literal replaceAll via split/join — no regex, no special chars.
      out = out.split(edit.find).join(edit.replace);
      applied++;
      results.push({
        index: i,
        status: edit.replace === "" ? "deleted" : "replaced",
        detail: `${edit.replace === "" ? "deleted" : "replaced"} ${occurrences}×: "${preview(edit.find)}"`,
        occurrences,
      });
    } else {
      out =
        out.slice(0, idx) + edit.replace + out.slice(idx + edit.find.length);
      applied++;
      results.push({
        index: i,
        status: edit.replace === "" ? "deleted" : "replaced",
        detail: `${edit.replace === "" ? "deleted" : "replaced"}: "${preview(edit.find)}"`,
        occurrences: 1,
      });
    }
  }

  return { content: out, results, applied };
}

function printResult(out: PatchOutput, format?: string): void {
  if (format === "json") {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`db-patch: ${out.table}.${out.column}`);
  console.log(`  Applied: ${out.applied}/${out.total}`);
  console.log(`  Bytes:   ${out.bytesBefore} → ${out.bytesAfter}`);
  for (const r of out.results) {
    console.log(`  - ${r.detail}`);
  }
}

interface RunOpts {
  url: string;
  table: string;
  column: string;
  where: string;
  edits: TextEdit[];
  replaceAll: boolean;
  format?: string;
}

// ─── Postgres path ──────────────────────────────────────────────────────────

async function runPostgres(opts: RunOpts): Promise<void> {
  const { default: pg } = await import("postgres");
  const pgSql = pg(opts.url);
  try {
    // Same temp-view scoping db-exec uses — SELECT and UPDATE both go through
    // the scoped view, so cross-user access is impossible even if --where is
    // permissive.
    const scoping = await buildScopingPostgres(pgSql);
    for (const stmt of scoping.setup) {
      await pgSql.unsafe(stmt);
    }

    const selectSql = `SELECT "${opts.column}" AS __val FROM "${opts.table}" WHERE ${opts.where}`;
    const selected: any[] = Array.from(await pgSql.unsafe(selectSql));

    if (selected.length === 0) {
      fail(
        `No rows matched: ${opts.table} WHERE ${opts.where}. ` +
          `(In production, data scoping filters results to the current user — the row may exist but be owned by someone else.)`,
      );
    }
    if (selected.length > 1) {
      fail(
        `WHERE matched ${selected.length} rows in ${opts.table}. db-patch expects exactly one row — narrow the WHERE clause (usually by primary key).`,
      );
    }

    const original = (selected[0].__val ?? "") as string;
    if (typeof original !== "string") {
      fail(
        `Column ${opts.table}.${opts.column} is not a text column (got ${typeof original}).`,
      );
    }

    const { content, results, applied } = applyEdits(
      original,
      opts.edits,
      opts.replaceAll,
    );

    if (applied > 0) {
      await pgSql.unsafe(
        `UPDATE "${opts.table}" SET "${opts.column}" = $1 WHERE ${opts.where}`,
        [content],
      );
    }

    printResult(
      {
        table: opts.table,
        column: opts.column,
        applied,
        total: opts.edits.length,
        bytesBefore: original.length,
        bytesAfter: content.length,
        results,
      },
      opts.format,
    );

    for (const stmt of scoping.teardown) {
      await pgSql.unsafe(stmt).catch(() => {});
    }
  } finally {
    await pgSql.end();
  }
}

// ─── SQLite / libSQL path ───────────────────────────────────────────────────

async function runSqlite(opts: RunOpts): Promise<void> {
  const client = createClient({
    url: opts.url,
    authToken: getDatabaseAuthToken(),
  });
  try {
    const scoping = await buildScopingSqlite(client);
    for (const stmt of scoping.setup) {
      await client.execute(stmt);
    }

    const selectSql = `SELECT "${opts.column}" AS __val FROM "${opts.table}" WHERE ${opts.where}`;
    const selectRes = await client.execute(selectSql);

    if (selectRes.rows.length === 0) {
      fail(
        `No rows matched: ${opts.table} WHERE ${opts.where}. ` +
          `(In production, data scoping filters results to the current user — the row may exist but be owned by someone else.)`,
      );
    }
    if (selectRes.rows.length > 1) {
      fail(
        `WHERE matched ${selectRes.rows.length} rows in ${opts.table}. db-patch expects exactly one row — narrow the WHERE clause (usually by primary key).`,
      );
    }

    const row = selectRes.rows[0] as any;
    const original = (row.__val ?? row[0] ?? "") as string;
    if (typeof original !== "string") {
      fail(
        `Column ${opts.table}.${opts.column} is not a text column (got ${typeof original}).`,
      );
    }

    const { content, results, applied } = applyEdits(
      original,
      opts.edits,
      opts.replaceAll,
    );

    if (applied > 0) {
      await client.execute({
        sql: `UPDATE "${opts.table}" SET "${opts.column}" = ? WHERE ${opts.where}`,
        args: [content],
      });
    }

    printResult(
      {
        table: opts.table,
        column: opts.column,
        applied,
        total: opts.edits.length,
        bytesBefore: original.length,
        bytesAfter: content.length,
        results,
      },
      opts.format,
    );

    for (const stmt of scoping.teardown) {
      await client.execute(stmt).catch(() => {});
    }
  } finally {
    client.close();
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

export default async function dbPatch(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help === "true") {
    console.log(`Usage: pnpm action db-patch --table <t> --column <c> --where "<clause>" [edit flags]

Surgical search-and-replace on a text column. Avoids re-sending the full
column value — ideal for large strings (documents, slides, dashboards, JSON).

Required:
  --table <name>        Target table (identifier; no quoting)
  --column <name>       Target text column (identifier; no quoting)
  --where "<clause>"    SQL WHERE clause that matches exactly one row

Edit mode (pick one):
  --find <text>         Text to find (single edit; default replace = "")
  --replace <text>      Replacement text (used with --find)
  --edits <json>        Batch: JSON array of {find, replace} objects

Options:
  --all                 Replace every occurrence of each 'find' (default: first only)
  --format json         Output as JSON
  --help                Show this help

Examples:
  # Fix a typo in one document
  pnpm action db-patch --table documents --column content \\
    --where "id='abc'" --find "teh" --replace "the"

  # Batch edits on a deck's JSON blob
  pnpm action db-patch --table decks --column data --where "id='d1'" \\
    --edits '[{"find":"\\"Q3\\"","replace":"\\"Q4\\""},{"find":"$1M","replace":"$1.2M"}]'

When to use db-patch vs other tools:
  Large text field, small edit                → db-patch (this)
  Short field or multi-column set             → db-exec UPDATE
  Domain action exists (edit-document, ...)   → use that action (syncs live
                                                to open collaborative editors)
`);
    return;
  }

  const table = parsed.table;
  const column = parsed.column;
  const where = parsed.where;

  if (!table) fail("--table is required");
  if (!column) fail("--column is required");
  if (!where) fail("--where is required");
  if (!isValidIdentifier(table))
    fail(
      `Invalid --table: "${table}". Must be a plain identifier (letters, digits, underscore).`,
    );
  if (!isValidIdentifier(column))
    fail(
      `Invalid --column: "${column}". Must be a plain identifier (letters, digits, underscore).`,
    );
  validateWhere(where);

  const edits = parseEdits(parsed);
  const replaceAll = parsed.all === "true";

  // Resolve database URL: --db flag → DATABASE_URL env → default file path
  let url: string;
  if (parsed.db) {
    url = "file:" + path.resolve(parsed.db);
  } else if (getDatabaseUrl()) {
    url = getDatabaseUrl();
  } else {
    url = "file:" + path.resolve(process.cwd(), "data", "app.db");
  }

  if (isPostgresUrl(url)) {
    await runPostgres({
      url,
      table,
      column,
      where,
      edits,
      replaceAll,
      format: parsed.format,
    });
  } else {
    await runSqlite({
      url,
      table,
      column,
      where,
      edits,
      replaceAll,
      format: parsed.format,
    });
  }
}
