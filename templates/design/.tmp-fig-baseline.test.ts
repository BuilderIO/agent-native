import { readFileSync } from "node:fs";

import { it } from "vitest";

import { createFigImportSession } from "./app/lib/fig-import-worker-session";

const FIXTURE = process.env.FIG_FIXTURE!;

it("decodes, inspects and renders the large fixture", async () => {
  const bytes = readFileSync(FIXTURE);
  const file = {
    name: "big.fig",
    size: bytes.length,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  } as unknown as File;
  const session = createFigImportSession();
  const mem = () =>
    `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB rss`;
  let t = performance.now();
  try {
    const summary = await session.prepare(file);
    console.log(
      `prepare ${Math.round(performance.now() - t)} ms, ${mem()}`,
      JSON.stringify({ ...summary, frames: summary.frames.length }),
    );
  } catch (error) {
    console.log(`prepare FAILED after ${Math.round(performance.now() - t)} ms: ${(error as Error).message}`);
    return;
  }
  t = performance.now();
  try {
    const rendered = session.render();
    const htmlBytes = rendered.frames.reduce((n, f) => n + f.htmlBytes, 0);
    console.log(
      `render ${Math.round(performance.now() - t)} ms, ${mem()}, frames ${rendered.frames.length}, html ${(htmlBytes / 1024 / 1024).toFixed(1)} MB, images ${rendered.images.length}, skipped ${rendered.skippedEmbeddedImageCount}`,
    );
  } catch (error) {
    console.log(`render FAILED after ${Math.round(performance.now() - t)} ms: ${(error as Error).message}`);
  }
}, 600_000);
