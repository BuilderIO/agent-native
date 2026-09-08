/**
 * Ratchet baseline for `guard:template-standard`.
 *
 * Phase 1 turns on a strict, byte/structural-accurate checker on day one,
 * which immediately finds real, pre-existing template drift (missing
 * `_gitignore`/`learnings.defaults.md`, crm's missing CLAUDE.md symlink,
 * chat's unrendered `{{APP_NAME}}`, plus a few templates that intentionally
 * customized their `learnings.defaults.md`/`_gitignore` beyond the shared
 * scaffold). Phase 1 must not edit any `templates/*` file, so a failing guard
 * here would break CI on this branch.
 *
 * The baseline is the ratchet: every violation known today is listed once
 * (by rule + template) in `scripts/template-standard-baseline.json` with a
 * short human note. The guard only fails on a violation NOT already listed —
 * i.e. NEW drift. Baseline entries whose violation has since been fixed print
 * as "stale — safe to delete" so the list visibly shrinks over Phase 2/3
 * instead of silently rotting.
 */
import { existsSync, readFileSync } from "node:fs";

import type { Violation } from "./checks.ts";

export type BaselineEntry = {
  rule: string;
  template: string;
  note: string;
};

export type BaselineFile = {
  $comment?: string;
  violations: BaselineEntry[];
};

export function baselineKey(rule: string, template: string): string {
  return `${rule}::${template}`;
}

export function loadBaseline(path: string): BaselineEntry[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as BaselineFile;
  return parsed.violations ?? [];
}

export type ReconciledViolations = {
  /** Fail-severity violations not covered by the baseline — these fail the guard. */
  newFailures: Violation[];
  /** Fail-severity violations already accepted in the baseline. */
  baselinedFailures: Violation[];
  /** Warn-severity violations — always printed, never fail the guard. */
  warnings: Violation[];
  /** Baseline entries whose violation no longer reproduces. */
  staleBaselineEntries: BaselineEntry[];
};

export function reconcile(
  violations: Violation[],
  baseline: BaselineEntry[],
): ReconciledViolations {
  const baselineKeys = new Set(
    baseline.map((entry) => baselineKey(entry.rule, entry.template)),
  );
  const seenKeys = new Set<string>();
  const newFailures: Violation[] = [];
  const baselinedFailures: Violation[] = [];
  const warnings: Violation[] = [];

  for (const violation of violations) {
    if (violation.severity === "warn") {
      warnings.push(violation);
      continue;
    }
    const key = baselineKey(violation.rule, violation.template);
    seenKeys.add(key);
    if (baselineKeys.has(key)) {
      baselinedFailures.push(violation);
    } else {
      newFailures.push(violation);
    }
  }

  const staleBaselineEntries = baseline.filter(
    (entry) => !seenKeys.has(baselineKey(entry.rule, entry.template)),
  );

  return { newFailures, baselinedFailures, warnings, staleBaselineEntries };
}
