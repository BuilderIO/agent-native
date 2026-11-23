import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { z } from "zod";

// Run: pnpm exec tsx templates/analytics-2/scripts/compare-key-screens.ts [manifest.json]
// The manifest's paths are relative to the manifest. Missing references are unverified.
const ids = ["S1", "S2", "S3", "S4", "S5"] as const;
const names = [
  "Home",
  "Data browser and connection picker",
  "Notebook with SQL result",
  "Question thread with chart",
  "Published dashboard",
];
const capture = z.object({
  image: z.string().min(1),
  styles: z.string().min(1),
  state: z.string().min(1),
  data: z.string().min(1),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    dpr: z.number().positive(),
  }),
  theme: z.string().min(1),
  provenance: z.string().min(1),
});
const entry = z
  .object({ original: capture.optional(), ours: capture.optional() })
  .strict();
const manifestSchema = z
  .object(Object.fromEntries(ids.map((id) => [id, entry.optional()])))
  .strict();
const scalar = z.union([z.string(), z.number().finite()]);
const stylesSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), scalar),
);
// Absolute tolerances: px for geometry and typography, unitless for opacity.
const tolerances: Record<string, number> = {
  x: 1,
  y: 1,
  width: 1,
  height: 1,
  fontSize: 1,
  lineHeight: 1,
  borderRadius: 1,
  borderWidth: 1,
  opacity: 0.01,
};

function compareImages(original: string, ours: string) {
  const script = `import json, sys
from PIL import Image
args = json.load(sys.stdin)
with Image.open(args[0]) as first, Image.open(args[1]) as second:
    if first.format != "PNG" or second.format != "PNG":
        raise ValueError("both images must be PNG")
    a, b = first.convert("RGBA"), second.convert("RGBA")
    if a.size != b.size:
        raise ValueError("image dimensions differ")
    changed = sum(x != y for x, y in zip(a.getdata(), b.getdata()))
    print(json.dumps({"width": a.width, "height": a.height, "changed": changed}))`;
  const result = spawnSync("python3", ["-c", script], {
    input: JSON.stringify([original, ours]),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `PNG comparison unavailable: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      changed: z.number().int().nonnegative(),
    })
    .parse(JSON.parse(result.stdout));
}
function readStyles(path: string) {
  const styles = stylesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (
    !Object.keys(styles).length ||
    Object.values(styles).some((properties) => !Object.keys(properties).length)
  )
    throw new Error(
      `${path}: styles must contain nonempty elements and properties`,
    );
  return styles;
}
function compareStyles(
  original: ReturnType<typeof readStyles>,
  ours: ReturnType<typeof readStyles>,
) {
  const keys = new Set([...Object.keys(original), ...Object.keys(ours)]);
  let matched = 0;
  for (const key of keys) {
    const a = original[key],
      b = ours[key];
    if (!a || !b) continue;
    const props = new Set([...Object.keys(a), ...Object.keys(b)]);
    if (
      [...props].every((prop) => {
        const x = a[prop],
          y = b[prop];
        return typeof x === "number" && typeof y === "number"
          ? Math.abs(x - y) <= (tolerances[prop] ?? 0)
          : x !== undefined && x === y;
      })
    )
      matched++;
  }
  return { matched, total: keys.size, percent: (matched * 100) / keys.size };
}
function compare(
  original: z.infer<typeof capture>,
  ours: z.infer<typeof capture>,
  base: string,
) {
  if (
    original.state !== ours.state ||
    original.data !== ours.data ||
    original.theme !== ours.theme ||
    JSON.stringify(original.viewport) !== JSON.stringify(ours.viewport)
  )
    throw new Error("state, data, viewport, DPR or theme differ");
  const originalPath = resolve(base, original.image),
    ourPath = resolve(base, ours.image);
  if (
    realpathSync(originalPath) === realpathSync(ourPath) ||
    original.provenance === ours.provenance
  )
    throw new Error(
      "original and our capture must have distinct paths and provenance",
    );
  const pixels = compareImages(originalPath, ourPath);
  const { width, height, dpr } = original.viewport;
  if (pixels.width !== width * dpr || pixels.height !== height * dpr)
    throw new Error("image dimensions do not match declared viewport/DPR");
  const pixelPercent = (pixels.changed * 100) / (pixels.width * pixels.height);
  const style = compareStyles(
    readStyles(resolve(base, original.styles)),
    readStyles(resolve(base, ours.styles)),
  );
  return {
    pixelPercent,
    changedPixels: pixels.changed,
    totalPixels: pixels.width * pixels.height,
    style,
    result: pixelPercent < 1 && style.percent >= 95 ? "PASS" : "FAIL",
  };
}
function main() {
  const arg = process.argv[2];
  if (arg === "--help") {
    console.log(
      `Usage: pnpm exec tsx templates/analytics-2/scripts/compare-key-screens.ts [manifest.json]\nManifest: {"S1":{"original":{"image":"...png","styles":"...json","state":"...","data":"...","viewport":{"width":800,"height":600,"dpr":1},"theme":"light","provenance":"..."},"ours":{...}}}; S2-S5 use the same shape. Style JSON maps stable element IDs to measured property/value maps. Numeric geometry, fontSize, lineHeight, borderRadius and borderWidth tolerate 1px; opacity 0.01; all other properties match exactly. Capture equivalent states and include every core element. No exclusions are applied. Strict per-pixel RGBA difference; no anti-alias tolerance. Missing captures, malformed data, identical paths or provenance and mismatched metadata never pass. Requires python3 with Pillow installed.`,
    );
    return;
  }
  if (process.argv.length > 3)
    throw new Error("Expected at most one manifest path");
  const base = arg ? dirname(resolve(arg)) : process.cwd();
  const manifest = manifestSchema.parse(
    arg ? JSON.parse(readFileSync(resolve(arg), "utf8")) : {},
  );
  let incomplete = false,
    failed = false;
  for (const [index, id] of ids.entries()) {
    const item = manifest[id];
    if (!item?.original) {
      console.log(
        JSON.stringify({
          id,
          screen: names[index],
          result: "UNVERIFIED",
          reason: "no original reference",
        }),
      );
      incomplete = true;
      continue;
    }
    if (!item.ours) {
      console.log(
        JSON.stringify({
          id,
          screen: names[index],
          result: "UNVERIFIED",
          reason: "no matching our capture",
        }),
      );
      incomplete = true;
      continue;
    }
    try {
      const result = compare(item.original, item.ours, base);
      console.log(JSON.stringify({ id, screen: names[index], ...result }));
      if (result.result === "FAIL") failed = true;
    } catch (error) {
      console.log(
        JSON.stringify({
          id,
          screen: names[index],
          result: "UNVERIFIED",
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      incomplete = true;
    }
  }
  process.exitCode = incomplete ? 2 : failed ? 1 : 0;
}
try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
