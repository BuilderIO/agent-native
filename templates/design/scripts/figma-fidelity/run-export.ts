import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Export fidelity run: design HTML -> Figma SVG -> pixels, compared against the
 * design's own render.
 *
 * This is the offline half of the export round trip. It answers "does the SVG
 * we hand Figma still look like the design?" without needing a Figma account.
 * The second half — "does Figma's own SVG importer agree?" — is `push-to-figma`,
 * which imports the same SVG into a real file through the Figma MCP.
 *
 * Usage:
 *   pnpm figma-fidelity:export             # every built-in preset case
 *   pnpm figma-fidelity:export social      # cases whose id contains "social"
 */
import { chromium } from "@playwright/test";

import { renderDesignToFigmaSvg } from "../../server/lib/design-to-figma-svg.js";
import { DESIGN_TEMPLATE_PRESETS } from "../../shared/design-template-presets.js";
import { comparePngs, type CompareResult } from "./lib/compare.js";
import { renderDocumentToPng, renderSvgToPng } from "./lib/render.js";

const OUT_DIR = ".tmp/figma-fidelity/export";
/**
 * Per-case ceilings. Without these the harness only PRINTS numbers, so a
 * regression reads exactly like a pass — which is the failure mode this whole
 * exercise exists to catch. Regenerate with `--update` after a deliberate
 * change, and the diff shows a reviewer exactly which case moved and by how
 * much.
 */
const BASELINE_PATH =
  "templates/design/scripts/figma-fidelity/export-baseline.json";

interface BaselineEntry {
  maxDiffPercent: number;
  maxOmitted: number;
  maxApproximated: number;
}

/** Headroom over the observed value: rendering wobbles slightly between
 *  Chromium builds, but a real regression moves far more than this. */
function ceilingFor(diffPercent: number): number {
  return Number((diffPercent + Math.max(0.1, diffPercent * 0.15)).toFixed(3));
}
/**
 * Corpus cases, each a `<id>/screen.html` + `<id>/meta.json` pair. The checked-in
 * directory is the regression corpus; the `.tmp` one is for ad-hoc cases (e.g. a
 * screen just imported from a real Figma file) that should not land in git.
 */
const CORPUS_DIRS = [
  "templates/design/scripts/figma-fidelity/corpus",
  ".tmp/figma-fidelity/corpus",
];

interface ExportCase {
  id: string;
  html: string;
  width: number;
  height: number;
  /** The screen frame inside the document — what actually ships to Figma. */
  rootSelector?: string | null;
  /**
   * Ad-hoc cases (dropped into `.tmp` while chasing a specific bug) are run and
   * reported but not gated: there is nothing checked in for a reviewer to
   * compare a baseline against. Everything in the tracked corpus IS gated.
   */
  adHoc?: boolean;
}

function presetCases(): ExportCase[] {
  return DESIGN_TEMPLATE_PRESETS.map((preset) => ({
    id: preset.id,
    html: preset.content,
    width: preset.width,
    height: preset.height,
    rootSelector: '[data-agent-native-node-id="template-artboard"]',
  }));
}

function corpusCases(): ExportCase[] {
  const cases: ExportCase[] = [];
  for (const root of CORPUS_DIRS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const htmlPath = join(dir, "screen.html");
      const metaPath = join(dir, "meta.json");
      if (!existsSync(htmlPath) || !existsSync(metaPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
        width: number;
        height: number;
        rootSelector?: string;
      };
      cases.push({
        id: entry.name,
        html: readFileSync(htmlPath, "utf8"),
        width: meta.width,
        height: meta.height,
        rootSelector: meta.rootSelector ?? null,
        adHoc: root.startsWith(".tmp/"),
      });
    }
  }
  return cases;
}

interface CaseOutcome {
  id: string;
  status: "ok" | "failed";
  diffRatio?: number;
  meanDelta?: number;
  dimensionMismatch?: boolean;
  adHoc?: boolean;
  worstCells?: CompareResult["worstCells"];
  renderWarnings?: string[];
  exportOmissions?: number;
  exportApproximations?: number;
  error?: string;
}

async function runCase(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  testCase: ExportCase,
): Promise<CaseOutcome> {
  const dir = join(OUT_DIR, testCase.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "screen.html"), testCase.html);

  // Compare at 1x. The export path is vector; upscaling only adds Chromium-vs-
  // Chromium antialiasing noise on the same geometry, which is not the signal.
  const renderOptions = {
    width: testCase.width,
    height: testCase.height,
    deviceScaleFactor: 1,
    rootSelector: testCase.rootSelector,
  };

  const reference = await renderDocumentToPng(
    browser,
    testCase.html,
    renderOptions,
  );
  writeFileSync(join(dir, "design.png"), reference.png);

  const { svg, report } = await renderDesignToFigmaSvg({
    html: testCase.html,
    width: testCase.width,
    height: testCase.height,
    embedImages: true,
    title: testCase.id,
    rootSelector: testCase.rootSelector,
  });
  writeFileSync(join(dir, "export.svg"), svg);
  writeFileSync(
    join(dir, "export-report.json"),
    JSON.stringify(report, null, 2),
  );

  const candidate = await renderSvgToPng(browser, svg, renderOptions);
  writeFileSync(join(dir, "export.png"), candidate.png);

  const comparison = await comparePngs(browser, reference.png, candidate.png, {
    threshold: 8,
  });
  writeFileSync(join(dir, "diff.png"), comparison.diffPng);

  const { diffPng: _diffPng, ...serializable } = comparison;
  writeFileSync(
    join(dir, "compare.json"),
    JSON.stringify(
      {
        ...serializable,
        renderWarnings: [...reference.warnings, ...candidate.warnings],
      },
      null,
      2,
    ),
  );

  return {
    id: testCase.id,
    status: "ok",
    adHoc: testCase.adHoc,
    diffRatio: comparison.diffRatio,
    meanDelta: comparison.meanDelta,
    dimensionMismatch: comparison.dimensionMismatch,
    worstCells: comparison.worstCells.slice(0, 4),
    renderWarnings: [...reference.warnings, ...candidate.warnings],
    exportOmissions: report.omitted?.length ?? 0,
    exportApproximations: report.approximated?.length ?? 0,
  };
}

