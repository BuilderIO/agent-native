import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { chromium } from "playwright";

import {
  cropImageRegion,
  compareRasterImages,
} from "../../core/src/ingestion/media.js";
import { compileGoogleSlidesPresentation } from "../src/connectors/google-slides-native.js";

const outputDir =
  "/Users/steve/.codex/visualizations/2026/07/16/019f6b50-4f11-7973-bd24-97660fa817a1/creative-context";
const input = JSON.parse(
  readFileSync(path.join(outputDir, "real-presentations-sampled.json"), "utf8"),
) as {
  decks: Array<Record<string, any>>;
};
const sourceNames: Record<string, string> = {
  "16TMzYwY_FqA5jvvyyQ8iP3LAzCpxk4P6RdqF7WjF3MI:g3c610143880_0_270":
    "amazon-slide-01-source.png",
  "16TMzYwY_FqA5jvvyyQ8iP3LAzCpxk4P6RdqF7WjF3MI:g3f8229ef0ef_0_624":
    "amazon-slide-07-source.png",
  "1QRmYWBI2UUP3RWQ1NeJDfTfev66zeI93KYzKiEOwuPk:g3c610143880_0_270":
    "ceo-slide-01-source.png",
  "1QRmYWBI2UUP3RWQ1NeJDfTfev66zeI93KYzKiEOwuPk:g3f7c70b8845_3_0":
    "ceo-slide-33-source.png",
};
const labels: Record<string, string> = {
  "16TMzYwY_FqA5jvvyyQ8iP3LAzCpxk4P6RdqF7WjF3MI:g3c610143880_0_270":
    "Amazon - Agent-Native · slide 1",
  "16TMzYwY_FqA5jvvyyQ8iP3LAzCpxk4P6RdqF7WjF3MI:g3f8229ef0ef_0_624":
    "Amazon - Agent-Native · slide 7",
  "1QRmYWBI2UUP3RWQ1NeJDfTfev66zeI93KYzKiEOwuPk:g3c610143880_0_270":
    "CEO Update - Agent-Native · slide 1",
  "1QRmYWBI2UUP3RWQ1NeJDfTfev66zeI93KYzKiEOwuPk:g3f7c70b8845_3_0":
    "CEO Update - Agent-Native · slide 33",
};

const requireFromCore = createRequire(
  new URL("../../core/package.json", import.meta.url),
);
const sharp = requireFromCore("sharp") as typeof import("sharp");
const browser = await chromium.launch({ headless: true });
const metrics: Array<Record<string, unknown>> = [];

