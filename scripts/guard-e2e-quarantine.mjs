#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CEILINGS = {
  "templates/design/e2e": 16,
};

const SKIP_CEILINGS = {
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
    console.error(
      `guard:e2e-quarantine: cannot read ${dir} — ${error.message}`,
    );
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
      if (/test\.(?:describe\.)?skip\(/.test(line)) skipCount += 1;
      if (!/test\.(?:describe\.)?fixme\(/.test(line)) return;
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
