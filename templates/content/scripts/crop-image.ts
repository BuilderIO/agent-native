import fs from "fs";
import path from "path";
import sharp from "sharp";
import { parseArgs, camelCaseArgs, PROJECTS_DIR, fail } from "./_utils.js";

export default async function main(args: string[]) {
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: npm run script -- crop-image --image-path <path> --aspect-ratio 16:9

Options:
  --image-path      Path to image (relative to project media, or absolute)
  --project-slug    Project slug (e.g. steve/my-project)
  --aspect-ratio    Target aspect ratio (default: 16:9)
  --output          Output path (default: overwrite input)`);
    return;
  }

  const { imagePath, projectSlug, output } = opts;
  const aspectRatio = opts.aspectRatio || "16:9";

  if (!imagePath) fail("--image-path is required");

  // Resolve full path
  let fullPath: string;
  if (projectSlug) {
    fullPath = path.join(PROJECTS_DIR, projectSlug, "media", imagePath);
  } else {
    fullPath = path.resolve(imagePath);
  }

  if (!fs.existsSync(fullPath)) fail(`File not found: ${fullPath}`);

  // Parse aspect ratio
  const [rw, rh] = aspectRatio.split(":").map(Number);
  if (!rw || !rh) fail(`Invalid aspect ratio: ${aspectRatio}`);
  const targetRatio = rw / rh;

  const metadata = await sharp(fullPath).metadata();
  const origW = metadata.width!;
  const origH = metadata.height!;
  console.log(`Original: ${origW}x${origH}`);

  let cropW = origW;
  let cropH = Math.round(origW / targetRatio);
  if (cropH > origH) {
    cropH = origH;
    cropW = Math.round(origH * targetRatio);
  }

  const left = Math.round((origW - cropW) / 2);
  const top = Math.round((origH - cropH) / 2);
  console.log(`Cropping to: ${cropW}x${cropH} (${aspectRatio})`);

  const outputPath = output ? path.resolve(output) : fullPath;
  const tmpPath = outputPath + ".tmp";

  await sharp(fullPath)
    .extract({ left, top, width: cropW, height: cropH })
    .toFile(tmpPath);

  fs.renameSync(tmpPath, outputPath);
  console.log(`Saved: ${outputPath}`);
}
