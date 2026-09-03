#!/usr/bin/env node
/**
 * Quarantine budget for the Design E2E suite.
 *
 * A `test.fixme` is a bug someone chose not to fix yet. That is legitimate —
 * once. What is not legitimate is the count drifting upward unnoticed: this
 * suite ran post-merge only for weeks, and 63 specs rotted because nothing
 * could fail a pull request. Two rules, both mechanical:
 *
 *   1. The count never grows without the ceiling moving in the same diff, so
 *      a reviewer sees the trade.
 *   2. Every quarantined test carries a `//` reason directly above it. A
 *      parked test with no symptom recorded is indistinguishable from a test
 *      someone silenced to get a green run.
 *
 * Lower CEILING whenever the real count drops — that is the whole point.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Directory -> max quarantined tests. Freeze current size; never grant room. */
const CEILINGS = {
  "templates/design/e2e": 16,
};

/**
 * Directory -> max runtime `test.skip(cond, ...)` sites.
 *
 * A conditional skip is the invisible cousin of `test.fixme`: it is not in the
 * quarantine count, it prints as a dash rather than a failure, and if its
 * condition fires on every run the test guards nothing while still being
 * counted among the suite's totals. Two were doing exactly that — a Scale
 * constraint test whose locator never opened the axis Select, and a resize
 * anchoring test reading the host's board chrome instead of the in-iframe
 * element handles. Both had passed for months as "skipped".
 */
const SKIP_CEILINGS = {
  // One of these sites is dead code inside a parked test, kept as evidence
  // for the rewrite; six are live.
  "templates/design/e2e": 7,
};

const listOnly = process.argv.includes("--list");
const failures = [];
const rows = [];

for (const [dir, ceiling] of Object.entries(CEILINGS)) {
  let files;
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".spec.ts"));
  } catch (error) {
    // A budgeted directory that cannot be read is never "0 quarantined,
    // passing": it was renamed, or the checkout is broken. Either way this is
    // a failure to inspect, not a clean result.
    console.error(`guard:e2e-quarantine: cannot read ${dir} — ${error.message}`);
    console.error("Renamed or moved? Update CEILINGS in this file.");
    process.exit(2);
  }
  if (files.length === 0) {
    console.error(`guard:e2e-quarantine: ${dir} has no *.spec.ts files.`);
    process.exit(2);
  }

  let count = 0;
  let skipCount = 0;
  const unexplained = [];
  for (const name of files) {
    const lines = readFileSync(join(dir, name), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (line.includes("test.skip(")) skipCount += 1;
      if (!line.includes("test.fixme(")) return;
      count += 1;
      let cursor = index - 1;
      while (cursor >= 0 && lines[cursor].trim() === "") cursor -= 1;
      const above = cursor >= 0 ? lines[cursor].trim() : "";
      if (!above.startsWith("//") && !above.startsWith("*")) {
        unexplained.push(`${dir}/${name}:${index + 1}`);
      }
    });
  }

  const skipCeiling = SKIP_CEILINGS[dir];
  rows.push(
    `${dir}: ${count}/${ceiling} quarantined, ${skipCount}/${skipCeiling} conditional skips`,
  );
  if (skipCeiling !== undefined && skipCount > skipCeiling) {
    failures.push(
      `  ${dir}: ${skipCount} conditional test.skip sites exceeds its ceiling of ` +
        `${skipCeiling}. A skip that fires every run is a park nobody counts — ` +
        `check it actually fires only when intended, or assert instead.`,
    );
  }
  if (count > ceiling) {
    failures.push(
      `  ${dir}: ${count} quarantined tests exceeds its ceiling of ${ceiling} by ${count - ceiling}`,
    );
  }
  for (const where of unexplained) {
    failures.push(`  ${where}: test.fixme with no reason comment above it`);
  }
}

if (listOnly) {
  console.log(rows.join("\n"));
  process.exit(0);
}

if (failures.length > 0) {
  console.error("guard:e2e-quarantine failed:\n");
  console.error(failures.join("\n"));
  console.error(
    "\nFix the test, or record the symptom above the test.fixme. Raising a\n" +
      "ceiling requires the justification visible in the same diff.",
  );
  process.exit(1);
}

console.log(`guard:e2e-quarantine: ${rows.join(", ")}.`);
