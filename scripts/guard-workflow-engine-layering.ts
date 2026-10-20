/**
 * guard-workflow-engine-layering.ts
 *
 * The Factory workflow engine (templates/factory/server/workflow/) is pure
 * logic that has to stay liftable out of the template: no database, no
 * network, no Factory modules. The one place it may reach into the rest of
 * Factory is adapter.ts, which declares what the host provides as an
 * interface. A second, quiet import of a Factory helper is how an engine
 * stops being liftable, so this guard fails on it.
 *
 * Inside the folder this flags, in every .ts/.tsx file except adapter.ts:
 *   - a relative import that resolves outside the folder
 *   - the template's own aliases: `@/…`, `@shared/…`, and bare `app/…`,
 *     `server/…`, `shared/…`, `actions/…`, `scripts/…` (its tsconfig maps
 *     every bare specifier onto the template root)
 *   - an absolute path or `file:` URL
 * Relative imports that stay inside the folder, package imports, and `node:`
 * builtins are fine. Imports are read with the same scanner as
 * guard-toolkit-must-not-import-core, so comments and strings do not count.
 *
 * The whole folder is scanned on every run; there is no diff base. If the
 * folder is missing or empty, or a file cannot be read, the guard exits
 * GUARD_EXIT_COULD_NOT_RUN, which run-guards.ts reports as SKIPPED: a run that
 * inspected nothing must not look like a clean one.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanModuleSpecifiers } from "./guard-toolkit-must-not-import-core";
import { GUARD_EXIT_COULD_NOT_RUN } from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:workflow-engine-layering";
const ENGINE_DIR = "templates/factory/server/workflow";
const ADAPTER_FILE = `${ENGINE_DIR}/adapter.ts`;
const FACTORY_ALIAS = /^@(?:shared)?\//;
const FACTORY_ROOT_DIRS = new Set([
  "app",
  "server",
  "shared",
  "actions",
  "scripts",
]);
const SOURCE_FILE = /\.[cm]?tsx?$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist"]);

export interface LayeringViolation {
  file: string;
  line: number;
  specifier: string;
  reason: string;
}

function insideEngine(repoRelativePath: string): boolean {
  return (
    repoRelativePath === ENGINE_DIR ||
    repoRelativePath.startsWith(`${ENGINE_DIR}/`)
  );
}

export function shouldScanEngineFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return (
    insideEngine(normalized) &&
    normalized !== ADAPTER_FILE &&
    SOURCE_FILE.test(normalized) &&
    !normalized.split("/").some((segment) => SKIPPED_DIRECTORIES.has(segment))
  );
}

function reasonFor(file: string, specifier: string): string | null {
  if (specifier.startsWith(".")) {
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), specifier),
    );
    return insideEngine(resolved)
      ? null
      : "relative import that leaves the workflow folder";
  }
  if (specifier.startsWith("/") || specifier.startsWith("file:")) {
    return "absolute path import";
  }
  if (FACTORY_ALIAS.test(specifier)) return "Factory path alias";
  const [first] = specifier.split("/");
  if (FACTORY_ROOT_DIRS.has(first)) {
    return `bare import resolved against the Factory template root ("${first}/")`;
  }
  return null;
}

export function findLayeringViolations(
  file: string,
  source: string,
): LayeringViolation[] {
  const normalized = file.replace(/\\/g, "/");
  return scanModuleSpecifiers(source).flatMap(({ index, value }) => {
    const reason = reasonFor(normalized, value);
    if (!reason) return [];
    let line = 1;
    for (let cursor = 0; cursor < index; cursor += 1) {
      if (source.charCodeAt(cursor) === 10) line += 1;
    }
    return [{ file: normalized, line, specifier: value, reason }];
  });
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : walk(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function main(): void {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const engineRoot = path.join(rootDir, ENGINE_DIR);

  let candidates: string[];
  try {
    if (!statSync(engineRoot).isDirectory()) throw new Error("not a directory");
    candidates = walk(engineRoot);
  } catch (error) {
    console.error(
      `${GUARD_NAME}: could not read ${ENGINE_DIR}: ${(error as Error).message}`,
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }

  const files = candidates
    .map((absolute) =>
      path.relative(rootDir, absolute).split(path.sep).join("/"),
    )
    .filter(shouldScanEngineFile);
  if (files.length === 0) {
    console.error(
      `${GUARD_NAME}: found no source files to inspect under ${ENGINE_DIR}, so the check did not run.`,
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }

  const violations: LayeringViolation[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(path.join(rootDir, file), "utf8");
    } catch (error) {
      console.error(
        `${GUARD_NAME}: could not read ${file}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
    violations.push(...findLayeringViolations(file, source));
  }

  if (violations.length === 0) {
    console.log(`${GUARD_NAME}: OK (${files.length} file(s) inspected)`);
    return;
  }

  console.error(
    `${GUARD_NAME}: ${violations.length} import(s) reach outside the workflow engine.`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} imports "${violation.specifier}" (${violation.reason})`,
    );
  }
  console.error(
    `\nThe engine in ${ENGINE_DIR}/ stays liftable: it imports only from its\n` +
      "own folder and from packages. Declare what it needs from Factory as an\n" +
      `interface in ${ADAPTER_FILE} and have Factory implement it from outside\n` +
      "the folder. adapter.ts is the one file allowed to import Factory code.",
  );
  process.exit(1);
}

// Compared by real path: a symlinked checkout must still run the check, not
// skip it and exit 0.
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return (
    entry !== undefined &&
    realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  );
}

if (isEntrypoint()) main();
