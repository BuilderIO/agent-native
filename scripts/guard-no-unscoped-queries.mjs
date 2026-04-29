#!/usr/bin/env node
/**
 * guard-no-unscoped-queries.mjs
 *
 * Defensive CI guard: refuse to let any code query an "ownable" resource
 * table without going through framework access control.
 *
 * Background (2026-04-28 incident — slides leak): A user signed up via
 * Google for the slides template and saw decks owned by other users. Root
 * cause: `templates/slides/server/handlers/decks.ts` ran
 * `db.select().from(schema.decks)` with no `accessFilter` / `resolveAccess`
 * / `assertAccess` — the HTTP handler bypassed the access control that the
 * agent action `list-decks.ts` correctly applied.
 *
 * Ownable resources are tables that include `...ownableColumns()` and
 * register a companion shares table via `createSharesTable()`. They MUST be
 * queried with one of:
 *
 *   - `accessFilter(table, sharesTable)` in the WHERE clause (list/read)
 *   - `resolveAccess("<type>", id)` (read by id)
 *   - `assertAccess("<type>", id, role)` (write/delete by id)
 *   - explicit `eq(table.ownerEmail, currentUserEmail)` filter
 *
 * Files that legitimately bypass access control (e.g. share-link viewer,
 * background jobs running as the resource owner, registry helpers) can
 * opt out per-file with the marker comment:
 *
 *   // guard:allow-unscoped — short reason
 *
 * The marker must include "guard:allow-unscoped" exactly. Reviewers should
 * push back on every new opt-out.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".netlify",
  ".vercel",
  ".wrangler",
  ".react-router",
  ".generated",
  "coverage",
]);

// Helpers indicating the file applies framework access control.
const ACCESS_CONTROL_HELPERS = [
  /\baccessFilter\s*\(/,
  /\bresolveAccess\s*\(/,
  /\bassertAccess\s*\(/,
  /\bgetShareableResource\s*\(/,
  /\bregisterShareableResource\s*\(/,
  /\baccessFilterForShares\s*\(/,
];

// Explicit filtering by ownerEmail in raw SQL or Drizzle.
const EXPLICIT_OWNER_FILTERS = [
  /ownerEmail\s*[,=]/, // Drizzle column references in eq/where
  /\bowner_email\s*=\s*\?/, // Raw SQL parameter
  /\bowner_email\s*=\s*currentUser/i,
  /WHERE\s+[a-z_.]*owner_email/i,
];

// Files that legitimately don't need access control (added to the
// allowlist below, NOT a fallback). Keep this list small and reviewed.
const FILE_ALLOWLIST = new Set([
  // Sharing primitives themselves — they implement access control.
  "packages/core/src/sharing/access.ts",
  "packages/core/src/sharing/registry.ts",
  "packages/core/src/sharing/schema.ts",
  // Share-resource action: queries the shares table by resource id, gated
  // by its own assertAccess on the parent resource (verified manually).
  "packages/core/src/sharing/actions/share-resource.ts",
  "packages/core/src/sharing/actions/unshare-resource.ts",
  "packages/core/src/sharing/actions/list-resource-shares.ts",
  "packages/core/src/sharing/actions/set-resource-visibility.ts",
]);

const OPT_OUT_MARKER = /\/\/\s*guard:allow-unscoped\b/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Scan a schema.ts file. Return the set of exported names whose definition
 * spreads `ownableColumns()`.
 */
function extractOwnableExports(file, contents) {
  const exports = new Set();
  // Match patterns like:
  //   export const decks = table("decks", { ... ...ownableColumns() ... });
  //   export const documents = pgTable("documents", { ... ...ownableColumns() ...});
  // Greedy across braces is good enough for our schema files.
  const tableRegex =
    /export\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:[a-zA-Z_$][\w$]*Table|table)\s*\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\}\s*(?:,[\s\S]*?)?\)\s*;?/gm;
  let m;
  while ((m = tableRegex.exec(contents)) !== null) {
    const exportName = m[1];
    const rawSqlName = m[2];
    const body = m[3];
    if (/\.\.\.ownableColumns\s*\(/.test(body)) {
      exports.add(exportName);
      // Also remember the raw SQL table name for raw SQL detection.
      exports.add(`__sql__${rawSqlName}`);
    }
  }
  return exports;
}

