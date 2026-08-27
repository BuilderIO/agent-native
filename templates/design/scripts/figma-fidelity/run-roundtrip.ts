import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
import { renderHtmlToPng } from "./lib/render.js";

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
  /**
   * The region Figma actually rendered, when it differs from the design box —
   * see `run-import.ts`. Carried over verbatim rather than re-derived, so the
   * export hop is scored over exactly the pixels the import hop was.
   */
  canvas?: { width: number; height: number };
  contentOffset?: { left: number; top: number };
  renderScale?: number;
  notes?: string;
}

const IMPORT_DIR = ".tmp/figma-fidelity/import";

/**
 * Every import case that produced artifacts is a round-trip case for free: the
 * document the product persists is on disk next to Figma's own render of the
 * same node. Deriving them beats listing them — the hand-written manifest
 * covered 10 designs while the import corpus had grown to 23, so the export
 * hop was simply unmeasured on more than half of them, including every mobile,
 * tablet, and dashboard case.
 */
function discoverImportCases(): RoundTripCase[] {
  if (!existsSync(IMPORT_DIR)) return [];
  const cases: RoundTripCase[] = [];
  for (const id of readdirSync(IMPORT_DIR)) {
    const base = join(IMPORT_DIR, id);
    const html = join(base, "stored.html");
    const referencePng = join(base, "figma.png");
    const importPng = join(base, "import.png");
    const metaPath = join(base, "render.json");
    if (![html, referencePng, importPng, metaPath].every(existsSync)) continue;
    let meta: {
      box?: { width?: number; height?: number };
      ink?: { width?: number; height?: number };
      contentOffset?: { left: number; top: number };
      renderScale?: number;
    };
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      continue;
    }
    if (!meta.box?.width || !meta.box?.height) continue;
    cases.push({
      id: `rt-${id}`,
      html,
      referencePng,
      importPng,
      width: meta.box.width,
      height: meta.box.height,
      canvas:
        meta.ink?.width && meta.ink?.height
          ? { width: meta.ink.width, height: meta.ink.height }
          : undefined,
      contentOffset: meta.contentOffset,
      renderScale: meta.renderScale,
      notes: "derived from the import run",
    });
  }
  return cases;
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

/**
 * Google Fonts request covering every family the SVG asks for. Only the first
 * family of each stack is requested: the rest are the local fallbacks the
 * exporter appends, and asking Google for "-apple-system" returns a 400 that
 * would drop the whole stylesheet.
 */
function googleFontsUrlForSvg(svg: string): string | null {
  const families = new Set<string>();
  for (const match of svg.matchAll(/font-family="([^"]*)"/g)) {
    const stack = match[1]!.replace(/&quot;/g, '"');
    const first = stack
      .split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (!first) continue;
    // Generic and system families are not on Google Fonts.
    if (
      /^(-|system-ui$|sans-serif$|serif$|monospace$|cursive$|fantasy$)/i.test(
        first,
      )
    ) {
      continue;
    }
    families.add(first);
  }
  if (families.size === 0) return null;
  const params = [...families]
    .map(
      (family) =>
        `family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@100;200;300;400;500;600;700;800;900`,
    )
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=block`;
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

  // The SVG names its font families but carries no @font-face — Figma resolves
  // them against its own font list on import. Rendering it here without them
  // silently substitutes Arial for every custom face, which shifts every glyph
  // and would report a font the harness did not load as an export defect.
  const fontsUrl = googleFontsUrlForSvg(svg);
  // The SVG is the design at its own size; the canvas is the region Figma
  // rendered. They differ whenever ink spills outside the frame box, so size
  // the SVG explicitly and composite it at the same offset the import used
  // rather than stretching it to the canvas.
  const sizedSvg = svg.replace(
    /<svg\b([^>]*)>/,
    (match: string, attrs: string) =>
      /\bwidth=/.test(attrs) && /\bheight=/.test(attrs)
        ? match
        : `<svg${attrs} width="${testCase.width}" height="${testCase.height}">`,
  );
  const rendered = await renderHtmlToPng(browser, sizedSvg, {
    width: testCase.canvas?.width ?? testCase.width,
    height: testCase.canvas?.height ?? testCase.height,
    contentOffset: testCase.contentOffset,
    contentSize: { width: testCase.width, height: testCase.height },
    deviceScaleFactor: testCase.renderScale ?? 1,
    headHtml: fontsUrl
      ? `<link rel="stylesheet" href="${fontsUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`
      : "",
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
const manifestCases = JSON.parse(
  readFileSync(MANIFEST, "utf8"),
) as RoundTripCase[];
// Discovered cases carry the import run's exact framing, so they win over a
// hand-written entry for the same id; the manifest keeps the ones no import
// run produces (the clipboard paths).
const discovered = discoverImportCases();
const byId = new Map<string, RoundTripCase>();
for (const testCase of manifestCases) byId.set(testCase.id, testCase);
for (const testCase of discovered) byId.set(testCase.id, testCase);
const cases = [...byId.values()].filter(
  (testCase) => !filter || testCase.id.includes(filter),
);
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
