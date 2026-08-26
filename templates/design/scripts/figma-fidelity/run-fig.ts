import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * `.fig` upload fidelity run: a real Figma `.fig` file -> our HTML -> pixels.
 *
 * The `.fig` path is a SECOND, independent converter (`fig-file-to-html.ts`)
 * from the REST one (`figma-node-to-html.ts`). Two walkers over the same design
 * drift apart, and that drift stays invisible until something measures both
 * against one reference. This harness measures two numbers per frame:
 *
 *   vsFigma — the `.fig` render against Figma's own PNG of that frame, reusing
 *             the reference the import harness already cached. The real
 *             fidelity number.
 *   vsRest  — the `.fig` render against the REST importer's render of the same
 *             frame. Pure cross-path drift; it needs no Figma request at all,
 *             so it stays measurable while the REST quota is exhausted.
 *
 * Frames line up across the two paths for free: a `.fig` GUID is
 * `sessionID:localID`, which is exactly the shape of a REST node id.
 *
 * Usage:
 *   pnpm figma-fidelity:fig            # whole corpus
 *   pnpm figma-fidelity:fig <filter>   # matching ids
 */
import { chromium } from "@playwright/test";

import { decodeFig } from "../../server/lib/fig-file-decoder.js";
import {
  collectTopLevelFrames,
  guidKey,
  renderHtmlTemplates,
  type FigNode,
} from "../../server/lib/fig-file-to-html.js";
import { parseFigmaNodeId } from "../../shared/figma-url.js";
import { comparePngs } from "./lib/compare.js";
import { renderHtmlToPng } from "./lib/render.js";

const OUT_DIR = ".tmp/figma-fidelity/fig";
const IMPORT_DIR = ".tmp/figma-fidelity/import";
const MANIFEST = "templates/design/scripts/figma-fidelity/fig-corpus.json";
const IMPORT_MANIFEST =
  "templates/design/scripts/figma-fidelity/import-corpus.json";

interface FigCase {
  id: string;
  /** Path to the `.fig`, absolute or relative to the repo root. */
  file: string;
  /** Optional allow-list of `sessionID:localID` frame keys; default is all. */
  frames?: string[];
  /**
   * Substring of the refusal this case is pinning. A product limit that fires
   * correctly is a PASS, not a failure: reporting it as one leaves the harness
   * permanently red, and a real regression then hides in the noise. The case
   * still fails if it is refused for a different reason, or not refused at all.
   */
  expectRefusal?: string;
  notes?: string;
}

interface FrameOutcome {
  frameKey: string;
  frameName: string;
  width: number;
  height: number;
  /** Against Figma's own render, when the import harness cached one. */
  vsFigma?: {
    diffPercent: number;
    meanDelta: number;
    dimensionMismatch: boolean;
  };
  /** Against the REST importer's render of the same frame. */
  vsRest?: {
    diffPercent: number;
    meanDelta: number;
    dimensionMismatch: boolean;
  };
  renderWarnings: string[];
}

interface CaseOutcome {
  id: string;
  status: "ok" | "failed" | "refused-as-expected";
  fileBytes?: number;
  frameCount?: number;
  pageCount?: number;
  /** Nodes the `.fig` walker could not render exactly; reported, never hidden. */
  approximatedNodes?: number;
  /** Frames rendered but with no reference on either side to compare against. */
  unreferencedFrames?: number;
  frames?: FrameOutcome[];
  error?: string;
}

/**
 * Map `sessionID:localID` -> import case id, so a `.fig` frame can find the
 * Figma reference and the REST render the import harness already produced for
 * that same node.
 */
