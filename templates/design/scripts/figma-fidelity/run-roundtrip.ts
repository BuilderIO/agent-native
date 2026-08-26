import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Round-trip fidelity: Figma -> our HTML -> the SVG we hand back to Figma.
 *
 * The import and export harnesses each measure one hop. Neither answers the
 * question that actually matters to someone moving a design between the two
 * tools: after a full round trip, does it still look like the design they
 * started with? A converter can score well on import and still lose the design
 * on the way out, and vice versa, so this scores all three against ONE
 * reference — Figma's own render of the source node:
 *
 *   import  — our HTML rendered to pixels
 *   export  — that same HTML pushed through the real `renderDesignToFigmaSvg`
 *             and rendered to pixels; this is what Figma receives
 *   drift   — export against import, i.e. what the export hop alone costs
 *
 * It reuses the artifacts the import and paste harnesses already produced, so
 * it costs no Figma quota and runs on the complex community designs rather
 * than on synthetic fixtures.
 *
 * Usage:
 *   pnpm figma-fidelity:roundtrip            # every case with artifacts on disk
 *   pnpm figma-fidelity:roundtrip positivus  # matching ids
 */
import { chromium } from "@playwright/test";

import { renderDesignToFigmaSvg } from "../../server/lib/design-to-figma-svg.js";
import { comparePngs } from "./lib/compare.js";
import { renderSvgToPng } from "./lib/render.js";

const OUT_DIR = ".tmp/figma-fidelity/roundtrip";
const MANIFEST =
  "templates/design/scripts/figma-fidelity/roundtrip-corpus.json";

interface RoundTripCase {
  id: string;
  /** HTML produced by one of the import paths. */
  html: string;
  /** Figma's own render of the same node — the single reference for all hops. */
  referencePng: string;
  /** The import render, when that path already produced one. */
  importPng?: string;
  width: number;
  height: number;
  notes?: string;
}

interface Score {
  diffPercent: number;
  meanDelta: number;
  dimensionMismatch: boolean;
}

interface CaseOutcome {
  id: string;
  status: "ok" | "failed";
  width?: number;
  height?: number;
  svgBytes?: number;
  /** Export-report counts; an omission here is a design element Figma will not receive. */
  vectorized?: number;
  approximated?: number;
  rasterized?: number;
  omitted?: number;
  importVsFigma?: Score;
  exportVsFigma?: Score;
  exportVsImport?: Score;
  renderWarnings?: string[];
  error?: string;
}

function score(comparison: {
  diffRatio: number;
  meanDelta: number;
  dimensionMismatch: boolean;
}): Score {
  return {
    diffPercent: comparison.diffRatio * 100,
    meanDelta: comparison.meanDelta,
    dimensionMismatch: comparison.dimensionMismatch,
  };
}

async function runCase(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  testCase: RoundTripCase,
): Promise<CaseOutcome> {
  for (const [label, path] of [
    ["html", testCase.html],
    ["referencePng", testCase.referencePng],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(
        `${label} ${path} is missing. Run the import or paste harness for this case first.`,
      );
    }
  }
  const html = readFileSync(testCase.html, "utf8");
  const referencePng = readFileSync(testCase.referencePng);

  const dir = join(OUT_DIR, testCase.id);
  mkdirSync(dir, { recursive: true });

  // The real export path, not a stand-in: a fix here is a fix in the product.
  const { svg, report } = await renderDesignToFigmaSvg({
    html,
    width: testCase.width,
    height: testCase.height,
    // Image fills reach the SVG as data URIs, which is what Figma needs — an
    // http(s) href would import as a broken link.
    embedImages: true,
  });
  writeFileSync(join(dir, "export.svg"), svg);
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));

  const rendered = await renderSvgToPng(browser, svg, {
    width: testCase.width,
    height: testCase.height,
    deviceScaleFactor: 1,
  });
  writeFileSync(join(dir, "export.png"), rendered.png);

  const outcome: CaseOutcome = {
    id: testCase.id,
    status: "ok",
    width: testCase.width,
    height: testCase.height,
    svgBytes: Buffer.byteLength(svg, "utf8"),
    vectorized: report.vectorized.length,
    approximated: report.approximated.length,
    rasterized: report.rasterized.length,
    omitted: report.omitted.length,
    renderWarnings: rendered.warnings,
  };

  const exportVsFigma = await comparePngs(browser, referencePng, rendered.png, {
    threshold: 8,
  });
  writeFileSync(join(dir, "diff-vs-figma.png"), exportVsFigma.diffPng);
  outcome.exportVsFigma = score(exportVsFigma);

  if (testCase.importPng && existsSync(testCase.importPng)) {
    const importPng = readFileSync(testCase.importPng);
    const importVsFigma = await comparePngs(browser, referencePng, importPng, {
      threshold: 8,
    });
    outcome.importVsFigma = score(importVsFigma);
    const exportVsImport = await comparePngs(browser, importPng, rendered.png, {
      threshold: 8,
    });
    writeFileSync(join(dir, "diff-vs-import.png"), exportVsImport.diffPng);
    outcome.exportVsImport = score(exportVsImport);
  }

  writeFileSync(join(dir, "compare.json"), JSON.stringify(outcome, null, 2));
  return outcome;
}

if (!existsSync(MANIFEST)) {
  throw new Error(
    `No round-trip corpus at ${MANIFEST}. It is a JSON array of ` +
      `{"id","html","referencePng","importPng","width","height"} entries.`,
  );
}
const filter = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const cases = (
  JSON.parse(readFileSync(MANIFEST, "utf8")) as RoundTripCase[]
).filter((testCase) => !filter || testCase.id.includes(filter));
if (!cases.length) {
  throw new Error(
    `No round-trip cases matched${filter ? ` filter "${filter}"` : ""}.`,
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
        `${outcome.exportVsFigma!.diffPercent.toFixed(3)}% after the round trip\n`,
      );
    } catch (error) {
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
  "\n  case                        import%   export%   drift%   vec  approx  rast  omit  notes",
);
console.log("  " + "-".repeat(100));
for (const outcome of outcomes) {
  if (outcome.status === "failed") {
    console.log(`  ${outcome.id.padEnd(26)}  FAILED — ${outcome.error}`);
    continue;
  }
  const notes: string[] = [];
  if (outcome.exportVsFigma?.dimensionMismatch)
    notes.push("SIZE MISMATCH vs Figma");
  if (outcome.renderWarnings?.length)
    notes.push(`${outcome.renderWarnings.length} render warning(s)`);
  console.log(
    `  ${outcome.id.padEnd(26)}  ` +
      `${(outcome.importVsFigma ? outcome.importVsFigma.diffPercent.toFixed(3) : "—").padStart(7)}  ` +
      `${outcome.exportVsFigma!.diffPercent.toFixed(3).padStart(7)}  ` +
      `${(outcome.exportVsImport ? outcome.exportVsImport.diffPercent.toFixed(3) : "—").padStart(6)}  ` +
      `${String(outcome.vectorized).padStart(4)}  ` +
      `${String(outcome.approximated).padStart(6)}  ` +
      `${String(outcome.rasterized).padStart(4)}  ` +
      `${String(outcome.omitted).padStart(4)}  ${notes.join(", ")}`,
  );
}
console.log(
  `\n  import% = our HTML vs Figma's render. export% = the SVG Figma receives vs the same` +
    `\n  reference. drift% = what the export hop alone costs.` +
    `\n  artifacts: ${OUT_DIR}/<case>/{export.svg,export.png,diff-vs-figma.png}\n`,
);
if (outcomes.some((o) => o.status === "failed")) process.exitCode = 1;
