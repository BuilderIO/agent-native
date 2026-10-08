import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { resolvePnpmEntry } from "./resolve-pkg.ts";

const pixelmatchMod: any = await import(resolvePnpmEntry("pixelmatch", "7.2"));
const pixelmatch: any = pixelmatchMod.default;
const pngjsMod: any = await import(resolvePnpmEntry("pngjs", "7."));
const PNG: any = pngjsMod.PNG ?? pngjsMod.default?.PNG;

const LAYOUT_WIDTH = 400;
const LAYOUT_HEIGHT = 225;

function parseArgs(argv: string[]) {
  const outIndex = argv.indexOf("--out");
  if (outIndex === -1 || !argv[outIndex + 1] || !argv[0] || !argv[1]) {
    throw new Error("Usage: diff.ts <refDir> <candDir> --out <dir>");
  }
  return {
    refDir: path.resolve(argv[0]),
    candDir: path.resolve(argv[1]),
    outDir: path.resolve(argv[outIndex + 1]),
  };
}

function loadPng(file: string) {
  return PNG.sync.read(readFileSync(file));
}

function magick(args: string[]) {
  execFileSync("magick", args, { stdio: ["ignore", "ignore", "inherit"] });
}

function ensureSize(
  inputPath: string,
  width: number,
  height: number,
  outPath: string,
): string {
  const img = loadPng(inputPath);
  if (img.width === width && img.height === height) return inputPath;
  magick([inputPath, "-resize", `${width}x${height}!`, outPath]);
  return outPath;
}

interface Row {
  slide: string;
  width?: number;
  height?: number;
  mismatchedPixels?: number;
  pixelRatio?: number;
  layoutMismatchedPixels?: number;
  layoutRatio?: number;
  error?: string;
}

async function main() {
  const { refDir, candDir, outDir } = parseArgs(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });
  const workDir = path.join(outDir, "_work");
  mkdirSync(workDir, { recursive: true });

  const refFiles = readdirSync(refDir)
    .filter((f) => /^slide-\d+\.png$/.test(f))
    .sort();
  if (refFiles.length === 0) {
    throw new Error(`No slide-NN.png files found in ${refDir}`);
  }

  const rows: Row[] = [];
  for (const fname of readdirSync(candDir)
    .filter((f) => /^slide-\d+\.png$/.test(f))
    .sort()) {
    if (!refFiles.includes(fname)) {
      rows.push({
        slide: fname.replace(/\.png$/, ""),
        error: "unexpected candidate",
      });
    }
  }
  for (const fname of refFiles) {
    const slide = fname.replace(/\.png$/, "");
    const refPath = path.join(refDir, fname);
    const candSrcPath = path.join(candDir, fname);
    if (!existsSync(candSrcPath)) {
      rows.push({ slide, error: "missing candidate" });
      continue;
    }

    const refImg = loadPng(refPath);
    const { width, height } = refImg;
    const candResizedPath = ensureSize(
      candSrcPath,
      width,
      height,
      path.join(workDir, `${slide}-cand-resized.png`),
    );
    const candImg = loadPng(candResizedPath);

    const diffImg = new PNG({ width, height });
    const mismatchedPixels = pixelmatch(
      refImg.data,
      candImg.data,
      diffImg.data,
      width,
      height,
      {
        threshold: 0.1,
        includeAA: false,
      },
    );
    const pixelRatio = mismatchedPixels / (width * height);
    const diffPath = path.join(workDir, `${slide}-diff.png`);
    writeFileSync(diffPath, PNG.sync.write(diffImg));

    const refLayoutPath = path.join(workDir, `${slide}-ref-layout.png`);
    const candLayoutPath = path.join(workDir, `${slide}-cand-layout.png`);
    magick([
      refPath,
      "-resize",
      `${LAYOUT_WIDTH}x${LAYOUT_HEIGHT}!`,
      "-blur",
      "0x2",
      refLayoutPath,
    ]);
    magick([
      candResizedPath,
      "-resize",
      `${LAYOUT_WIDTH}x${LAYOUT_HEIGHT}!`,
      "-blur",
      "0x2",
      candLayoutPath,
    ]);
    const refLayoutImg = loadPng(refLayoutPath);
    const candLayoutImg = loadPng(candLayoutPath);
    const layoutMismatchedPixels = pixelmatch(
      refLayoutImg.data,
      candLayoutImg.data,
      null,
      LAYOUT_WIDTH,
      LAYOUT_HEIGHT,
      { threshold: 0.15, includeAA: false },
    );
    const layoutRatio = layoutMismatchedPixels / (LAYOUT_WIDTH * LAYOUT_HEIGHT);

    const comparePath = path.join(outDir, `${slide}-compare.png`);
    magick([
      refPath,
      candResizedPath,
      diffPath,
      "-bordercolor",
      // guard:allow-raw-color — separator between tiles in a generated PNG, not themed UI
      "#808080",
      "-border",
      "4x0",
      "+append",
      comparePath,
    ]);

    rows.push({
      slide,
      width,
      height,
      mismatchedPixels,
      pixelRatio: Number(pixelRatio.toFixed(6)),
      layoutMismatchedPixels,
      layoutRatio: Number(layoutRatio.toFixed(6)),
    });
  }

  const numericRows = rows.filter((r) => r.pixelRatio !== undefined);
  const summary = {
    slideCount: rows.length,
    maxPixelRatio: numericRows.length
      ? Math.max(...numericRows.map((r) => r.pixelRatio!))
      : null,
    maxLayoutRatio: numericRows.length
      ? Math.max(...numericRows.map((r) => r.layoutRatio!))
      : null,
    missing: rows.filter((r) => r.error).map((r) => r.slide),
  };

  writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(
      { refDir, candDir, generatedAt: new Date().toISOString(), summary, rows },
      null,
      2,
    ),
  );

  console.table(
    rows.map((r) => ({
      slide: r.slide,
      pixelRatio: r.pixelRatio ?? "-",
      layoutRatio: r.layoutRatio ?? "-",
      mismatched: r.mismatchedPixels ?? "-",
      error: r.error ?? "",
    })),
  );
  console.log(
    `[diff] max pixelRatio=${summary.maxPixelRatio} max layoutRatio=${summary.maxLayoutRatio}`,
  );
  if (summary.missing.length) {
    console.error(
      `[diff] FAILED: ${summary.missing.length} slide(s) with no usable pair: ${summary.missing.join(", ")}`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[diff] FAILED:", err);
  process.exit(1);
});
