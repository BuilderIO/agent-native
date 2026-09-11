/**
 * The fidelity harness is only worth its numbers if the comparator itself is
 * right. These cases pin the properties every conclusion in
 * `design-to-figma-svg.fidelity.spec.ts` rests on: identical renders score
 * zero, a wrongly-sized render is reported rather than silently rescaled, the
 * worst-region report points at the region that actually changed, and a render
 * that quietly lost an asset raises a warning instead of screenshotting a hole.
 */
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { comparePngs } from "./compare.js";
import { renderDocumentToPng, renderHtmlToPng } from "./render.js";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const box = (css: string) =>
  `<div style="position:absolute;inset:0;${css}"></div>`;

describe("comparePngs", () => {
  it("scores identical renders as zero and flags nothing", async () => {
    const a = await renderHtmlToPng(browser, box("background:#3b82f6"), {
      width: 120,
      height: 80,
      deviceScaleFactor: 1,
    });
    const result = await comparePngs(browser, a.png, a.png);
    expect(result.diffRatio).toBe(0);
    expect(result.maxDelta).toBe(0);
    expect(result.dimensionMismatch).toBe(false);
    expect(result.diffPng.byteLength).toBeGreaterThan(0);
  }, 60_000);

  it("scores fully different renders as one", async () => {
    const options = { width: 120, height: 80, deviceScaleFactor: 1 };
    const red = await renderHtmlToPng(
      browser,
      box("background:#ff0000"),
      options,
    );
    const green = await renderHtmlToPng(
      browser,
      box("background:#00ff00"),
      options,
    );
    const result = await comparePngs(browser, red.png, green.png);
    expect(result.diffRatio).toBe(1);
    expect(result.maxDelta).toBe(255);
  }, 60_000);

  it("points the worst-region report at the half that actually changed", async () => {
    const options = { width: 120, height: 80, deviceScaleFactor: 1 };
    const flat = await renderHtmlToPng(
      browser,
      box("background:#ff0000"),
      options,
    );
    const half = await renderHtmlToPng(
      browser,
      box("background:linear-gradient(to right,#ff0000 50%,#00ff00 50%)"),
      options,
    );
    const result = await comparePngs(browser, flat.png, half.png, {
      gridCols: 4,
      gridRows: 4,
    });
    expect(result.diffRatio).toBeGreaterThan(0.45);
    expect(result.diffRatio).toBeLessThan(0.55);
    // Every fully-differing cell must be in the right-hand half.
    const hot = result.worstCells.filter((cell) => cell.diffRatio > 0.9);
    expect(hot.length).toBeGreaterThan(0);
    for (const cell of hot) expect(cell.x).toBeGreaterThanOrEqual(60);
  }, 60_000);

  it("reports a size mismatch instead of rescaling one side to fit", async () => {
    // Rescaling would let a wrongly-sized export score as a near match, which
    // is the failure mode this harness exists to catch.
    const small = await renderHtmlToPng(browser, box("background:#000"), {
      width: 60,
      height: 40,
      deviceScaleFactor: 1,
    });
    const large = await renderHtmlToPng(browser, box("background:#000"), {
      width: 120,
      height: 80,
      deviceScaleFactor: 1,
    });
    const result = await comparePngs(browser, large.png, small.png);
    expect(result.dimensionMismatch).toBe(true);
    expect(result.reference).toEqual({ width: 120, height: 80 });
    expect(result.candidate).toEqual({ width: 60, height: 40 });
    // Only the overlapping region is compared, never a stretched one.
    expect(result.comparedPixels).toBe(60 * 40);
  }, 60_000);

  it("treats a transparent pixel and an identically-coloured opaque one as different", async () => {
    const options = { width: 40, height: 40, deviceScaleFactor: 1 };
    const opaque = await renderHtmlToPng(
      browser,
      box("background:#000"),
      options,
    );
    const clear = await renderHtmlToPng(
      browser,
      box("background:transparent"),
      options,
    );
    const result = await comparePngs(browser, opaque.png, clear.png);
    expect(result.diffRatio).toBe(1);
  }, 60_000);
});

describe("renderers", () => {
  it("honours the requested device scale factor exactly", async () => {
    const at1 = await renderHtmlToPng(browser, box("background:#111"), {
      width: 100,
      height: 50,
      deviceScaleFactor: 1,
    });
    const at2 = await renderHtmlToPng(browser, box("background:#111"), {
      width: 100,
      height: 50,
      deviceScaleFactor: 2,
    });
    expect((await comparePngs(browser, at1.png, at1.png)).reference).toEqual({
      width: 100,
      height: 50,
    });
    expect((await comparePngs(browser, at2.png, at2.png)).reference).toEqual({
      width: 200,
      height: 100,
    });
  }, 60_000);

  it("warns about an asset it could not load rather than screenshotting the hole", async () => {
    const result = await renderHtmlToPng(
      browser,
      `<img src="https://127.0.0.1:1/missing.png">`,
      { width: 40, height: 40, deviceScaleFactor: 1, timeoutMs: 5_000 },
    );
    expect(
      result.warnings.some(
        (w) => w.startsWith("image failed") || w.startsWith("image timed out"),
      ),
    ).toBe(true);
  }, 60_000);

  it("raises when a rootSelector matches nothing instead of falling back to the viewport", async () => {
    // A silent viewport fallback would compare two different regions and score
    // the mismatch as a rendering difference.
    await expect(
      renderDocumentToPng(
        browser,
        `<!doctype html><body><main id="present"></main></body>`,
        {
          width: 50,
          height: 50,
          deviceScaleFactor: 1,
          rootSelector: "#absent",
        },
      ),
    ).rejects.toThrow(/rootSelector matched nothing/);
  }, 60_000);
});
