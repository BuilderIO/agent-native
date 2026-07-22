#!/usr/bin/env node
/**
 * Template Standard — Phase 1 sync writer + drift guard.
 *
 * `pnpm guard:template-standard` (--check, the default guard entrypoint)  — read-only,
 *   reports every gap against scripts/template-standard/manifest.ts, ratcheted
 *   against scripts/template-standard-baseline.json (see baseline.ts for why).
 * `pnpm sync:template-standard` (--write) — creates MISSING byte-synced files
 *   from canonical content. Never overwrites an existing file. Not run by any
 *   CI step in Phase 1.
 *
 * Skills are intentionally out of scope here: `scripts/sync-workspace-core-skills.ts`
 * (wired as `guard:workspace-skills`) remains the sole authority for
 * `.agents/skills/*` sync/check, so this script never re-invokes it.
 */
import { join } from "node:path";

import {
  type BaselineEntry,
  loadBaseline,
  reconcile,
} from "./baseline.ts";
import { runAllChecks } from "./checks.ts";
import {
  CORE_ROUTES_FINDING,
  NEVER_STANDARDIZED,
  REPO_ROOT,
  listTemplates,
  readDevPorts,
} from "./manifest.ts";
import { syncByteSyncedFiles } from "./sync.ts";

const BASELINE_PATH = join(REPO_ROOT, "scripts", "template-standard-baseline.json");

const write = !process.argv.includes("--check");

function formatBaselineEntry(entry: BaselineEntry): string {
  return `  - ${entry.rule} :: ${entry.template} — ${entry.note}`;
}

function runCheck(): void {
  const templates = listTemplates();
  const devPorts = readDevPorts();
  const violations = runAllChecks(templates, devPorts);
  const baseline = loadBaseline(BASELINE_PATH);
  const { newFailures, baselinedFailures, warnings, staleBaselineEntries } =
    reconcile(violations, baseline);

  console.log(
    `[template-standard] checked ${templates.length} templates: ${templates.join(", ")}`,
  );
  console.log(
    `[template-standard] core-routes surface: investigated, not enforced (see manifest.ts CORE_ROUTES_FINDING).`,
  );
  console.log(
    `[template-standard] never-standardized surfaces (no checks by design): ${NEVER_STANDARDIZED.join("; ")}`,
  );

  if (baselinedFailures.length > 0) {
    console.log(
      `\n[template-standard] ${baselinedFailures.length} known gap(s), accepted in the baseline (Phase 2/3 should shrink these):`,
    );
    for (const violation of baselinedFailures) {
      console.log(`  - ${violation.rule} :: ${violation.template} — ${violation.message}`);
    }
  }

  if (staleBaselineEntries.length > 0) {
    console.log(
      `\n[template-standard] ${staleBaselineEntries.length} baseline entrie(s) no longer reproduce — safe to delete from ${BASELINE_PATH}:`,
    );
    for (const entry of staleBaselineEntries) console.log(formatBaselineEntry(entry));
  }

  if (warnings.length > 0) {
    console.log(
      `\n[template-standard] ${warnings.length} version-drift warning(s) (WARN-level, does not fail the guard):`,
    );
    for (const violation of warnings) {
      console.log(`  - ${violation.rule} :: ${violation.template} — ${violation.message}`);
    }
  }

  if (newFailures.length > 0) {
    console.error(
      `\n[template-standard] ${newFailures.length} NEW violation(s) not covered by the baseline:`,
    );
    for (const violation of newFailures) {
      console.error(`  - ${violation.rule} :: ${violation.template} — ${violation.message}`);
    }
    console.error(
      `\nIf this is genuinely new drift, fix the template. If it's an accepted, ` +
        `already-known gap, add it to ${BASELINE_PATH} with a short note.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n[template-standard] no new drift. ${baselinedFailures.length} baselined gap(s) remain open.`,
  );
}

function runWrite(): void {
  const written = syncByteSyncedFiles();
  if (written.length === 0) {
    console.log("[template-standard] nothing to write; all byte-synced files already exist.");
    return;
  }
  console.log(`[template-standard] wrote ${written.length} file(s):`);
  for (const entry of written) {
    console.log(`  - ${entry.rule} :: ${entry.template} -> ${entry.path}`);
  }
}

if (write) {
  runWrite();
} else {
  runCheck();
}
