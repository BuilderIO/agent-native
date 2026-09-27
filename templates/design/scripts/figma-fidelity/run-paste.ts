import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

import {
  extractFigmaBuffer,
  extractFigmeta,
  extractSelectedNodeIds,
} from "../../app/lib/figma-clipboard.js";
import { importFigmaClipboardFromBuffer } from "../../server/lib/figma-clipboard-local-decode.js";
import {
  collectImageRefHashes,
  hydrateImageRefsInHtml,
} from "../../server/lib/figma-image-hydration.js";
import { comparePngs } from "./lib/compare.js";
import { renderHtmlToPng } from "./lib/render.js";

async function hydratePasteImages(
  html: string,
  fileKey: string,
): Promise<{ html: string; resolved: number; missing: number } | null> {
  if (!process.env.FIGMA_FIDELITY_TOKEN) return null;
  const hashes = collectImageRefHashes(html);
  if (hashes.length === 0) return null;
  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/images`,
    {
      headers: { "X-Figma-Token": process.env.FIGMA_FIDELITY_TOKEN! },
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Figma image-fill lookup failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    meta?: { images?: Record<string, string | null | undefined> };
    images?: Record<string, string | null | undefined>;
  };
  const json = { images: body.meta?.images ?? body.images };
  const urls = new Map<string, string>();
  for (const hash of hashes) {
    const url = json.images?.[hash];
    if (typeof url === "string" && url) urls.set(hash, url);
  }
  const out = hydrateImageRefsInHtml(html, urls);
  return {
    html: out.html,
    resolved: out.resolved,
    missing: out.missing.length,
  };
}

const OUT_DIR = ".tmp/figma-fidelity/paste";
const IMPORT_DIR = ".tmp/figma-fidelity/import";
const MANIFEST = "templates/design/scripts/figma-fidelity/paste-corpus.json";

interface PasteCase {
  id: string;
  file: string;
  reference?: string;
  referencePng?: string;
  notes?: string;
}

interface CaseOutcome {
  id: string;
  status: "ok" | "failed";
  fileKey?: string;
  selectedNodeIds?: string[];
  bufferBytes?: number;
  frameCount?: number;
  nodeCount?: number;
  unresolvedImages?: number;
  hydratedImages?: number;
  warnings?: string[];
  vsFigma?: {
    diffPercent: number;
    meanDelta: number;
    dimensionMismatch: boolean;
  };
  vsRest?: {
    diffPercent: number;
    meanDelta: number;
    dimensionMismatch: boolean;
  };
  vsFigmaExcludingImages?: { diffPercent: number; excludedPercent: number };
  renderWarnings?: string[];
  error?: string;
}

async function imagePlaceholderRects(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  html: string,
  width: number,
  height: number,
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  const page = await browser.newPage({
    viewport: {
      width: Math.ceil(width),
      height: Math.min(2000, Math.ceil(height)),
    },
  });
  try {
    await page.setContent(html);
    await page.evaluate("globalThis.__name ||= (fn) => fn;");
    return await page.evaluate(() => {
      const out: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
      }> = [];
      document
        .querySelectorAll<HTMLElement>("[data-figma-image-ref]")
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return;
          out.push({
            x: r.left + window.scrollX,
            y: r.top + window.scrollY,
            width: r.width,
            height: r.height,
          });
        });
      return out;
    });
  } finally {
    await page.close();
  }
}

async function runCase(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  testCase: PasteCase,
): Promise<CaseOutcome> {
  if (!existsSync(testCase.file)) {
    throw new Error(`No captured clipboard payload at ${testCase.file}`);
  }
  const clipboardHtml = readFileSync(testCase.file, "utf8");

  const figmeta = extractFigmeta(clipboardHtml);
  if (!figmeta?.fileKey) {
    throw new Error(
      "No decodable figmeta in the captured payload — this is not a Figma scene copy.",
    );
  }
  const bufferBase64 = extractFigmaBuffer(clipboardHtml);
  if (!bufferBase64) {
    throw new Error(
      "figmeta present but no (figma) binary buffer — the local decode path has nothing to decode.",
    );
  }
  const selectedNodeIds = figmeta.selectedNodeData
    ? extractSelectedNodeIds(figmeta.selectedNodeData)
    : [];

  const result = await importFigmaClipboardFromBuffer({
    bufferBase64,
    fileKey: figmeta.fileKey,
    originalName: testCase.id,
  });

  const dir = join(OUT_DIR, testCase.id);
  mkdirSync(dir, { recursive: true });

  if (result.files.length !== 1) {
    throw new Error(
      `Paste produced ${result.files.length} screens (${result.files
        .map((f) => f.preferredFrame?.title ?? f.filename)
        .join(", ")}); this harness compares one frame against one reference.`,
    );
  }
  const file = result.files[0]!;
  // The clipboard carries image HASHES, never bytes. The product resolves them
  // through `hydrate-figma-paste-images` once Figma is connected, so measuring
  // the unhydrated HTML scores a documented absence rather than the converter:
  // on the Untitled UI landing page the placeholders alone cover 16% of the
  // page. Hydrate here when a token is available so the number matches what a
  // connected user actually gets, and keep the unhydrated one beside it.
  const hydration = await hydratePasteImages(file.content, figmeta.fileKey);
  if (hydration) file.content = hydration.html;
  const width = file.preferredFrame?.width;
  const height = file.preferredFrame?.height;
  if (!width || !height) {
    throw new Error("Pasted screen has no preferred frame size to render at.");
  }
  writeFileSync(join(dir, "paste.html"), file.content);
  writeFileSync(
    join(dir, "stats.json"),
    JSON.stringify(
      {
        ...result.stats,
        ...(hydration
          ? {
              unresolvedImageCount: hydration.missing,
              hydratedImageCount: hydration.resolved,
            }
          : {}),
        warnings: hydration
          ? result.warnings.filter(
              (warning) => !/images could not be loaded/i.test(warning),
            )
          : result.warnings,
        selectedNodeIds,
      },
      null,
      2,
    ),
  );

  const rendered = await renderHtmlToPng(browser, file.content, {
    width,
    height,
    deviceScaleFactor: 1,
  });
  writeFileSync(join(dir, "paste.png"), rendered.png);

  const placeholderRects = await imagePlaceholderRects(
    browser,
    file.content,
    width,
    height,
  );

  const outcome: CaseOutcome = {
    id: testCase.id,
    status: "ok",
    fileKey: figmeta.fileKey,
    selectedNodeIds,
    bufferBytes: Buffer.from(bufferBase64, "base64").length,
    frameCount: result.stats.frameCount,
    nodeCount: result.stats.nodeCount,
    unresolvedImages: hydration
      ? hydration.missing
      : result.stats.unresolvedImageCount,
    hydratedImages: hydration?.resolved ?? 0,
    warnings: result.warnings,
    renderWarnings: rendered.warnings,
  };

  const reference = testCase.reference;
  const figmaRef =
    testCase.referencePng ??
    (reference ? join(IMPORT_DIR, reference, "figma.png") : null);
  if (testCase.referencePng && !existsSync(testCase.referencePng)) {
    throw new Error(
      `referencePng ${testCase.referencePng} is missing; a case that names a reference must have one.`,
    );
  }
  const restRef = reference ? join(IMPORT_DIR, reference, "import.png") : null;
  if (figmaRef && existsSync(figmaRef)) {
    const comparison = await comparePngs(
      browser,
      readFileSync(figmaRef),
      rendered.png,
      { threshold: 8 },
    );
    writeFileSync(join(dir, "diff-figma.png"), comparison.diffPng);
    outcome.vsFigma = {
      diffPercent: comparison.diffRatio * 100,
      meanDelta: comparison.meanDelta,
      dimensionMismatch: comparison.dimensionMismatch,
    };
    if (placeholderRects.length) {
      const converterOnly = await comparePngs(
        browser,
        readFileSync(figmaRef),
        rendered.png,
        { threshold: 8, excludeRects: placeholderRects },
      );
      outcome.vsFigmaExcludingImages = {
        diffPercent: converterOnly.diffRatio * 100,
        excludedPercent:
          (converterOnly.excludedPixels /
            Math.max(
              1,
              converterOnly.excludedPixels + converterOnly.comparedPixels,
            )) *
          100,
      };
    }
  }
  if (restRef && existsSync(restRef)) {
    const comparison = await comparePngs(
      browser,
      readFileSync(restRef),
      rendered.png,
      { threshold: 8 },
    );
    writeFileSync(join(dir, "diff-rest.png"), comparison.diffPng);
    outcome.vsRest = {
      diffPercent: comparison.diffRatio * 100,
      meanDelta: comparison.meanDelta,
      dimensionMismatch: comparison.dimensionMismatch,
    };
  }
  return outcome;
}

if (!existsSync(MANIFEST)) {
  throw new Error(
    `No paste corpus at ${MANIFEST}. It is a JSON array of {"id","file","reference"} entries.`,
  );
}
const filter = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const cases = (
  JSON.parse(readFileSync(MANIFEST, "utf8")) as PasteCase[]
).filter((testCase) => !filter || testCase.id.includes(filter));
if (!cases.length) {
  throw new Error(
    `No paste cases matched${filter ? ` filter "${filter}"` : ""}.`,
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
        outcome.vsFigma
          ? `${outcome.vsFigma.diffPercent.toFixed(3)}% vs Figma\n`
          : `decoded ${outcome.nodeCount} nodes (no reference)\n`,
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
  "\n  case                       vsFigma%  exImg%   vsRest%   nodes   noImg  notes",
);
console.log("  " + "-".repeat(98));
for (const outcome of outcomes) {
  if (outcome.status === "failed") {
    console.log(`  ${outcome.id.padEnd(25)}  FAILED — ${outcome.error}`);
    continue;
  }
  const notes: string[] = [];
  if (outcome.vsFigma?.dimensionMismatch) notes.push("SIZE MISMATCH vs Figma");
  if (outcome.warnings?.length)
    notes.push(`${outcome.warnings.length} warning(s)`);
  if (outcome.renderWarnings?.length)
    notes.push(`${outcome.renderWarnings.length} render warning(s)`);
  console.log(
    `  ${outcome.id.padEnd(25)}  ` +
      `${(outcome.vsFigma ? outcome.vsFigma.diffPercent.toFixed(3) : "—").padStart(8)}  ` +
      `${(outcome.vsFigmaExcludingImages ? outcome.vsFigmaExcludingImages.diffPercent.toFixed(3) : "—").padStart(7)}  ` +
      `${(outcome.vsRest ? outcome.vsRest.diffPercent.toFixed(3) : "—").padStart(8)}  ` +
      `${String(outcome.nodeCount).padStart(5)}  ` +
      `${String(outcome.unresolvedImages).padStart(5)}  ${notes.join(", ")}`,
  );
}
console.log(
  `\n  noImg = image fills the clipboard cannot carry; they render as placeholders.` +
    `\n  exImg = vsFigma with those placeholder boxes excluded, i.e. the converter alone.` +
    `\n  artifacts: ${OUT_DIR}/<case>/{paste,diff-figma,diff-rest}.png\n`,
);
if (outcomes.some((o) => o.status === "failed")) process.exitCode = 1;
