#!/usr/bin/env node
// Self-diff convergence harness for the Figma SVG exporter.
//
// For each fixture: (1) screenshot the RAW screen HTML at its exact frame
// dims via a plain Playwright render (the "expected" ground truth — this is
// what the persisted screen actually looks like); (2) call the REAL
// `renderDesignToFigmaSvg` from the repo to produce the exported SVG, then
// render THAT SVG string in the same Chromium at the same dims ("actual");
// (3) pixel-diff the two PNGs via pixelmatch (same lib pixel-diff/diff.mjs
// already uses). Text anti-aliasing differences between <div>/<span> text
// rendering and SVG <text> rendering are expected and excluded via a
// generous per-pixel color-distance threshold (matches diff.mjs's
// `includeAA: false` convention) — this measures LAYOUT/geometry
// convergence, not sub-pixel font rendering identity.
//
// Usage: node converge.mjs
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This script is executed from a throwaway copy inside templates/design (so
// `@playwright/test` resolves via that workspace's node_modules), but
// pixelmatch/pngjs only live in this scratchpad's own node_modules — load
// them via an explicit require() anchored at THIS file's real location
// (mirrors scratchpad/pixel-diff/crop.mjs's existing pattern) regardless of
// where the executing copy lives.
const req = createRequire(
  "/private/tmp/claude-501/-Users-steve-Projects-builder-agent-native-framework/eff198fb-ffbe-43eb-9d3d-ddec43ab82b9/scratchpad/pixel-diff/package.json",
);
const { PNG } = req("pngjs");
const pixelmatch = req("pixelmatch").default ?? req("pixelmatch");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH_PIXEL_DIFF_DIR =
  "/private/tmp/claude-501/-Users-steve-Projects-builder-agent-native-framework/eff198fb-ffbe-43eb-9d3d-ddec43ab82b9/scratchpad/pixel-diff";
const REPO_DESIGN_DIR =
  "/Users/steve/Projects/builder/agent-native/framework/templates/design";
const LIB_PATH = path.join(
  REPO_DESIGN_DIR,
  "server/lib/design-to-figma-svg.ts",
);
const FIXTURES_DIR = path.join(SCRATCH_PIXEL_DIFF_DIR, "fixtures");
const RESULTS_DIR = path.join(SCRATCH_PIXEL_DIFF_DIR, "results");
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const { renderDesignToFigmaSvg } = await import(pathToFileURL(LIB_PATH).href);

const FIXTURES = [
  { name: "f3b", file: "f3b.html", width: 400, height: 300 },
  { name: "wrap-text", file: "wrap-text.html", width: 375, height: 420 },
  { name: "nested-frame", file: "nested-frame.html", width: 320, height: 240 },
];

async function screenshotHtml(browser, html, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.waitForTimeout(150);
    return await page.screenshot({ type: "png" });
  } finally {
    await context.close();
  }
}

async function screenshotSvg(browser, svg, width, height) {
  const wrapped = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${width}px;height:${height}px;overflow:hidden}</style></head><body>${svg}</body></html>`;
  return screenshotHtml(browser, wrapped, width, height);
}

function diffPngs(aBuf, bBuf, outPath, threshold = 0.25) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  const dimsMatch = a.width === b.width && a.height === b.height;
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  function crop(img) {
    if (img.width === width && img.height === height) return img.data;
    const out = new PNG({ width, height });
    PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
    return out.data;
  }
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(crop(a), crop(b), diff.data, width, height, {
    threshold,
    includeAA: false,
  });
  fs.writeFileSync(outPath, PNG.sync.write(diff));
  const total = width * height;
  return {
    dimsMatch,
    expectedDims: `${a.width}x${a.height}`,
    actualDims: `${b.width}x${b.height}`,
    mismatched,
    total,
    pct: +((mismatched / total) * 100).toFixed(3),
  };
}

const browser = await chromium.launch();
const summary = [];
try {
  for (const fixture of FIXTURES) {
    const htmlPath = path.join(FIXTURES_DIR, fixture.file);
    const html = fs.readFileSync(htmlPath, "utf8");

    const expectedPng = await screenshotHtml(
      browser,
      html,
      fixture.width,
      fixture.height,
    );
    const expectedPath = path.join(RESULTS_DIR, `${fixture.name}-expected.png`);
    fs.writeFileSync(expectedPath, expectedPng);

    const { svg, report } = await renderDesignToFigmaSvg({
      html,
      width: fixture.width,
      height: fixture.height,
      title: fixture.name,
      rootSelector: null,
      embedImages: false,
    });
    const svgPath = path.join(RESULTS_DIR, `${fixture.name}.svg`);
    fs.writeFileSync(svgPath, svg);

    // Sanity: the SVG root's own declared width/height must equal the
    // fixture's frame dims exactly (this is the Bug 2 sizing fix).
    const rootDimsMatch = svg.match(/<svg[^>]*\swidth="([\d.]+)"\s+height="([\d.]+)"/);
    const svgWidth = rootDimsMatch ? Number(rootDimsMatch[1]) : null;
    const svgHeight = rootDimsMatch ? Number(rootDimsMatch[2]) : null;

    const actualPng = await screenshotSvg(
      browser,
      svg,
      fixture.width,
      fixture.height,
    );
    const actualPath = path.join(RESULTS_DIR, `${fixture.name}-actual.png`);
    fs.writeFileSync(actualPath, actualPng);

    const diffPath = path.join(RESULTS_DIR, `${fixture.name}-diff.png`);
    const diff = diffPngs(expectedPng, actualPng, diffPath);

    summary.push({
      fixture: fixture.name,
      frame: `${fixture.width}x${fixture.height}`,
      svgRootDims: `${svgWidth}x${svgHeight}`,
      svgRootMatchesFrame: svgWidth === fixture.width && svgHeight === fixture.height,
      pct: diff.pct,
      mismatched: diff.mismatched,
      total: diff.total,
      dimsMatch: diff.dimsMatch,
      warnings: report.warnings,
      approximated: report.approximated.length,
      omitted: report.omitted.length,
      artifacts: {
        expected: expectedPath,
        actual: actualPath,
        diff: diffPath,
        svg: svgPath,
      },
    });
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(summary, null, 2));

const failing = summary.filter((s) => s.pct >= 2);
if (failing.length > 0) {
  console.error(
    `\n${failing.length} fixture(s) at/above the 2% convergence bar: ${failing.map((f) => f.fixture).join(", ")}`,
  );
  process.exit(1);
}
console.log("\nAll fixtures converged under the 2% bar.");
