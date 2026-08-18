#!/usr/bin/env node
/**
 * guard-route-chunk-recovery.mjs
 *
 * Every template client entry must install `installRouteChunkRecovery()`.
 *
 * Background: a user keeps an old tab open, we deploy, and their next lazy
 * route import 404s against hashed chunk filenames that no longer exist. The
 * app white-screens with "Failed to fetch dynamically imported module"
 * (Chromium/Firefox) or "Importing a module script failed" (WebKit). The fix
 * lives in packages/core/src/client/route-chunk-recovery.ts and turns that
 * dead page into a single guarded navigation to the fresh build.
 *
 * It was written once and wired into only five templates; the other ten kept
 * white-screening on every deploy for a year because nothing asserted it. This
 * guard is what stops the eleventh fork.
 *
 * Checks every `templates/<name>/app/entry.client.tsx` that exists (a template
 * with no client entry, e.g. docs, is skipped — it has no lazy route chunks to
 * lose). Requires both the import from the `route-chunk-recovery` subpath
 * (never the client barrel — see guard:no-core-client-barrel-imports) and the
 * call itself.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const TEMPLATES_DIR = join(REPO_ROOT, "templates");
const ENTRY_REL = join("app", "entry.client.tsx");
const IMPORT_SPECIFIER = "@agent-native/core/client/route-chunk-recovery";
const CALL = "installRouteChunkRecovery()";

function listTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules",
    )
    .map((entry) => entry.name)
    .sort();
}

const failures = [];
let checked = 0;

for (const template of listTemplates()) {
  const path = join(TEMPLATES_DIR, template, ENTRY_REL);
  if (!existsSync(path)) continue;
  checked += 1;
  const source = readFileSync(path, "utf-8");
  if (!source.includes(IMPORT_SPECIFIER)) {
    failures.push(
      `templates/${template}/${ENTRY_REL} does not import from "${IMPORT_SPECIFIER}".`,
    );
    continue;
  }
  if (!source.includes(CALL)) {
    failures.push(
      `templates/${template}/${ENTRY_REL} imports the recovery but never calls ${CALL}.`,
    );
  }
}

// Fail closed: a guard that silently stops finding any entry to check is
// indistinguishable from a passing one, which is the failure mode this guard
// exists to prevent.
if (checked === 0) {
  console.error(
    `[guard:route-chunk-recovery] found no templates/*/${ENTRY_REL} to check — the guard is not running against anything.`,
  );
  process.exit(1);
}

if (failures.length > 0) {
  console.error(
    `[guard:route-chunk-recovery] ${failures.length} template client entr(ies) can white-screen after a deploy:\n`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    `\nAdd both lines near the top of the entry, before hydrateRoot():\n` +
      `  import { installRouteChunkRecovery } from "${IMPORT_SPECIFIER}";\n` +
      `  ${CALL};\n`,
  );
  process.exit(1);
}

console.log(
  `[guard:route-chunk-recovery] OK — ${checked} template client entr(ies) install stale-chunk recovery.`,
);
