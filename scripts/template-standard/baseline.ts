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
  newFailures: Violation[];
  baselinedFailures: Violation[];
  warnings: Violation[];
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