/**
 * Build a map of "schema source dir" → set of ownable export names.
 */
async function collectOwnableTables() {
  // Map: directory of schema.ts (as repo-relative posix path) → Set<string>
  const byDir = new Map();
  for await (const file of walk(REPO_ROOT)) {
    if (!file.endsWith("/db/schema.ts")) continue;
    const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!/ownableColumns\s*\(/.test(contents)) continue;
    const ownables = extractOwnableExports(file, contents);
    if (ownables.size > 0) {
      const dir = path.dirname(rel); // e.g. templates/slides/server/db
      byDir.set(dir, ownables);
    }
  }
  return byDir;
}

/**
 * Given the table's exported name (e.g. "decks") build the regexes that
 * indicate a query against it.
 */
function makeQueryRegexes(name) {
  return [
    // Drizzle: from(schema.decks), .from(decks)
    new RegExp(`\\.\\s*from\\s*\\(\\s*(?:schema\\s*\\.)?${name}\\b`),
    // Drizzle: db.update(schema.decks)
    new RegExp(`\\bdb\\s*\\.\\s*update\\s*\\(\\s*(?:schema\\s*\\.)?${name}\\b`),
    // Drizzle: db.delete(schema.decks)
    new RegExp(`\\bdb\\s*\\.\\s*delete\\s*\\(\\s*(?:schema\\s*\\.)?${name}\\b`),
    // Drizzle: db.insert(schema.decks) — captured because callers can leak
    // by inserting rows with someone else's ownerEmail.
    new RegExp(`\\bdb\\s*\\.\\s*insert\\s*\\(\\s*(?:schema\\s*\\.)?${name}\\b`),
  ];
}

function makeRawSqlRegexes(sqlName) {
  // Require the SQL to appear inside a string literal (backtick / single
  // / double quote) — without this, JSDoc comments like "Extracts animation
  // logic from compositions" trigger false positives. The match must include
  // a quote character anywhere in the surrounding ~12-char window.
  return [
    new RegExp(`["'\`][^"'\`]*\\bFROM\\s+${sqlName}\\b`, "i"),
    new RegExp(`["'\`][^"'\`]*\\bUPDATE\\s+${sqlName}\\b`, "i"),
    new RegExp(`["'\`][^"'\`]*\\bDELETE\\s+FROM\\s+${sqlName}\\b`, "i"),
    new RegExp(`["'\`][^"'\`]*\\bINSERT\\s+INTO\\s+${sqlName}\\b`, "i"),
  ];
}

/**
 * For each scanned file, check if it queries any ownable table without
 * applying access control. Returns the list of violations.
 */
