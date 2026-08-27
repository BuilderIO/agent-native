import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Import fidelity run: a real Figma node -> our HTML -> pixels, compared
 * against Figma's own render of the same node.
 *
 * This is the mirror of `run-export.ts`. It calls the real `mapFigmaNodeToHtml`
 * converter — the same pure function `import-figma-frame` uses — so a fix here
 * is a fix in the product, not in a test double.
 *
 * Needs a Figma personal access token with `file_content:read`, supplied as
 * FIGMA_FIDELITY_TOKEN. That is deliberately NOT the app's `FIGMA_ACCESS_TOKEN`
 * vault key: this is a local QA harness, and the app's credential must keep its
 * single vault-backed resolver.
 *
 * Every REST response and reference render is cached under
 * `.tmp/figma-fidelity/import-cache/`, because Figma allows only 10-20 Tier 1
 * requests per minute and an uncached re-run would burn the budget on repeat
 * fetches rather than on new cases.
 *
 * Usage:
 *   FIGMA_FIDELITY_TOKEN=... pnpm figma-fidelity:import          # whole corpus
 *   FIGMA_FIDELITY_TOKEN=... pnpm figma-fidelity:import <filter> # matching ids
 */
import { chromium } from "@playwright/test";

import {
  buildGoogleFontsUrl,
  withFigmaBoxModelReset,
  withFigmaFontLoading,
} from "../../server/lib/figma-node-import.js";
import {
  collectFallbackNodeIds,
  collectFontUsage,
  collectImageFillRefs,
  mapFigmaNodeToHtml,
  type FigmaNode,
} from "../../server/lib/figma-node-to-html.js";
import { normalizeImportedHtmlDocument } from "../../server/lib/import-design-files.js";
import { parseFigmaFileKey, parseFigmaNodeId } from "../../shared/figma-url.js";
import { comparePngs } from "./lib/compare.js";
import { renderHtmlToPng } from "./lib/render.js";

const OUT_DIR = ".tmp/figma-fidelity/import";
/** Figma's per-minute rate limit clears in seconds, so a few waits absorb a burst. */
const MAX_RATE_LIMIT_RETRIES = 6;
/**
 * Figma answers a per-minute burst with `Retry-After` in seconds — but it uses
 * the SAME header for an exhausted account quota, where the value is days
 * (398128s / 4.6 days observed). Honouring that literally makes the run sit
 * there looking like it is still working. Anything past this cap is a quota
 * wall, not pacing, and has to be said out loud.
 */
const MAX_RATE_LIMIT_WAIT_MS = 120_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Figma allows 10-20 Tier 1 requests a minute. Retrying after the fact is not
 * enough: firing a whole corpus as fast as the loop can go trips the limit on
 * the first few cases, and Figma then answers with the ACCOUNT reset time
 * rather than the burst window, which reads as "quota exhausted for days" when
 * it is really "you asked too fast". Pace requests instead.
 */
const MIN_REQUEST_INTERVAL_MS = 5_000;
/** A stalled request must not look like a slow one — the run wedged silently for 27 minutes. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Render cost scales with id count, so keep each request small. */
const FALLBACK_RENDER_BATCH = 5;
/**
 * Longest edge Figma will render. Past it `/images` silently returns the whole
 * node scaled down instead of erroring, so the caller has to ask for that scale
 * itself rather than discover it in the pixel dimensions afterwards.
 */
const FIGMA_MAX_RENDER_EDGE_PX = 16_384;

let nextRequestAt = 0;
async function paced<T>(run: () => Promise<T>): Promise<T> {
  const wait = nextRequestAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  return run();
}

function rateLimitWaitMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    const waitMs = retryAfter * 1000;
    if (waitMs > MAX_RATE_LIMIT_WAIT_MS) {
      const resetsAt = new Date(Date.now() + waitMs).toISOString();
      throw new Error(
        `Figma rate limit is not a burst: it asked for ${Math.round(retryAfter / 3600)}h ` +
          `(until ${resetsAt}), so waiting would stall this run for days.\n` +
          `Measured 2026-08-26: the budget follows the FILE's plan, not the account. A file ` +
          `in a Starter space answers 429 with 'x-figma-plan-tier: starter' however many ` +
          `tokens you hold; a node in a paid team's project answers 200 with no rate-limit ` +
          `headers at all — same account, same token, same minute. A second token does not ` +
          `help; getting the node into a paid team's project does.\n` +
          `FIGMA_INTEROPERABILITY.md records how to do that without Figma's move/duplicate ` +
          `UI, which wedges on several of these files.\n` +
          `Until then, run with --offline to replay cases from the cache.`,
      );
    }
    return waitMs;
  }
  return Math.min(MAX_RATE_LIMIT_WAIT_MS, 2 ** attempt * 5_000);
}
const CACHE_DIR = ".tmp/figma-fidelity/import-cache";
const MANIFEST = "templates/design/scripts/figma-fidelity/import-corpus.json";

/**
 * Replay a case purely from what is already on disk — the cached REST responses
 * and the saved reference render. Figma's Tier 1 budget is per file and a
 * Community file duplicated into Drafts exhausts it for days, which would
 * otherwise stop all converter iteration on exactly the complex real-world
 * designs that matter most. Offline replay decouples fixing from fetching.
 *
 * It never silently falls back to the network, and never silently pretends a
 * missing response is an empty one: an uncached request under `--offline` is an
 * error naming what is missing.
 */
const offline = process.argv.includes("--offline");

const token = process.env.FIGMA_FIDELITY_TOKEN?.trim();
if (!offline && !token) {
  throw new Error(
    "FIGMA_FIDELITY_TOKEN is required (a Figma personal access token with " +
      "file_content:read). It is never printed or written to disk.",
  );
}

interface ImportCase {
  id: string;
  url: string;
  /** Optional note about what this case is meant to stress. */
  stresses?: string;
}

/**
 * Intrinsic pixel size from a PNG or JPEG header. Only these two: they are what
 * Figma serves for image fills, and a format we cannot read returns null rather
 * than a guessed size.
 */
