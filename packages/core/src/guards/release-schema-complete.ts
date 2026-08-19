/**
 * Every store that defines schema through `ensureTableExists()` must be listed
 * in `server/release-schema.ts`.
 *
 * A store's `ensureTable()` is the only definition of its tables — there is no
 * second copy in a migration list. Production serverless can never run one
 * (`schemaEnsureDisabled()` reports every table present so a cold start skips
 * ~390 probes), so a store missing from the release list has no path to
 * creation on a hosted deploy at all. Nothing fails at deploy time; the first
 * symptom is `relation "..." does not exist` from a user request, long after
 * the commit that caused it.
 *
 * That is not hypothetical. `settings`, `application_state`, `app_secrets` and
 * `resources` were absent from the release path for twelve days, and published
 * sites came up with an empty database while the deploy reported success.
 */

import path from "node:path";

import { readFileSafe, relPosix, walk } from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

/**
 * What counts as "this module creates a table". `ensureTableExists` is the
 * intended helper, but a store that executes its DDL through the raw client
 * creates schema just as much, and needs the release pass just as much. Missing
 * that second form is how `extensions/slots/store.ts` stayed invisible to the
 * first version of this guard.
 *
 * Keyed on EXECUTING the DDL, not on containing it. A `schema.ts` that exports
 * `CREATE TABLE` strings and a migration list that stores them both mention the
 * SQL without ever running it: the first is executed by its own store, which is
 * on the list, and the second is applied by `runMigrations`.
 */
const ENSURE_TABLE_RE = /\bensureTableExists\s*\(/;
const EXECUTES_RE = /\.execute\s*\(/;
const CREATE_TABLE_RE = /\bCREATE\s+TABLE\b/i;
/**
 * DDL that lives in another module, the way `extensions/slots` keeps its SQL in
 * `slots/schema.ts`. Keyed on the `_CREATE_SQL` / `_TABLE_SQL` / `_INDEX_SQL`
 * naming rather than on any executed constant, so a plain
 * `execute(DB_PRESSURE_SQL)` SELECT is not mistaken for schema.
 */
const DDL_CONST_RE =
  /\b[A-Z][A-Z0-9_]*_(?:CREATE|TABLE|INDEX)_SQL(?:_[A-Z0-9]+)?\b/;

/**
 * Whether this module CREATES tables, in any of the three shapes the codebase
 * actually uses. Deliberately NOT keyed on the name of the executed expression:
 * stores run their DDL from a local `createSql` or `ddl` variable as often as
 * from a named constant, so requiring a recognisable name would let the
 * commonest shape of all walk past the guard.
 */
const definesSchema = (code: string) =>
  ENSURE_TABLE_RE.test(code) ||
  (EXECUTES_RE.test(code) &&
    (CREATE_TABLE_RE.test(code) || DDL_CONST_RE.test(code)));
const ALLOW_MARKER_RE = /guard:allow-unreleased-schema\s*[—-]\s*\S/;
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts)$/i;
const TEST_FILE = /\.(?:spec|test)\.(?:ts|tsx|mts|cts)$/i;

/**
 * The two halves of the release path. `release-schema.ts` runs the stores' own
 * ensure functions; `release-migrations.ts` runs the versioned migration lists
 * and a few schema runners of its own (better-auth). A module reached by either
 * one is created at release, so both count as coverage.
 */
const RELEASE_LIST = "src/server/release-schema.ts";
const RELEASE_MIGRATIONS = "src/server/release-migrations.ts";
const DDL_GUARD = "src/db/ddl-guard.ts";
/** The migration runner executes migration-list DDL; `runMigrations` owns it. */
const MIGRATION_RUNNER = "src/db/migrations.ts";
/** Guards describe this rule in prose; they never own schema. */
const GUARDS_DIR = "src/guards/";

/**
 * Blank out comments so a file that only NAMES `ensureTableExists` — this guard,
 * a doc block, a changelog note — is not reported as defining schema.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

export interface ReleaseSchemaScanOptions extends GuardScanOptions {
  /** Defaults to `<root>/packages/core`. */
  corePackageDir?: string;
}

/**
 * Import specifiers in `release-schema.ts`, resolved to repo-relative paths so
 * they can be compared against the files that actually call `ensureTableExists`.
 */
function coveredModules(coreDir: string, sources: string[]): Set<string> {
  const covered = new Set<string>();
  // Static `from "..."` and dynamic `import("...")`; the list uses the latter.
  const importRe = /(?:from\s+|import\s*\(\s*)"([^"]+)"/g;
  for (const match of sources.join("\n").matchAll(importRe)) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue;
    const fromDir = path.join(coreDir, "src", "server");
    const resolved = path.resolve(fromDir, spec).replace(/\.js$/, ".ts");
    covered.add(relPosix(coreDir, resolved));
  }
  return covered;
}

export function scanReleaseSchemaCoverage(
  options: ReleaseSchemaScanOptions,
): GuardResult {
  const coreDir =
    options.corePackageDir ?? path.join(options.root, "packages", "core");
  const findings: GuardFinding[] = [];

  const listSource = readFileSafe(path.join(coreDir, RELEASE_LIST));
  if (listSource === null) {
    // Not "nothing to check" — the list this guard exists to audit is gone.
    findings.push({
      file: RELEASE_LIST,
      line: 1,
      message:
        "release-schema.ts is missing; every framework table would stop being created at release time.",
    });
    return { name: "release-schema-complete", findings };
  }

  const covered = coveredModules(coreDir, [
    listSource,
    readFileSafe(path.join(coreDir, RELEASE_MIGRATIONS)) ?? "",
  ]);
  const srcDir = path.join(coreDir, "src");

  for (const file of walk(srcDir)) {
    if (!SOURCE_EXTENSIONS.test(file) || TEST_FILE.test(file)) continue;
    const rel = relPosix(coreDir, file);
    if (rel === RELEASE_LIST || rel === RELEASE_MIGRATIONS) continue;
    if (rel === DDL_GUARD) continue;
    if (rel === MIGRATION_RUNNER) continue;
    if (rel.startsWith(GUARDS_DIR)) continue;

    const source = readFileSafe(file);
    if (source === null) continue;
    const code = stripComments(source);
    if (!definesSchema(code)) continue;
    if (covered.has(rel)) continue;
    if (ALLOW_MARKER_RE.test(source)) continue;

    const lines = code.split("\n");
    const line = lines.findIndex((text) => definesSchema(text)) + 1;
    findings.push({
      file: rel,
      line: line > 0 ? line : 1,
      message:
        "creates tables but is not imported by src/server/release-schema.ts, so they are never created on a hosted deploy.",
    });
  }

  findings.sort((a, b) => a.file.localeCompare(b.file));
  return { name: "release-schema-complete", findings };
}