function buildReferenceIndex(): Map<string, string> {
  const index = new Map<string, string>();
  if (!existsSync(IMPORT_MANIFEST)) return index;
  const cases = JSON.parse(readFileSync(IMPORT_MANIFEST, "utf8")) as Array<{
    id: string;
    url: string;
  }>;
  for (const testCase of cases) {
    const nodeId = parseFigmaNodeId(testCase.url);
    if (nodeId) index.set(nodeId, testCase.id);
  }
  return index;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

async function runCase(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  testCase: FigCase,
  references: Map<string, string>,
): Promise<CaseOutcome> {
  if (!existsSync(testCase.file)) {
    throw new Error(`No .fig at ${testCase.file}`);
  }
  const fileBytes = statSync(testCase.file).size;
  const buffer = readFileSync(testCase.file);
  const decoded = decodeFig(buffer);
  // A partially decoded document renders as a plausible-looking design that is
  // quietly missing nodes. That is exactly the "truncated run is not a
  // completed one" failure, so it stops the case rather than scoring it.
  if (decoded.decodeError) {
    throw new Error(`.fig decode error: ${decoded.decodeError}`);
  }

  // Images resolve through `imageMap`, and a value that already looks like a
  // URL passes through untouched. The harness renders with `setContent`, where
  // a relative path would resolve against about:blank, so inline them.
  const imageMap = new Map<string, string>();
  for (const image of decoded.images) {
    const mime = IMAGE_MIME[image.ext] ?? "application/octet-stream";
    imageMap.set(
      image.hash,
      `data:${mime};base64,${image.bytes.toString("base64")}`,
    );
  }

  const doc = decoded.document as { nodeChanges?: FigNode[] } | null;
  if (!doc?.nodeChanges?.length) {
    throw new Error(".fig decoded to a document with no nodeChanges.");
  }

  // Resolve the frame geometry from the node tree; `renderHtmlTemplates`
  // reports width/height per frame but not the GUID, and the GUID is what
  // matches a frame to its REST counterpart.
  const childrenOf = new Map<string, FigNode[]>();
  const roots: FigNode[] = [];
  for (const node of doc.nodeChanges) {
    const parent = node.parentIndex?.guid;
    if (parent) {
      const key = guidKey(parent);
      const list = childrenOf.get(key) ?? [];
      list.push(node);
      childrenOf.set(key, list);
    }
    if (node.type === "DOCUMENT") roots.push(node);
  }
  const pages = roots
    .flatMap((root) => childrenOf.get(guidKey(root.guid)) ?? [])
    .filter((node) => node.type === "CANVAS");
  const frameNodes = pages.flatMap((page) =>
    collectTopLevelFrames(page, childrenOf),
  );
  const frameKeyByName = new Map<string, string[]>();
  for (const frame of frameNodes) {
    const list = frameKeyByName.get(frame.name ?? "") ?? [];
    list.push(guidKey(frame.guid));
    frameKeyByName.set(frame.name ?? "", list);
  }

  const wanted = testCase.frames?.length ? new Set(testCase.frames) : null;
  const selection = wanted
    ? new Set(
        frameNodes
          .filter((frame) => wanted.has(guidKey(frame.guid)))
          .map((frame) => guidKey(frame.guid)),
      )
    : undefined;
  if (wanted && selection!.size !== wanted.size) {
    const missing = [...wanted].filter((key) => !selection!.has(key));
    throw new Error(
      `.fig has no top-level frame for ${missing.join(", ")} — ` +
        `available: ${frameNodes
          .map((f) => `${guidKey(f.guid)} (${f.name})`)
          .slice(0, 12)
          .join(", ")}`,
    );
  }

  const result = renderHtmlTemplates(decoded.document, {
    imageMap,
    // The product's frame/total byte budgets bound HTML that carries short
    // durable image URLs. This harness inlines the same images as base64 so a
    // `setContent` page can resolve them, which inflates a frame by orders of
    // magnitude for reasons that have nothing to do with design complexity.
    // Measuring the product budget against inlined bytes would fail files the
    // product imports fine; the budgets have their own coverage in
    // `fig-file-import.test.ts`.
    maxFrameOutputBytes: Number.MAX_SAFE_INTEGER,
    maxTotalOutputBytes: Number.MAX_SAFE_INTEGER,
    ...(selection ? { selection } : {}),
  });

  const dir = join(OUT_DIR, testCase.id);
  mkdirSync(dir, { recursive: true });

  const frames: FrameOutcome[] = [];
  let unreferenced = 0;
  for (const frame of result.frames) {
    // `renderHtmlTemplates` returns frames by name, not GUID. Names are unique
    // within this corpus by construction; a duplicate is reported rather than
    // guessed at, because comparing the wrong frame scores as a huge false diff.
    const candidates = frameKeyByName.get(frame.frameName) ?? [];
    if (candidates.length !== 1) {
      throw new Error(
        `Frame name "${frame.frameName}" matches ${candidates.length} GUIDs; ` +
          `cannot line it up with a REST node id. Pin the case's frames list.`,
      );
    }
    const frameKey = candidates[0]!;
    if (!frame.width || !frame.height) {
      throw new Error(`Frame ${frameKey} has no width/height to render at.`);
    }

    const frameDir = join(dir, frameKey.replace(":", "-"));
    mkdirSync(frameDir, { recursive: true });
    writeFileSync(join(frameDir, "fig.html"), frame.html);

    const rendered = await renderHtmlToPng(browser, frame.html, {
      width: frame.width,
      height: frame.height,
      deviceScaleFactor: 1,
    });
    writeFileSync(join(frameDir, "fig.png"), rendered.png);

    const outcome: FrameOutcome = {
      frameKey,
      frameName: frame.frameName,
      width: frame.width,
      height: frame.height,
      renderWarnings: rendered.warnings,
    };

    const importCase = references.get(frameKey);
    const figmaRef = importCase
      ? join(IMPORT_DIR, importCase, "figma.png")
      : null;
    const restRef = importCase
      ? join(IMPORT_DIR, importCase, "import.png")
      : null;

    if (figmaRef && existsSync(figmaRef)) {
      const comparison = await comparePngs(
        browser,
        readFileSync(figmaRef),
        rendered.png,
        { threshold: 8 },
      );
      writeFileSync(join(frameDir, "diff-figma.png"), comparison.diffPng);
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
      writeFileSync(join(frameDir, "diff-rest.png"), comparison.diffPng);
      outcome.vsRest = {
        diffPercent: comparison.diffRatio * 100,
        meanDelta: comparison.meanDelta,
        dimensionMismatch: comparison.dimensionMismatch,
      };
    }
    if (!outcome.vsFigma && !outcome.vsRest) unreferenced += 1;

    writeFileSync(
      join(frameDir, "compare.json"),
      JSON.stringify(outcome, null, 2),
    );
    frames.push(outcome);
  }

  return {
    id: testCase.id,
    status: "ok",
    fileBytes,
    pageCount: result.pageCount,
    frameCount: result.frameCount,
    approximatedNodes: result.approximatedNodes.length,
    unreferencedFrames: unreferenced || undefined,
    frames,
  };
}

if (!existsSync(MANIFEST)) {
  throw new Error(
    `No .fig corpus at ${MANIFEST}. It is a JSON array of {"id","file","frames"} entries.`,
  );
}
const filter = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const cases = (JSON.parse(readFileSync(MANIFEST, "utf8")) as FigCase[]).filter(
  (testCase) => !filter || testCase.id.includes(filter),
);
if (!cases.length) {
  throw new Error(
    `No .fig cases matched${filter ? ` filter "${filter}"` : ""}.`,
  );
}

const references = buildReferenceIndex();
mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const outcomes: CaseOutcome[] = [];
try {
  for (const testCase of cases) {
    process.stdout.write(`· ${testCase.id} … `);
    try {
      const outcome = await runCase(browser, testCase, references);
      if (testCase.expectRefusal) {
        // The case exists to prove the limit refuses this file. Rendering it
        // means the limit stopped working.
        throw new Error(
          `expected this file to be refused with "${testCase.expectRefusal}", but it rendered ${outcome.frameCount} frame(s)`,
        );
      }
      outcomes.push(outcome);
      const measured = outcome.frames!.filter((f) => f.vsFigma || f.vsRest);
      process.stdout.write(
        `${outcome.frameCount} frame(s), ${measured.length} measured\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (testCase.expectRefusal && message.includes(testCase.expectRefusal)) {
        outcomes.push({
          id: testCase.id,
          status: "refused-as-expected",
          error: message,
        });
        process.stdout.write(`refused as expected — ${message}\n`);
      } else {
        outcomes.push({ id: testCase.id, status: "failed", error: message });
        process.stdout.write(`FAILED — ${message}\n`);
      }
    }
  }
} finally {
  await browser.close();
}

writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(outcomes, null, 2));
console.log(
  "\n  case / frame                          vsFigma%   vsRest%   notes",
);
console.log("  " + "-".repeat(84));
for (const outcome of outcomes) {
  if (outcome.status === "failed") {
    console.log(`  ${outcome.id.padEnd(36)}  FAILED — ${outcome.error}`);
    continue;
  }
  if (outcome.status === "refused-as-expected") {
    console.log(
      `  ${outcome.id.padEnd(36)}  refused as expected — ${outcome.error}`,
    );
    continue;
  }
  const caseNotes = [
    `${(outcome.fileBytes! / 1024 / 1024).toFixed(1)}MB`,
    `${outcome.pageCount} page(s)`,
    `${outcome.approximatedNodes} approximated`,
  ];
  if (outcome.unreferencedFrames)
    caseNotes.push(`${outcome.unreferencedFrames} unreferenced`);
  if (!outcome.frames!.some((f) => f.vsFigma || f.vsRest))
    caseNotes.push("NO FRAME MEASURED (render-only coverage)");
  console.log(
    `  ${outcome.id.padEnd(36)}  ${" ".repeat(19)}${caseNotes.join(", ")}`,
  );
  for (const frame of outcome.frames!) {
    const notes: string[] = [];
    if (frame.vsFigma?.dimensionMismatch) notes.push("SIZE MISMATCH vs Figma");
    if (frame.vsRest?.dimensionMismatch) notes.push("SIZE MISMATCH vs REST");
    if (frame.renderWarnings.length)
      notes.push(`${frame.renderWarnings.length} render warning(s)`);
    console.log(
      `    ${`${frame.frameKey} ${frame.frameName}`.slice(0, 34).padEnd(34)}  ` +
        `${(frame.vsFigma ? frame.vsFigma.diffPercent.toFixed(3) : "—").padStart(8)}  ` +
        `${(frame.vsRest ? frame.vsRest.diffPercent.toFixed(3) : "—").padStart(8)}  ${notes.join(", ")}`,
    );
  }
}
console.log(
  `\n  artifacts: ${OUT_DIR}/<case>/<frame>/{fig,diff-figma,diff-rest}.png\n`,
);
if (outcomes.some((o) => o.status === "failed")) process.exitCode = 1;
