#!/usr/bin/env node
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
