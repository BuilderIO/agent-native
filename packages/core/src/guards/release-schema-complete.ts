/**
 * Every module that defines schema must export a `defineStore()` that is in the
 * generated store registry, and that registry must be fresh.
 *
 * Hosted request runtimes never create tables, so a module whose DDL is not
 * reachable from the release step has no path to creation on a hosted deploy.
 * Nothing fails at deploy time; the first symptom is a missing relation from a
 * user request. `settings`, `application_state`, `app_secrets` and `resources`
 * were once absent from the hand-kept release list for twelve days.
 */

import path from "node:path";

import { readFileSafe, relPosix, walk } from "./scan-utils.js";
import {
  STORE_REGISTRY_FILE,
  discoverStores,
  findDuplicateStoreIds,
  normalizeGenerated,
  renderStoreRegistry,
} from "./store-registry-codegen.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

const ENSURE_TABLE_RE = /\bensureTableExists\s*\(/;
const EXECUTES_RE = /\.execute\s*\(/;
const CREATE_TABLE_RE = /\bCREATE\s+TABLE\b/i;
const DDL_CONST_RE =
  /\b[A-Z][A-Z0-9_]*_(?:CREATE|TABLE|INDEX)_SQL(?:_[A-Z0-9]+)?\b/;

const definesSchema = (code: string) =>
  ENSURE_TABLE_RE.test(code) ||
  (EXECUTES_RE.test(code) &&
    (CREATE_TABLE_RE.test(code) || DDL_CONST_RE.test(code)));
const ALLOW_MARKER_RE = /guard:allow-unreleased-schema\s*[—-]\s*\S/;
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts)$/i;
const TEST_FILE = /\.(?:spec|test)\.(?:ts|tsx|mts|cts)$/i;

const RELEASE_MIGRATIONS = "src/server/release-migrations.ts";
const DDL_GUARD = "src/db/ddl-guard.ts";
const MIGRATION_RUNNER = "src/db/migrations.ts";
const STORE_RUNNER = "src/db/store-registry.ts";
const GUARDS_DIR = "src/guards/";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

export interface ReleaseSchemaScanOptions extends GuardScanOptions {
  corePackageDir?: string;
}

function coveredModules(
  coreDir: string,
  sources: Array<[relFile: string, source: string]>,
): Set<string> {
  const covered = new Set<string>();
  const importRe = /(?:from\s+|import\s*\(\s*)"([^"]+)"/g;
  for (const [relFile, source] of sources) {
    const fromDir = path.join(coreDir, path.dirname(relFile));
    for (const match of source.matchAll(importRe)) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      const resolved = path.resolve(fromDir, spec).replace(/\.js$/, ".ts");
      covered.add(relPosix(coreDir, resolved));
    }
  }
  return covered;
}

export function scanReleaseSchemaCoverage(
  options: ReleaseSchemaScanOptions,
): GuardResult {
  const coreDir =
    options.corePackageDir ?? path.join(options.root, "packages", "core");
  const findings: GuardFinding[] = [];

  const registrySource = readFileSafe(path.join(coreDir, STORE_REGISTRY_FILE));
  if (registrySource === null) {
    findings.push({
      file: STORE_REGISTRY_FILE,
      line: 1,
      message:
        "the generated store registry is missing; run `pnpm gen:store-registry`.",
    });
    return { name: "release-schema-complete", findings };
  }

  const stores = discoverStores(coreDir);
  for (const id of findDuplicateStoreIds(stores)) {
    findings.push({
      file: STORE_REGISTRY_FILE,
      line: 1,
      message: `defineStore id "${id}" is declared more than once.`,
    });
  }
  if (
    normalizeGenerated(registrySource) !==
    normalizeGenerated(renderStoreRegistry(stores))
  ) {
    findings.push({
      file: STORE_REGISTRY_FILE,
      line: 1,
      message:
        "is stale: it does not match the defineStore() exports in src; run `pnpm gen:store-registry`.",
    });
  }

  const covered = coveredModules(coreDir, [
    [STORE_REGISTRY_FILE, registrySource],
    [
      RELEASE_MIGRATIONS,
      readFileSafe(path.join(coreDir, RELEASE_MIGRATIONS)) ?? "",
    ],
  ]);
  const srcDir = path.join(coreDir, "src");

  for (const file of walk(srcDir)) {
    if (!SOURCE_EXTENSIONS.test(file) || TEST_FILE.test(file)) continue;
    const rel = relPosix(coreDir, file);
    if (rel === STORE_REGISTRY_FILE || rel === RELEASE_MIGRATIONS) continue;
    if (rel === DDL_GUARD || rel === STORE_RUNNER) continue;
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
        "creates tables but exports no defineStore() in the generated store registry, so they are never created on a hosted deploy.",
    });
  }

  findings.sort((a, b) => a.file.localeCompare(b.file));
  return { name: "release-schema-complete", findings };
}
