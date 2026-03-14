import fs from "fs";
import path from "path";
import crypto from "crypto";
import { uploadBufferToBuilderCDN } from "../server/utils/builder-upload.js";
import {
  generateWithOpenAI,
  generateWithGemini,
  generateWithFlux,
  loadReferenceImages,
  getPresetImagePaths,
  getPresetByName,
  buildReferencePathSets,
} from "../server/routes/image-gen.js";
import {
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidProjectPath,
  ensureDir,
  PROJECTS_DIR,
  fail,
} from "./_utils.js";

const DEFAULT_COUNT = 3;
const MAX_REFS_PER_REQUEST = 5;

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script generate-image --prompt "..." --model gemini [options]

Options:
  --prompt              Text prompt describing the image (required)
  --model               AI model: openai, gemini, or flux (required)
  --size                Image size, e.g. 1024x1024 (OpenAI only)
  --project-slug        Project to save images to (e.g. steve/my-project)
  --preset              Image preset name for style references
  --reference-image-paths  Comma-separated paths to reference images
  --count               Number of variations (default: 3)`);
    return;
  }

  const { prompt, model, size, projectSlug, preset, count: countStr } = opts;
  const fixedReferencePaths = opts.referenceImagePaths
    ? opts.referenceImagePaths
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];

  if (!prompt) fail("--prompt is required");
  if (!model) fail("--model is required (openai, gemini, or flux)");
  if (!["openai", "gemini", "flux"].includes(model))
    fail("--model must be openai, gemini, or flux");

  const imageCount = countStr ? parseInt(countStr, 10) : DEFAULT_COUNT;

  // Validate API keys
  if (model === "openai" && !process.env.OPENAI_API_KEY)
    fail("OPENAI_API_KEY not set");
  if (model === "gemini" && !process.env.GEMINI_API_KEY)
    fail("GEMINI_API_KEY not set");
  if (model === "flux" && !process.env.FAL_KEY) fail("FAL_KEY not set");

  // Keep source/manual references fixed in every variation, then sample preset refs around them.
  const presetPaths = preset ? getPresetImagePaths(preset) : [];
  let presetInstructions: string | undefined;
  if (preset) {
    if (!presetPaths.length)
      fail(
        `Preset '${preset}' not found or empty. Run: pnpm script list-image-presets`,
      );
    const presetObj = getPresetByName(preset);
    if (presetObj?.instructions) presetInstructions = presetObj.instructions;
  }

  const refSubsets = buildReferencePathSets(
    fixedReferencePaths,
    presetPaths,
    MAX_REFS_PER_REQUEST,
    imageCount,
  );

  const generateOne = async (refPaths: string[], idx: number) => {
    console.log(
      `[Image ${idx + 1}] Loading ${refPaths.length} reference image paths...`,
    );
    const refImages = refPaths.length
      ? await loadReferenceImages(refPaths)
      : [];
    console.log(
      `[Image ${idx + 1}] Loaded ${refImages.length}/${refPaths.length} reference images (${refImages.map((r) => `${Math.round(r.data.length / 1024)}KB ${r.mimeType}`).join(", ")})`,
    );
    let result: { imageData: Buffer; mimeType: string };

    if (model === "openai") {
      result = await generateWithOpenAI(prompt, size || "1024x1024", refImages);
    } else if (model === "gemini") {
      result = await generateWithGemini(prompt, refImages, presetInstructions);
    } else {
      result = await generateWithFlux(prompt, refImages);
    }

    let savedPath: string | undefined;
    if (projectSlug && isValidProjectPath(projectSlug)) {
      const mediaDir = path.join(PROJECTS_DIR, projectSlug, "media");
      ensureDir(mediaDir);
      const ext =
        result.mimeType === "image/jpeg"
          ? ".jpg"
          : result.mimeType === "image/webp"
            ? ".webp"
            : ".png";
      const filename = `gen-${crypto.randomBytes(6).toString("hex")}${ext}`;

      const cdnUrl = await uploadBufferToBuilderCDN(
        filename,
        result.imageData,
        result.mimeType,
      );

      const metadataPath = path.join(mediaDir, `${filename}.json`);
      const metadata = {
        filename,
        url: cdnUrl,
        type: "image",
        size: result.imageData.length,
        mimeType: result.mimeType,
        modifiedAt: Date.now(),
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      savedPath = cdnUrl;
    }
    return { savedPath };
  };

  console.log(`Generating ${imageCount} image(s) with ${model}...`);
  console.log(`Prompt: ${prompt}`);
  if (preset)
    console.log(
      `Preset: ${preset} (${presetPaths.length} style reference images, ${fixedReferencePaths.length} fixed reference images)`,
    );
  else if (fixedReferencePaths.length > 0)
    console.log(`Reference images: ${fixedReferencePaths.length}`);
  else console.warn(`Warning: No reference images — output may look generic`);

  const results = await Promise.allSettled(
    refSubsets.map((refs, i) => generateOne(refs, i)),
  );

  const succeeded: { savedPath?: string }[] = [];
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") {
      succeeded.push(r.value);
    } else {
      errors.push(r.reason?.message || "Unknown error");
    }
  }

  if (succeeded.length === 0) {
    fail(`All ${imageCount} generations failed:\n${errors.join("\n")}`);
  }

  console.log(
    `\nGenerated ${succeeded.length}/${imageCount} images successfully.`,
  );

  const savedPaths = succeeded
    .filter((s) => s.savedPath)
    .map((s) => s.savedPath);
  if (savedPaths.length) {
    console.log(`\nSaved paths:`);
    savedPaths.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  }

  if (errors.length) {
    console.error(
      `\n${errors.length} generation(s) failed: ${errors.join("; ")}`,
    );
  }
}