function imageSizeFromBytes(
  bytes: Buffer,
): { width: number; height: number } | null {
  if (
    bytes.length >= 24 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      // SOF0..SOF15, skipping the non-frame markers in that range.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }
  return null;
}

function cachePath(kind: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return join(CACHE_DIR, `${kind}-${digest}`);
}

async function figmaJson<T>(path: string, attempt = 0): Promise<T> {
  const cached = cachePath("json", path);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8")) as T;
  if (offline) {
    throw new Error(
      `--offline: no cached response for ${path}. Run this case online once to populate ` +
        `.tmp/figma-fidelity/import-cache/, then replay offline.`,
    );
  }
  const response = await paced(() =>
    fetch(`https://api.figma.com/v1${path}`, {
      headers: { "X-Figma-Token": token! },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
  );
  // Figma allows only 10-20 Tier 1 requests a minute and answers 429 with a
  // `Retry-After` in seconds. Treating that as a case failure would report a
  // pacing problem as an import defect — which is exactly the kind of
  // misattribution this harness exists to avoid.
  if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    const waitMs = rateLimitWaitMs(response, attempt);
    process.stdout.write(
      `(rate limited, waiting ${Math.round(waitMs / 1000)}s) `,
    );
    await sleep(waitMs);
    return figmaJson<T>(path, attempt + 1);
  }
  if (!response.ok) {
    // Figma's own message names the real cause (bad scope, rate limit, missing
    // file). Surfacing the status alone would send the next fix at the wrong
    // target.
    // Figma's body names the real cause (bad scope, rate limit, missing file).
    // If the body itself cannot be read, say so — an empty string would read as
    // "Figma returned no explanation", which is a different and misleading fact.
    let detail: string;
    try {
      detail = (await response.text()).slice(0, 300);
    } catch (bodyError) {
      detail = `<response body unreadable: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}>`;
    }
    throw new Error(
      `Figma GET ${path} failed: ${response.status} ${response.statusText}. ${detail}`,
    );
  }
  const json = (await response.json()) as T;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, JSON.stringify(json));
  return json;
}

async function fetchBinary(url: string, attempt = 0): Promise<Buffer> {
  const cached = cachePath("bin", url);
  if (existsSync(cached)) return readFileSync(cached);
  if (offline) {
    throw new Error(
      `--offline: no cached asset for ${url.slice(0, 80)}. Run this case online once first.`,
    );
  }
  const response = await paced(() =>
    fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  );
  if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
    await sleep(rateLimitWaitMs(response, attempt));
    return fetchBinary(url, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(
      `Asset fetch failed: ${response.status} ${url.slice(0, 120)}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, buffer);
  return buffer;
}

interface NodesResponse {
  nodes: Record<string, { document: FigmaNode } | undefined>;
}
interface ImagesResponse {
  images: Record<string, string | null>;
  err?: string | null;
}
interface FileImagesResponse {
  meta: { images: Record<string, string> };
}

interface CaseOutcome {
  id: string;
  status: "ok" | "failed";
  diffPercent?: number;
  meanDelta?: number;
  dimensionMismatch?: boolean;
  fidelity?: { exact: number; approximated: number; imageFallback: number };
  /** Nodes Figma had nothing to draw for; omitted from the render, never silent. */
  unrenderableNodes?: number;
  /** <1 when the node was too tall for Figma to render at 1:1; both sides were scaled to match. */
  renderScale?: number;
  /** Both sizes, so a 1px scaling round-off reads differently from a wrong node. */
  sizes?: { reference: string; candidate: string };
  renderWarnings?: string[];
  error?: string;
}

async function runCase(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  testCase: ImportCase,
): Promise<CaseOutcome> {
  const fileKey = parseFigmaFileKey(testCase.url);
  const nodeId = parseFigmaNodeId(testCase.url);
  if (!fileKey || !nodeId) {
    throw new Error(
      `Could not parse a file key and node id from ${testCase.url}`,
    );
  }
  const dir = join(OUT_DIR, testCase.id);
  mkdirSync(dir, { recursive: true });

  const nodes = await figmaJson<NodesResponse>(
    `/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&geometry=paths`,
  );
  const node = nodes.nodes[nodeId]?.document;
  if (!node) {
    throw new Error(
      `Figma returned no document for node ${nodeId}. Check the node id and that the token can read this file.`,
    );
  }
  writeFileSync(join(dir, "node.json"), JSON.stringify(node, null, 2));

  const box = node.absoluteBoundingBox;
  if (!box?.width || !box?.height) {
    throw new Error(
      `Node ${nodeId} has no absoluteBoundingBox to render against.`,
    );
  }

  // Image fills resolve to expiring S3 URLs; the harness renders them directly
  // rather than mirroring them into storage the way the real import does.
  const imageRefs = collectImageFillRefs(node);
  let imageFillUrls: Record<string, string> = {};
  if (imageRefs.length) {
    const response = await figmaJson<FileImagesResponse>(
      `/files/${fileKey}/images`,
    );
    imageFillUrls = response.meta.images ?? {};
  }

  const fallbackIds = collectFallbackNodeIds(node);
  const fallbackImageUrls: Record<string, string> = {};
  const unrenderable: string[] = [];
  // Figma's rate limit is COST-based and a render request is charged per id, so
  // asking for 21 nodes at once trips it immediately and comes back quoting the
  // ACCOUNT reset time. The product batches for the same reason; match it.
  for (let i = 0; i < fallbackIds.length; i += FALLBACK_RENDER_BATCH) {
    const batch = fallbackIds.slice(i, i + FALLBACK_RENDER_BATCH);
    const response = await figmaJson<ImagesResponse>(
      `/images/${fileKey}?ids=${batch.map(encodeURIComponent).join(",")}&format=png&scale=2`,
    );
    for (const [id, url] of Object.entries(response.images)) {
      // Figma returns null for a node with nothing to draw, and community files
      // are full of empty placeholder vectors. That is a reportable omission,
      // not a reason to fail the whole design — the product warns and omits
      // too. Failing here made every instance-heavy file untestable.
      if (url) fallbackImageUrls[id] = url;
      else unrenderable.push(id);
    }
  }

  // Figma upscales an image fill with nearest-neighbour sampling; the browser
  // smooths. The converter matches it only when told the image's own size, and
  // the product gets that for free from the bytes it already mirrors into
  // storage. Here it comes from the cached asset.
  const imageFillSizes: Record<string, { width: number; height: number }> = {};
  const unsizedImageFills: string[] = [];
  for (const [ref, url] of Object.entries(imageFillUrls)) {
    let size: { width: number; height: number } | null = null;
    try {
      size = imageSizeFromBytes(await fetchBinary(url));
    } catch (error) {
      // An unreadable size is not the same fact as a square one: the fill
      // still renders, but on the smooth path, and the case's number then
      // carries a blur nobody asked about. Name it rather than swallow it.
      unsizedImageFills.push(
        `${ref.slice(0, 8)}: ${error instanceof Error ? error.message.slice(0, 80) : String(error)}`,
      );
      continue;
    }
    if (size) imageFillSizes[ref] = size;
    else
      unsizedImageFills.push(`${ref.slice(0, 8)}: unrecognised image header`);
  }

  const { html, fidelity } = mapFigmaNodeToHtml(node, {
    imageFillUrls,
    fallbackImageUrls,
    imageFillSizes,
  });
  const fontUsage = collectFontUsage(node);
  const fontsUrl = buildGoogleFontsUrl(fontUsage);
  writeFileSync(join(dir, "import.html"), html);
  // The exact document the product persists for this node. `import.html` is
  // the bare converter fragment and only lays out correctly once wrapped; a
  // consumer handed the fragment (the export harness did exactly this) lays it
  // out with the browser's content-box default and every padded element grows.
  // Anything measuring what happens AFTER import has to start from this.
  writeFileSync(
    join(dir, "stored.html"),
    normalizeImportedHtmlDocument(
      withFigmaFontLoading(
        withFigmaBoxModelReset(html || "<div></div>"),
        fontUsage,
      ),
      `Figma node ${nodeId}`,
    ),
  );
  writeFileSync(join(dir, "fidelity.json"), JSON.stringify(fidelity, null, 2));

  // `/images` renders the node's INK extent, not its frame box: an unclipped
  // frame whose children or shadows spill out comes back bigger, and when the
  // spill is up or left the image is shifted too. Figma reports that extent as
  // `absoluteRenderBounds`, so render the same region rather than the frame
  // box — otherwise the comparison scores the offset (a 2px table shadow read
  // as 10%, and a dashboard lost the 106px its content overflows by).
  const ink = node.absoluteRenderBounds ?? box;
  const contentOffset = { left: box.x - ink.x, top: box.y - ink.y };

  // Figma clamps a rendered node to 16384px on its longest side and silently
  // scales the WHOLE image down to fit — a 1440x21306 frame comes back as
  // 1108x16384 with no error and no header saying so. Comparing that against a
  // full-size render measures the scale factor, not the converter (it read 24%
  // on Landify, all of it the downscale). Ask for the scale Figma would have
  // forced anyway and render ours to match, so both sides are the same pixels.
  const longestEdge = Math.max(ink.width, ink.height);
  const renderScale =
    longestEdge > FIGMA_MAX_RENDER_EDGE_PX
      ? FIGMA_MAX_RENDER_EDGE_PX / longestEdge
      : 1;

  const rendered = await renderHtmlToPng(
    browser,
    withFigmaBoxModelReset(html),
    {
      width: ink.width,
      height: ink.height,
      contentOffset,
      deviceScaleFactor: renderScale,
      headHtml: fontsUrl
        ? `<link rel="stylesheet" href="${fontsUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`
        : "",
    },
  );
  writeFileSync(join(dir, "import.png"), rendered.png);

  const reference = await figmaJson<ImagesResponse>(
    `/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${renderScale}`,
  );
  const referenceUrl = reference.images[nodeId];
  if (!referenceUrl) {
    throw new Error(`Figma returned no reference render for ${nodeId}`);
  }
  const referencePng = await fetchBinary(referenceUrl);
  writeFileSync(join(dir, "figma.png"), referencePng);

  const comparison = await comparePngs(browser, referencePng, rendered.png, {
    threshold: 8,
  });
  writeFileSync(join(dir, "diff.png"), comparison.diffPng);
  const { diffPng: _diffPng, ...serializable } = comparison;
  writeFileSync(
    join(dir, "compare.json"),
    JSON.stringify(
      { ...serializable, renderWarnings: rendered.warnings },
      null,
      2,
    ),
  );

  return {
    id: testCase.id,
    status: "ok",
    diffPercent: comparison.diffRatio * 100,
    meanDelta: comparison.meanDelta,
    dimensionMismatch: comparison.dimensionMismatch,
    fidelity: fidelity.summary,
    renderWarnings: [
      ...rendered.warnings,
      // One line, not one per fill: an offline replay cannot read any of them,
      // and thousands of identical warnings bury the render warnings that are
      // actually about this case.
      ...(unsizedImageFills.length
        ? [
            `${unsizedImageFills.length} image fill size(s) unknown, rendered smoothed ` +
              `instead of Figma's nearest-neighbour magnification (first: ${unsizedImageFills[0]})`,
          ]
        : []),
    ],
    unrenderableNodes: unrenderable.length || undefined,
    renderScale: renderScale < 1 ? renderScale : undefined,
    sizes: comparison.dimensionMismatch
      ? {
          reference: `${comparison.reference.width}x${comparison.reference.height}`,
          candidate: `${comparison.candidate.width}x${comparison.candidate.height}`,
        }
      : undefined,
  };
}

if (!existsSync(MANIFEST)) {
  throw new Error(
    `No import corpus at ${MANIFEST}. It is a JSON array of {"id","url"} entries pointing at Figma frame URLs.`,
  );
}
const filter = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const cases = (
  JSON.parse(readFileSync(MANIFEST, "utf8")) as ImportCase[]
).filter((testCase) => !filter || testCase.id.includes(filter));
if (!cases.length) {
  throw new Error(
    `No import cases matched${filter ? ` filter "${filter}"` : ""}.`,
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
        `${outcome.diffPercent!.toFixed(3)}% differing pixels\n`,
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
  "\n  case                            diff%     mean∆   exact  approx  raster  notes",
);
console.log("  " + "-".repeat(90));
for (const outcome of outcomes) {
  if (outcome.status === "failed") {
    console.log(`  ${outcome.id.padEnd(30)}  FAILED — ${outcome.error}`);
    continue;
  }
  const notes: string[] = [];
  if (outcome.sizes)
    notes.push(
      `SIZE figma ${outcome.sizes.reference} vs ours ${outcome.sizes.candidate}`,
    );
  if (outcome.renderWarnings?.length)
    notes.push(`${outcome.renderWarnings.length} render warning(s)`);
  if (outcome.unrenderableNodes)
    notes.push(`${outcome.unrenderableNodes} node(s) Figma could not render`);
  if (outcome.renderScale)
    notes.push(
      `measured at ${(outcome.renderScale * 100).toFixed(1)}% — too tall for Figma to render 1:1`,
    );
  console.log(
    `  ${outcome.id.padEnd(30)}  ${outcome.diffPercent!.toFixed(3).padStart(7)}  ` +
      `${outcome.meanDelta!.toFixed(2).padStart(7)}  ` +
      `${String(outcome.fidelity!.exact).padStart(5)}  ` +
      `${String(outcome.fidelity!.approximated).padStart(6)}  ` +
      `${String(outcome.fidelity!.imageFallback).padStart(6)}  ${notes.join(", ")}`,
  );
}
console.log(`\n  artifacts: ${OUT_DIR}/<case>/{figma,import,diff}.png\n`);
if (outcomes.some((o) => o.status === "failed")) process.exitCode = 1;