async function scanFiles(ownablesByDir) {
  // Build a flat set of all ownable Drizzle export names (we don't try to
  // tie a query to a specific schema dir — too brittle. Any unscoped query
  // against any name in the union is a violation candidate.)
  const allOwnableNames = new Set();
  const allOwnableSqlNames = new Set();
  for (const set of ownablesByDir.values()) {
    for (const name of set) {
      if (name.startsWith("__sql__"))
        allOwnableSqlNames.add(name.slice("__sql__".length));
      else allOwnableNames.add(name);
    }
  }

  const drizzleRegexesByName = new Map();
  for (const name of allOwnableNames) {
    drizzleRegexesByName.set(name, makeQueryRegexes(name));
  }
  const rawSqlRegexesByName = new Map();
  for (const sqlName of allOwnableSqlNames) {
    rawSqlRegexesByName.set(sqlName, makeRawSqlRegexes(sqlName));
  }

  const violations = [];

  for await (const file of walk(REPO_ROOT)) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (FILE_ALLOWLIST.has(rel)) continue;
    // Skip schema files themselves.
    if (rel.endsWith("/db/schema.ts")) continue;
    // Only scan paths that can contain HTTP/agent code paths. We exclude
    // `app/` (frontend) because it can't talk to the DB directly — only
    // `app/routes/api/` would be server-side and that's covered by the
    // server/ glob in templates that follow Nitro conventions.
    if (
      !/^templates\/[^/]+\/(server|actions)\//.test(rel) &&
      !/^packages\/[^/]+\/src\//.test(rel)
    ) {
      continue;
    }
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Cheap pre-filter: skip files with no queries at all.
    if (
      !/\bfrom\s*\(/.test(contents) &&
      !/\bdb\s*\.\s*(update|delete|insert)\b/.test(contents) &&
      !/\b(FROM|UPDATE|INSERT INTO|DELETE FROM)\b/i.test(contents)
    ) {
      continue;
    }

    // File-wide opt-out
    if (OPT_OUT_MARKER.test(contents)) continue;

    const hasAccessControl =
      ACCESS_CONTROL_HELPERS.some((re) => re.test(contents)) ||
      EXPLICIT_OWNER_FILTERS.some((re) => re.test(contents));

    // Find every ownable name appearing in a query in this file.
    const hits = [];
    for (const [name, regexes] of drizzleRegexesByName.entries()) {
      for (const re of regexes) {
        if (re.test(contents)) {
          hits.push({ name, kind: "drizzle" });
          break;
        }
      }
    }
    for (const [sqlName, regexes] of rawSqlRegexesByName.entries()) {
      for (const re of regexes) {
        if (re.test(contents)) {
          hits.push({ name: sqlName, kind: "raw-sql" });
          break;
        }
      }
    }
    if (hits.length === 0) continue;
    if (hasAccessControl) continue;

    // Find the line numbers of the first hit per ownable name for the
    // report.
    const lines = contents.split("\n");
    const lineHits = [];
    for (const hit of hits) {
      const regexes =
        hit.kind === "drizzle"
          ? drizzleRegexesByName.get(hit.name)
          : rawSqlRegexesByName.get(hit.name);
      let firstLine = -1;
      for (let i = 0; i < lines.length && firstLine === -1; i++) {
        for (const re of regexes) {
          if (re.test(lines[i])) {
            firstLine = i + 1;
            break;
          }
        }
      }
      lineHits.push({ ...hit, line: firstLine });
    }
    violations.push({ file: rel, hits: lineHits });
  }

  return violations;
}

const ownablesByDir = await collectOwnableTables();
if (ownablesByDir.size === 0) {
  console.log(
    "guard-no-unscoped-queries: no ownable tables found — nothing to check.",
  );
  process.exit(0);
}
const violations = await scanFiles(ownablesByDir);

if (violations.length > 0) {
  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error(
    "ERROR: unscoped query against an ownable resource table.",
  );
  console.error(bar);
  console.error("");
  console.error(
    "These files query a table that includes `ownableColumns()` but do",
  );
  console.error(
    "NOT use `accessFilter` / `resolveAccess` / `assertAccess` or filter",
  );
  console.error("by `ownerEmail` explicitly. That is how the slides leak");
  console.error(
    "happened on 2026-04-28 — anyone signing in saw every other user's",
  );
  console.error("decks.");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}`);
    for (const hit of v.hits) {
      const where = hit.line > 0 ? `:${hit.line}` : "";
      console.error(`    queries ownable table "${hit.name}"${where} (${hit.kind})`);
    }
    console.error("");
  }
  console.error(bar);
  console.error("Fix:");
  console.error("");
  console.error("  - For list/read of many rows, add to the WHERE clause:");
  console.error(
    "      .where(accessFilter(schema.<table>, schema.<table>Shares))",
  );
  console.error(
    '      from "@agent-native/core/sharing"',
  );
  console.error("  - For read-by-id, replace the manual select with:");
  console.error('      const access = await resolveAccess("<type>", id);');
  console.error("  - For write/delete-by-id, gate with:");
  console.error('      await assertAccess("<type>", id, "editor"|"admin");');
  console.error(
    "  - HTTP handlers that don't auto-mount a request context must",
  );
  console.error(
    "    wrap the call with `runWithRequestContext({ userEmail, orgId },",
  );
  console.error(
    "    fn)` after reading the session via `getSession(event)`.",
  );
  console.error("");
  console.error("  Last-resort opt-out (requires reviewer approval):");
  console.error("    // guard:allow-unscoped — explain why this is safe");
  console.error(`${bar}\n`);
  process.exit(1);
}

console.log(
  `guard-no-unscoped-queries: clean (${ownablesByDir.size} schema dirs scanned).`,
);
