/**
 * Export fidelity run: design HTML -> Figma SVG -> pixels, compared against the
 * design's own render.
 *
 * This is the offline half of the export round trip. It answers "does the SVG
 * we hand Figma still look like the design?" without needing a Figma account.
 * The second half - "does Figma's own SVG importer agree?" - is `push-to-figma`,
 * which imports the same SVG into a real file through the Figma MCP.
 *
 * Usage:
 *   pnpm figma-fidelity:export             # every built-in preset case
 *   pnpm figma-fidelity:export social      # cases whose id contains "social"
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

import {
  ceilingFor,
  DEFAULT_EXPORT_OUT_DIR,
  EXPORT_BASELINE_PATH,
  findExportBaselineProblems,
  hashExportSource,
  loadExportBaseline,
  loadExportCases,
  runExportCase,
  type CaseOutcome,
} from "./lib/export-regression.js";

const args = process.argv.slice(2);
const updateBaseline = args.includes("--update");
const filter = args.find((arg) => !arg.startsWith("--"));
const cases = loadExportCases(filter);

const browser = await chromium.launch();
const outcomes: CaseOutcome[] = [];
try {
  for (const testCase of cases) {
    process.stdout.write(`· ${testCase.id} … `);
    try {
      const outcome = await runExportCase(browser, testCase);
      outcomes.push(outcome);
      process.stdout.write(
        `${((outcome.diffRatio ?? 0) * 100).toFixed(3)}% differing pixels\n`,
      );
    } catch (error) {
      // A case that cannot be exported is a failure to report, never a case to
      // quietly drop from the table - a shrinking corpus reads as progress.
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({
        id: testCase.id,
        sourceHash: hashExportSource(testCase.html),
        status: "failed" as const,
        error: message,
      });
      process.stdout.write(`FAILED - ${message}\n`);
    }
  }
} finally {
  await browser.close();
}

writeFileSync(
  join(DEFAULT_EXPORT_OUT_DIR, "summary.json"),
  JSON.stringify(outcomes, null, 2),
);

const baseline = loadExportBaseline();
console.log(
  "\n  case                            diff%     mean∆   omitted  approx  notes",
);
console.log("  " + "-".repeat(84));
for (const outcome of outcomes) {
  if (outcome.status === "failed") {
    console.log(`  ${outcome.id.padEnd(30)}  FAILED - ${outcome.error}`);
    continue;
  }
  const notes: string[] = [];
  if (outcome.dimensionMismatch) notes.push("SIZE MISMATCH");
  if (outcome.renderWarnings?.length)
    notes.push(`${outcome.renderWarnings.length} render warning(s)`);
  console.log(
    `  ${outcome.id.padEnd(30)}  ${((outcome.diffRatio ?? 0) * 100).toFixed(3).padStart(7)}  ` +
      `${(outcome.meanDelta ?? 0).toFixed(2).padStart(7)}  ` +
      `${String(outcome.exportOmissions ?? 0).padStart(7)}  ${String(outcome.exportApproximations ?? 0).padStart(6)}  ${notes.join(", ")}`,
  );
}
console.log(
  `\n  artifacts: ${DEFAULT_EXPORT_OUT_DIR}/<case>/{design,export,diff}.png\n`,
);

if (outcomes.some((outcome) => outcome.status === "failed")) {
  process.exitCode = 1;
}

if (updateBaseline) {
  const next = { ...baseline };
  for (const outcome of outcomes) {
    if (outcome.status !== "ok" || outcome.adHoc) continue;
    next[outcome.id] = {
      maxDiffPercent: ceilingFor((outcome.diffRatio ?? 0) * 100),
      maxOmitted: outcome.exportOmissions ?? 0,
      maxApproximated: outcome.exportApproximations ?? 0,
      sourceHash: outcome.sourceHash,
    };
  }
  writeFileSync(
    EXPORT_BASELINE_PATH,
    `${JSON.stringify(Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`,
  );
  console.log(`  baseline updated: ${EXPORT_BASELINE_PATH}\n`);
} else {
  const problems = findExportBaselineProblems(outcomes, baseline, filter);
  if (problems.length) {
    console.log("  BASELINE FAILURES");
    for (const problem of problems) console.log(`   ✗ ${problem}`);
    console.log("");
    process.exitCode = 1;
  } else {
    console.log(`  baseline OK (${outcomes.length} case(s) within ceilings)\n`);
  }
}