try {
  for (const deck of input.decks) {
    const pageWidth = Number(deck.pageSize.width.magnitude) / 9525;
    const pageHeight = Number(deck.pageSize.height.magnitude) / 9525;
    const compiled = await compileGoogleSlidesPresentation(deck, {
      presentationId: deck.presentationId,
      revisionId: deck.revisionId,
      resolveAsset: async (request) => ({
        id: `asset-${request.elementObjectId}`,
        kind: "image" as const,
        mimeType: "image/png",
        accessMode: "private" as const,
        storageKey: `qa:${request.elementObjectId}`,
        contentHash: `qa-${request.elementObjectId}`,
        url: request.sourceUrl,
      }),
      resolveFallback: async (request) => {
        const key = `${deck.presentationId}:${request.slideObjectId}`;
        const sourceName = sourceNames[key];
        if (!sourceName) return null;
        const source = readFileSync(path.join(outputDir, sourceName));
        const left = Math.max(
          0,
          Math.floor((request.bounds.x / pageWidth) * 1600),
        );
        const top = Math.max(
          0,
          Math.floor((request.bounds.y / pageHeight) * 900),
        );
        const width = Math.max(
          1,
          Math.min(
            1600 - left,
            Math.ceil((request.bounds.width / pageWidth) * 1600),
          ),
        );
        const height = Math.max(
          1,
          Math.min(
            900 - top,
            Math.ceil((request.bounds.height / pageHeight) * 900),
          ),
        );
        const cropped = await cropImageRegion({
          data: source,
          left,
          top,
          width,
          height,
        });
        const fallbackName = `${key.replaceAll(":", "-")}-${request.elementObjectId}-fallback.png`;
        writeFileSync(path.join(outputDir, fallbackName), cropped.data);
        return {
          id: `fallback-${request.elementObjectId}`,
          kind: "image" as const,
          mimeType: "image/png" as const,
          accessMode: "private" as const,
          storageKey: `qa-fallback:${request.elementObjectId}`,
          contentHash: `qa-fallback-${request.elementObjectId}`,
          width: cropped.width,
          height: cropped.height,
          url: `file://${path.join(outputDir, fallbackName)}`,
        };
      },
    });

    for (const slide of compiled) {
      const key = `${deck.presentationId}:${slide.objectId}`;
      const stem = sourceNames[key]!.replace("-source.png", "");
      const htmlName = `${stem}-compiled.html`;
      const pngName = `${stem}-compiled.png`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1600px;height:900px;overflow:hidden;background:#111}.stage{width:1600px;height:900px;overflow:hidden}.stage>.fmd-slide{transform:scale(1.666666667);transform-origin:0 0}</style></head><body><div class="stage">${slide.html}</div></body></html>`;
      writeFileSync(path.join(outputDir, htmlName), html);
      const page = await browser.newPage({
        viewport: { width: 1600, height: 900 },
      });
      await page.goto(`file://${path.join(outputDir, htmlName)}`, {
        waitUntil: "networkidle",
        timeout: 120_000,
      });
      await page.screenshot({ path: path.join(outputDir, pngName) });
      await page.close();

      const source = await sharp(
        readFileSync(path.join(outputDir, sourceNames[key]!)),
      )
        .removeAlpha()
        .png()
        .toBuffer();
      const rendered = await sharp(readFileSync(path.join(outputDir, pngName)))
        .removeAlpha()
        .png()
        .toBuffer();
      const delta = await compareRasterImages({ source, rendered });
      metrics.push({
        key,
        label: labels[key],
        source: sourceNames[key],
        rendered: pngName,
        meanAbsoluteDifference: delta.meanAbsoluteDifference,
        normalizedDifference: delta.meanAbsoluteDifference / 255,
        fidelityReport: slide.nativeArtifact.fidelityReport,
        mediaCount: slide.media.length,
        htmlBytes: Buffer.byteLength(slide.html),
      });
    }
  }

  const rows = metrics
    .map(
      (metric) =>
        `<section><h2>${metric.label}</h2><div class="pair"><figure><figcaption>Google Slides LARGE thumbnail</figcaption><img src="${metric.source}"></figure><figure><figcaption>Compiled native HTML</figcaption><img src="${metric.rendered}"></figure></div><p>Mean absolute pixel delta: ${Number(metric.meanAbsoluteDifference).toFixed(2)} / 255 (${(Number(metric.normalizedDifference) * 100).toFixed(1)}%)</p></section>`,
    )
    .join("");
  const montageHtml = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#101114;color:#fff;font-family:Inter,system-ui;padding:36px}h1{font-size:34px;margin:0 0 30px}section{margin:0 0 42px;padding:24px;background:#191b20;border:1px solid #343740;border-radius:18px}h2{margin:0 0 18px;font-size:25px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}figcaption{font-size:16px;color:#aeb4c0;margin:0 0 10px}img{display:block;width:100%;border:1px solid #3f424b}p{font-size:16px;color:#c8ccd5;margin:14px 0 0}</style></head><body><h1>Real Google Slides → native HTML fidelity</h1>${rows}</body></html>`;
  writeFileSync(
    path.join(outputDir, "real-slides-fidelity-montage.html"),
    montageHtml,
  );
  const montage = await browser.newPage({
    viewport: { width: 1800, height: 1200 },
  });
  await montage.goto(
    `file://${path.join(outputDir, "real-slides-fidelity-montage.html")}`,
    { waitUntil: "networkidle" },
  );
  await montage.screenshot({
    path: path.join(outputDir, "real-slides-fidelity-montage.png"),
    fullPage: true,
  });
  await montage.close();
  writeFileSync(
    path.join(outputDir, "real-slides-fidelity-metrics.json"),
    JSON.stringify(metrics, null, 2),
  );
  console.log(`REAL_SLIDES_QA=${JSON.stringify(metrics)}`);
} finally {
  await browser.close();
}
