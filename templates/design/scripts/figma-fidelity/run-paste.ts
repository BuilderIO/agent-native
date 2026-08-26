import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Clipboard paste fidelity run: a real Figma copy -> our HTML -> pixels.
 *
 * The paste path is the THIRD independent route a Figma design takes into this
 * app, after the REST importer and the `.fig` upload. It shares the `.fig`
 * walker but not its input: a clipboard payload is a kiwi buffer holding a
 * node SUBTREE with no DOCUMENT/CANVAS above it, so it goes through
 * `normalizeClipboardDocument` first, and it carries no image bytes at all —
 * only 20-byte hashes that `hydrate-figma-paste-images` resolves later.
 *
 * That last part is why the number here is read differently from the other two
 * harnesses: every image fill renders as an `about:blank` placeholder, so a
 * design with photography scores a large diff by design. `unresolvedImages`
 * is reported next to the diff so the number stays interpretable instead of
 * looking like a converter regression.
 *
 * Payloads are captured from a real Figma copy (see FIGMA_INTEROPERABILITY.md)
 * and stored under `.tmp/figma-fidelity/clipboard/`. They are inputs, not
 * fixtures — the point is that nothing here is synthesized.
 *
 * Usage:
 *   pnpm figma-fidelity:paste            # whole corpus
 *   pnpm figma-fidelity:paste <filter>   # matching ids
 */
import { chromium } from "@playwright/test";

import {
  extractFigmaBuffer,
  extractFigmeta,
  extractSelectedNodeIds,
} from "../../app/lib/figma-clipboard.js";
import { importFigmaClipboardFromBuffer } from "../../server/lib/figma-clipboard-local-decode.js";
import { comparePngs } from "./lib/compare.js";
import { renderHtmlToPng } from "./lib/render.js";

const OUT_DIR = ".tmp/figma-fidelity/paste";
const IMPORT_DIR = ".tmp/figma-fidelity/import";
const MANIFEST = "templates/design/scripts/figma-fidelity/paste-corpus.json";

interface PasteCase {
  id: string;
  /** Captured clipboard HTML, relative to the repo root. */
  file: string;
  /** Import case whose `figma.png` / `import.png` are the references. */
  reference?: string;
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
  /** Image fills the clipboard could not carry; they render as placeholders. */
  unresolvedImages?: number;
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
  renderWarnings?: string[];
  error?: string;
}

async function runCase(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  testCase: PasteCase,
): Promise<CaseOutcome> {
  if (!existsSync(testCase.file)) {
    throw new Error(`No captured clipboard payload at ${testCase.file}`);
  }
  const clipboardHtml = readFileSync(testCase.file, "utf8");

  // Parse with the same helpers the paste UI uses, so a change to either the
  // marker format or these regexes shows up here rather than in production.
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
    // More than one top-level frame means the reference PNG (a single node
    // render) does not describe what was pasted. Pin the case to one frame
    // rather than comparing a collage against one screen.
    throw new Error(
      `Paste produced ${result.files.length} screens (${result.files
        .map((f) => f.preferredFrame?.title ?? f.filename)
        .join(", ")}); this harness compares one frame against one reference.`,
    );
  }
  const file = result.files[0]!;
  const width = file.preferredFrame?.width;
  const height = file.preferredFrame?.height;
  if (!width || !height) {
    throw new Error("Pasted screen has no preferred frame size to render at.");
  }
  writeFileSync(join(dir, "paste.html"), file.content);
  writeFileSync(
    join(dir, "stats.json"),
    JSON.stringify(
      { ...result.stats, warnings: result.warnings, selectedNodeIds },
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

  const outcome: CaseOutcome = {
    id: testCase.id,
    status: "ok",
    fileKey: figmeta.fileKey,
    selectedNodeIds,
    bufferBytes: Buffer.from(bufferBase64, "base64").length,
    frameCount: result.stats.frameCount,
    nodeCount: result.stats.nodeCount,
    unresolvedImages: result.stats.unresolvedImageCount,
    warnings: result.warnings,
    renderWarnings: rendered.warnings,
  };

  const reference = testCase.reference;
  const figmaRef = reference ? join(IMPORT_DIR, reference, "figma.png") : null;
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
  "\n  case                       vsFigma%   vsRest%   nodes   noImg  notes",
);
console.log("  " + "-".repeat(88));
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
      `${(outcome.vsRest ? outcome.vsRest.diffPercent.toFixed(3) : "—").padStart(8)}  ` +
      `${String(outcome.nodeCount).padStart(5)}  ` +
      `${String(outcome.unresolvedImages).padStart(5)}  ${notes.join(", ")}`,
  );
}
console.log(
  `\n  noImg = image fills the clipboard cannot carry; they render as placeholders.` +
    `\n  artifacts: ${OUT_DIR}/<case>/{paste,diff-figma,diff-rest}.png\n`,
);
if (outcomes.some((o) => o.status === "failed")) process.exitCode = 1;
