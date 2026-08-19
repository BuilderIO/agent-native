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

const ENSURE_CALL_RE = /\bensureTableExists\s*\(/;
const ALLOW_MARKER_RE = /guard:allow-unreleased-schema\s*[—-]\s*\S/;
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts)$/i;
const TEST_FILE = /\.(?:spec|test)\.(?:ts|tsx|mts|cts)$/i;

/** The list under audit, plus the helper that implements the probe itself. */
const RELEASE_LIST = "src/server/release-schema.ts";
const DDL_GUARD = "src/db/ddl-guard.ts";
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
function coveredModules(coreDir: string, listSource: string): Set<string> {
  const covered = new Set<string>();
  const importRe = /from\s+"([^"]+)"/g;
  for (const match of listSource.matchAll(importRe)) {
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

  const covered = coveredModules(coreDir, listSource);
  const srcDir = path.join(coreDir, "src");

  for (const file of walk(srcDir)) {
    if (!SOURCE_EXTENSIONS.test(file) || TEST_FILE.test(file)) continue;
    const rel = relPosix(coreDir, file);
    if (rel === RELEASE_LIST || rel === DDL_GUARD) continue;
    if (rel.startsWith(GUARDS_DIR)) continue;

    const source = readFileSafe(file);
    if (source === null) continue;
    const code = stripComments(source);
    if (!ENSURE_CALL_RE.test(code)) continue;
    if (covered.has(rel)) continue;
    if (ALLOW_MARKER_RE.test(source)) continue;

    const lines = code.split("\n");
    const line = lines.findIndex((text) => ENSURE_CALL_RE.test(text)) + 1;
    findings.push({
      file: rel,
      line: line > 0 ? line : 1,
      message:
        "calls ensureTableExists() but is not imported by src/server/release-schema.ts, so its tables are never created on a hosted deploy.",
    });
  }

  findings.sort((a, b) => a.file.localeCompare(b.file));
  return { name: "release-schema-complete", findings };
}