const args = process.argv.slice(2);
const updateBaseline = args.includes("--update");
const filter = args.find((a) => !a.startsWith("--"));
const cases = [...presetCases(), ...corpusCases()].filter(
  (testCase) => !filter || testCase.id.includes(filter),
);

if (!cases.length) {
  throw new Error(
    `No export cases matched${filter ? ` filter "${filter}"` : ""}. ` +
      `Add cases under ${CORPUS_DIRS[0]}/<id>/{screen.html,meta.json}.`,
  );
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const outcomes: CaseOutcome[] = [];
try {
  for (const testCase of cases) {
    process.stdout.write(`· ${testCase.id} … `);
    try {
      const outcome = await runCase(browser, testCase);
      outcomes.push(outcome);
      process.stdout.write(
        `${(outcome.diffRatio! * 100).toFixed(3)}% differing pixels\n`,
      );
    } catch (error) {
      // A case that cannot be exported is a failure to report, never a case to
      // quietly drop from the table — a shrinking corpus reads as progress.
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ id: testCase.id, status: "failed", error: message });
      process.stdout.write(`FAILED — ${message}\n`);
    }
  }
} finally {
  await browser.close();
}

writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(outcomes, null, 2));

console.log(
  "\n  case                            diff%     mean∆   omitted  approx  notes",
);
console.log("  " + "-".repeat(84));
for (const outcome of outcomes) {
  if (outcome.status === "failed") {
    console.log(`  ${outcome.id.padEnd(30)}  FAILED — ${outcome.error}`);
    continue;
  }
  const notes: string[] = [];
  if (outcome.dimensionMismatch) notes.push("SIZE MISMATCH");
  if (outcome.renderWarnings?.length)
    notes.push(`${outcome.renderWarnings.length} render warning(s)`);
  console.log(
    `  ${outcome.id.padEnd(30)}  ${(outcome.diffRatio! * 100).toFixed(3).padStart(7)}  ` +
      `${outcome.meanDelta!.toFixed(2).padStart(7)}  ` +
      `${String(outcome.exportOmissions).padStart(7)}  ${String(outcome.exportApproximations).padStart(6)}  ${notes.join(", ")}`,
  );
}
console.log(`\n  artifacts: ${OUT_DIR}/<case>/{design,export,diff}.png\n`);

const failed = outcomes.filter((outcome) => outcome.status === "failed");
if (failed.length) process.exitCode = 1;

// ---------------------------------------------------------------------------
// Baseline gate
// ---------------------------------------------------------------------------

const baseline: Record<string, BaselineEntry> = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : {};

if (updateBaseline) {
  const next = { ...baseline };
  for (const outcome of outcomes) {
    if (outcome.status !== "ok" || outcome.adHoc) continue;
    next[outcome.id] = {
      maxDiffPercent: ceilingFor(outcome.diffRatio! * 100),
      maxOmitted: outcome.exportOmissions ?? 0,
      maxApproximated: outcome.exportApproximations ?? 0,
    };
  }
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`,
  );
  console.log(`  baseline updated: ${BASELINE_PATH}\n`);
} else {
  const problems: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status !== "ok") {
      problems.push(`${outcome.id}: case failed to export — ${outcome.error}`);
      continue;
    }
    const expected = baseline[outcome.id];
    if (!expected && outcome.adHoc) {
      console.log(`  · ${outcome.id}: ad-hoc case, reported but not gated`);
      continue;
    }
    if (!expected) {
      // An unbaselined case must not pass by default; that is how a case gets
      // silently added and silently ignored.
      problems.push(
        `${outcome.id}: no baseline entry — run with --update to record one`,
      );
      continue;
    }
    const diffPercent = outcome.diffRatio! * 100;
    if (diffPercent > expected.maxDiffPercent) {
      problems.push(
        `${outcome.id}: ${diffPercent.toFixed(3)}% differing pixels exceeds the ${expected.maxDiffPercent}% ceiling`,
      );
    }
    if ((outcome.exportOmissions ?? 0) > expected.maxOmitted) {
      problems.push(
        `${outcome.id}: ${outcome.exportOmissions} omitted, ceiling ${expected.maxOmitted} — the export is dropping content`,
      );
    }
    if ((outcome.exportApproximations ?? 0) > expected.maxApproximated) {
      problems.push(
        `${outcome.id}: ${outcome.exportApproximations} approximated, ceiling ${expected.maxApproximated}`,
      );
    }
    if (outcome.dimensionMismatch) {
      problems.push(`${outcome.id}: exported SVG is not the screen's size`);
    }
  }
  // A baselined case that did not run at all is a silent loss of coverage.
  const ran = new Set(outcomes.map((o) => o.id));
  for (const id of Object.keys(baseline)) {
    if (filter && !id.includes(filter)) continue;
    if (!ran.has(id)) problems.push(`${id}: baselined case did not run`);
  }

  if (problems.length) {
    console.log("  BASELINE FAILURES");
    for (const problem of problems) console.log(`   ✗ ${problem}`);
    console.log("");
    process.exitCode = 1;
  } else {
    console.log(`  baseline OK (${outcomes.length} case(s) within ceilings)\n`);
  }
}
