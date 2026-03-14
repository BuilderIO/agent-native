import { RequestHandler } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { uploadBufferToBuilderCDN } from "../utils/builder-upload";
import type {
  ImageGenRequest,
  ImageGenResponse,
  ImageGenStatusResponse,
  ImagePreset,
  ImagePresetsFile,
} from "../../shared/api";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");
const SHARED_DIR = path.join(process.cwd(), "content", "shared-resources");
const IMAGE_REFS_DIR = path.join(
  process.cwd(),
  "content",
  "shared-resources",
  "image-references",
);
const PRESETS_FILE = path.join(SHARED_DIR, "image-presets.json");
const MAX_REFS_PER_REQUEST = 5;

// --- Preset storage helpers ---

function readPresetsFile(): ImagePresetsFile {
  try {
    if (fs.existsSync(PRESETS_FILE)) {
      return JSON.parse(fs.readFileSync(PRESETS_FILE, "utf-8"));
    }
  } catch {}
  return { presets: [] };
}

function writePresetsFile(data: ImagePresetsFile): void {
  ensureDir(path.dirname(PRESETS_FILE));
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(data, null, 2));
}

export function getPresetByName(name: string): ImagePreset | undefined {
  const { presets } = readPresetsFile();
  return presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

export function getAllPresets(): ImagePreset[] {
  return readPresetsFile().presets;
}

/**
 * Resolve preset image paths. First checks named presets in the JSON store,
 * then falls back to folder-based lookup for backwards compatibility.
 */
export function getPresetImagePaths(presetName: string): string[] {
  // 1. Check named presets in JSON store
  const namedPreset = getPresetByName(presetName);
  if (namedPreset && namedPreset.paths.length > 0) {
    return namedPreset.paths;
  }

  // 2. Fallback: folder-based lookup
  const presetDir = path.join(IMAGE_REFS_DIR, presetName);
  if (!fs.existsSync(presetDir) || !fs.statSync(presetDir).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(presetDir)
    .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
    .map((f) => `image-references/${presetName}/${f}`);
}

interface ReferenceImage {
  data: string; // base64
  mimeType: string;
}

function sampleReferencePaths(paths: string[], count: number): string[] {
  if (count <= 0) return [];
  if (paths.length <= count) return [...paths];
  return [...paths].sort(() => Math.random() - 0.5).slice(0, count);
}

export function buildReferencePathSets(
  fixedPaths: string[],
  sampledPaths: string[],
  maxPerRequest: number,
  count: number,
): string[][] {
  const cappedFixedPaths = fixedPaths.slice(0, maxPerRequest);

  return Array.from({ length: count }, () => {
    const remainingSlots = Math.max(0, maxPerRequest - cappedFixedPaths.length);
    return [
      ...cappedFixedPaths,
      ...sampleReferencePaths(sampledPaths, remainingSlots),
    ];
  });
}

function detectMimeType(data: Buffer, filePath: string): string | null {
  const header = data.slice(0, 4).toString("hex");
  if (header.startsWith("ffd8")) return "image/jpeg";
  if (header === "89504e47") return "image/png";
  if (header.startsWith("52494646")) return "image/webp";
  if (header.startsWith("47494638")) return "image/gif";

  const ext = path.extname(filePath).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : null;
}

function readReferenceImageFile(filePath: string): ReferenceImage | null {
  try {
    const data = fs.readFileSync(filePath);
    const mimeType = detectMimeType(data, filePath);
    if (!mimeType) return null;
    return { data: data.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

function resolveAppMediaFilePath(referencePath: string): string | null {
  const candidate = referencePath.trim();
  if (!candidate) return null;

  try {
    const parsed =
      candidate.startsWith("http://") || candidate.startsWith("https://")
        ? new URL(candidate)
        : candidate.startsWith("/")
          ? new URL(candidate, "http://placeholder.local")
          : null;

    if (!parsed) return null;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const mediaIndex = segments.indexOf("media");
    if (
      segments[0] !== "api" ||
      segments[1] !== "projects" ||
      mediaIndex < 3 ||
      mediaIndex === segments.length - 1
    ) {
      return null;
    }

    const projectSlug = segments.slice(2, mediaIndex).join("/");
    const filename = decodeURIComponent(
      segments.slice(mediaIndex + 1).join("/"),
    );
    if (!isValidProjectPath(projectSlug) || !filename) return null;

    const fullPath = path.join(
      PROJECTS_DIR,
      projectSlug,
      "media",
      path.basename(filename),
    );
    return fs.existsSync(fullPath) ? fullPath : null;
  } catch {
    return null;
  }
}

function parseUploadedReferenceImages(
  uploadedReferenceImages: string[] = [],
): ReferenceImage[] {
  return uploadedReferenceImages.flatMap((dataUrl) => {
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    return match ? [{ data: match[2], mimeType: match[1] }] : [];
  });
}

export async function loadReferenceImages(
  paths: string[],
): Promise<ReferenceImage[]> {
  const images: ReferenceImage[] = [];

  for (const p of paths) {
    const candidate = p.trim();
    if (!candidate) continue;

    if (candidate.startsWith("blob:")) {
      console.warn(`Skipping browser-only reference image ${candidate}`);
      continue;
    }

    if (candidate.startsWith("data:image/")) {
      images.push(...parseUploadedReferenceImages([candidate]));
      continue;
    }

    const appMediaPath = resolveAppMediaFilePath(candidate);
    if (appMediaPath) {
      const image = readReferenceImageFile(appMediaPath);
      if (image) images.push(image);
      continue;
    }

    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      try {
        const res = await fetch(candidate);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          const mimeType = res.headers.get("content-type") || "image/png";
          images.push({ data: buffer.toString("base64"), mimeType });
        }
      } catch (e) {
        console.warn(`Failed to fetch remote reference image ${candidate}:`, e);
      }
      continue;
    }

    const normalized = path.posix.normalize(candidate);
    let fullPath = "";
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) {
        fullPath = candidate;
      } else {
        continue;
      }
    } else {
      const cwdPath = path.join(process.cwd(), normalized);
      if (fs.existsSync(cwdPath)) {
        fullPath = cwdPath;
      } else {
        fullPath = path.join(SHARED_DIR, normalized);
        if (!fs.existsSync(fullPath)) continue;
      }
    }

    const image = readReferenceImageFile(fullPath);
    if (image) images.push(image);
  }

  return images;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isValidProjectPath(project: string): boolean {
  if (!project) return false;
  const normalized = path.posix.normalize(project);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.includes("\0")) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  return segments.every((segment) => /^[a-z0-9][a-z0-9-]*$/.test(segment));
}

export async function generateWithOpenAI(
  prompt: string,
  size: string,
  referenceImages: ReferenceImage[] = [],
): Promise<{ imageData: Buffer; mimeType: string }> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (referenceImages.length > 0) {
    // Use images.edit endpoint for style transfer with reference images
    const refBuffers = referenceImages.slice(0, 4).map((ref) => {
      const buf = Buffer.from(ref.data, "base64");
      const file = new File(
        [buf],
        `ref.${ref.mimeType.split("/")[1] || "png"}`,
        {
          type: ref.mimeType,
        },
      );
      return file;
    });

    const response = await client.images.edit({
      model: "gpt-image-1",
      image: refBuffers,
      prompt: `Style reference images are provided above. Generate a NEW image matching their exact visual style.\n\n${prompt}`,
      size: size as "1024x1024" | "1536x1024" | "1024x1536",
    });

    const b64 = response.data[0]?.b64_json;
    if (b64) {
      return { imageData: Buffer.from(b64, "base64"), mimeType: "image/png" };
    }
    const imageUrl = response.data[0]?.url;
    if (!imageUrl) throw new Error("No image returned from OpenAI");
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Failed to download generated image");
    return {
      imageData: Buffer.from(await imgRes.arrayBuffer()),
      mimeType: "image/png",
    };
  }

  // No reference images — use standard generate
  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    n: 1,
    size: size as "1024x1024" | "1536x1024" | "1024x1536",
  });

  const b64 = response.data[0]?.b64_json;
  if (b64) {
    return { imageData: Buffer.from(b64, "base64"), mimeType: "image/png" };
  }

  const imageUrl = response.data[0]?.url;
  if (!imageUrl) {
    throw new Error("No image returned from OpenAI");
  }

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("Failed to download generated image");
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { imageData: buffer, mimeType: "image/png" };
}

export async function generateWithGemini(
  prompt: string,
  referenceImages: ReferenceImage[] = [],
  presetInstructions?: string,
): Promise<{ imageData: Buffer; mimeType: string }> {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Build contents with reference images + text prompt
  const contents: any[] = [];
  for (const ref of referenceImages.slice(0, 10)) {
    contents.push({
      inlineData: {
        mimeType: ref.mimeType,
        data: ref.data,
      },
    });
  }
  if (referenceImages.length > 0) {
    const presetSection = presetInstructions
      ? `\n\nPRESET-SPECIFIC INSTRUCTIONS (follow these strictly):\n${presetInstructions}`
      : "";

    contents.push({
      text: `You are a style-matching image generator. Your #1 priority is to REPLICATE the exact visual style of the ${referenceImages.length} reference images above.

CRITICAL: The reference images define STYLE ONLY — the colors, rendering technique, composition approach, and visual treatment. They do NOT define the subject matter or content of the image. The subject/content comes ONLY from the "Subject to depict" section below. Never copy objects, scenes, or topics from the reference images into the output.

STEP 1 — ANALYZE each reference image and identify the STYLE:
- Exact color palette (dominant colors, accent colors, background colors)
- The precise rendering technique used — do NOT categorize it with generic labels like "illustration" or "vector art." Instead, describe exactly what you see (e.g. "thin white line drawings on dark background with no fill," "photographic with color overlay," "3D rendered objects on gradient," etc.)
- Texture and grain (smooth, textured, noisy, clean)
- Line work style if present (weight, color, hand-drawn vs. precise, filled vs. outline-only)
- Composition patterns (centered, asymmetric, use of whitespace, overlapping elements)
- Typography/text treatment if present (font style, placement, color)
- Lighting style (flat, dramatic, gradient, ambient)
- Level of detail and complexity
- Any recurring visual motifs or design elements

STEP 2 — GENERATE a new image that applies the STYLE from the references to the SUBJECT described below. The output should look like it belongs in the same visual series as the references, but depict entirely different content.

STRICT RULES:
- ONLY reproduce the visual style you see in the references. Do NOT interpret or extrapolate the style into something different. If the references show thin white line drawings, output thin white line drawings — not cartoon illustrations, not filled vector art, not watercolor sketches.
- The visual style, color palette, and rendering technique of the references OVERRIDE any defaults. Do NOT fall back to generic stock imagery or photorealism unless the references are clearly photorealistic.
- If the references use a specific limited color palette, your output MUST use those same colors.
- Do NOT add elements, textures, fills, or styles not present in the references.
- Match the same level of visual complexity — if references are minimal, stay minimal.
- When in doubt, be MORE literal in copying the reference style, not less.
- LOGOS: Never invent or approximate logos for real products or companies. If a logo is requested (e.g. Claude, GitHub, VS Code), use the ACTUAL recognizable logo mark — not a made-up letter or symbol. If you cannot reproduce the exact logo, use the product's commonly recognized ASCII/text representation instead. For example: Claude/Anthropic uses an orange starburst/exploding-lines logo mark. Never substitute a generic letter "C" or made-up icon.${presetSection}

Subject to depict: ${prompt}`,
    });
  } else {
    contents.push({ text: prompt });
  }

  const geminiModels = [
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
  ];
  let lastError: Error | null = null;

  const isOverloadError = (e: any) =>
    e.status === 429 ||
    e.status === 503 ||
    e.message?.includes("overloaded") ||
    e.message?.includes("503") ||
    e.message?.includes("429") ||
    e.message?.includes("high demand") ||
    e.message?.includes("RESOURCE_EXHAUSTED") ||
    e.message?.includes("UNAVAILABLE");

  for (const modelName of geminiModels) {
    // Retry each model up to 3 times with increasing delays
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          const delay = attempt * 3000; // 3s, 6s
          console.log(
            `[Gemini] Retry ${attempt} for ${modelName} after ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
        console.log(
          `[Gemini] Trying model: ${modelName} (attempt ${attempt + 1})`,
        );
        const response = await client.models.generateContent({
          model: modelName,
          contents,
          config: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData) {
            const buffer = Buffer.from(part.inlineData.data!, "base64");
            console.log(
              `[Gemini] Success with ${modelName} on attempt ${attempt + 1}`,
            );
            return {
              imageData: buffer,
              mimeType: part.inlineData.mimeType || "image/png",
            };
          }
        }
        lastError = new Error(`No image returned from ${modelName}`);
        break; // Got a response but no image — move to next model
      } catch (e: any) {
        console.warn(
          `[Gemini] ${modelName} attempt ${attempt + 1} failed: ${e.message}`,
        );
        lastError = e;
        if (isOverloadError(e)) {
          continue; // retry same model
        }
        // Non-overload error — don't retry this model, try next one
        break;
      }
    }
    // All retries exhausted for this model, try next
    console.log(
      `[Gemini] All retries exhausted for ${modelName}, trying fallback...`,
    );
  }

  throw lastError || new Error("No image returned from Gemini");
}

export async function generateWithFlux(
  prompt: string,
  referenceImages: ReferenceImage[] = [],
): Promise<{ imageData: Buffer; mimeType: string }> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error("fal.ai API key not configured");

  const body: any = { prompt };

  if (referenceImages.length > 0) {
    const ref = referenceImages[0];
    body.image_url = `data:${ref.mimeType};base64,${ref.data}`;
  }

  const authHeader = `Key ${falKey}`;

  // Step 1: Submit to queue
  console.log("[Flux] Submitting to queue...");
  const submitRes = await fetch(
    "https://queue.fal.run/fal-ai/flux-pro/kontext",
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    console.error("[Flux] Submit failed:", submitRes.status, errText);
    throw new Error(`Flux API submit error (${submitRes.status}): ${errText}`);
  }

  const submitData = await submitRes.json();
  console.log(
    "[Flux] Submit response:",
    JSON.stringify(submitData).slice(0, 200),
  );

  const requestId = submitData.request_id;
  if (!requestId) {
    // Synchronous response
    const imageUrl = submitData.images?.[0]?.url;
    if (!imageUrl) {
      console.error(
        "[Flux] No request_id and no image URL. Full response:",
        JSON.stringify(submitData),
      );
      throw new Error("Unexpected Flux response: no request_id or image");
    }
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error("Failed to download Flux image");
    return {
      imageData: Buffer.from(await imgRes.arrayBuffer()),
      mimeType: "image/png",
    };
  }

  // Step 2: Poll for completion
  const statusUrl =
    submitData.status_url ||
    `https://queue.fal.run/fal-ai/flux-pro/kontext/requests/${requestId}/status`;
  const responseUrl =
    submitData.response_url ||
    `https://queue.fal.run/fal-ai/flux-pro/kontext/requests/${requestId}`;

  console.log("[Flux] Polling status at:", statusUrl);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const statusRes = await fetch(statusUrl, {
        headers: { Authorization: authHeader },
      });
      if (!statusRes.ok) {
        console.warn(`[Flux] Status poll ${i} failed:`, statusRes.status);
        continue;
      }
      const statusData = await statusRes.json();
      console.log(`[Flux] Poll ${i}:`, statusData.status);

      if (statusData.status === "COMPLETED") break;
      if (statusData.status === "FAILED") {
        console.error("[Flux] Generation failed:", JSON.stringify(statusData));
        throw new Error("Flux generation failed");
      }
    } catch (e: any) {
      if (e.message === "Flux generation failed") throw e;
      console.warn(`[Flux] Poll ${i} error:`, e.message);
    }
  }

  // Step 3: Fetch result
  console.log("[Flux] Fetching result from:", responseUrl);
  const resultRes = await fetch(responseUrl, {
    headers: { Authorization: authHeader },
  });

  if (!resultRes.ok) {
    const errText = await resultRes.text();
    console.error("[Flux] Result fetch failed:", resultRes.status, errText);
    throw new Error(
      `Failed to fetch Flux result (${resultRes.status}): ${errText}`,
    );
  }

  const resultData = await resultRes.json();
  console.log("[Flux] Result keys:", Object.keys(resultData));

  const imageUrl = resultData.images?.[0]?.url;
  if (!imageUrl) {
    console.error(
      "[Flux] No image in result:",
      JSON.stringify(resultData).slice(0, 500),
    );
    throw new Error("No image URL in Flux result");
  }

  console.log("[Flux] Downloading image from:", imageUrl.slice(0, 80));
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("Failed to download Flux image");
  return {
    imageData: Buffer.from(await imgRes.arrayBuffer()),
    mimeType: "image/png",
  };
}

export const generateImage: RequestHandler = async (req, res) => {
  const body = req.body as ImageGenRequest;
  const {
    prompt,
    model,
    size = "1024x1024",
    projectSlug,
    preset,
    referenceImagePaths,
    uploadedReferenceImages,
  } = body;

  if (!prompt?.trim()) {
    res.status(400).json({ error: "Prompt is required" });
    return;
  }

  if (model === "openai" && !process.env.OPENAI_API_KEY) {
    res.status(400).json({ error: "OpenAI API key not configured" });
    return;
  }
  if (model === "gemini" && !process.env.GEMINI_API_KEY) {
    res.status(400).json({ error: "Gemini API key not configured" });
    return;
  }
  if (model === "flux" && !process.env.FAL_KEY) {
    res.status(400).json({ error: "fal.ai API key not configured" });
    return;
  }

  try {
    let result: { imageData: Buffer; mimeType: string };

    // Keep user-provided/source references fixed in every request, then sample preset refs around them.
    const fixedReferencePaths = referenceImagePaths || [];
    const presetPaths = preset ? getPresetImagePaths(preset) : [];
    if (preset && !presetPaths.length) {
      res
        .status(400)
        .json({ error: `Preset '${preset}' not found or contains no images.` });
      return;
    }

    const inlineReferenceImages = parseUploadedReferenceImages(
      uploadedReferenceImages,
    );
    const availablePathSlots = Math.max(
      0,
      MAX_REFS_PER_REQUEST - inlineReferenceImages.length,
    );
    const [selectedPaths] = buildReferencePathSets(
      fixedReferencePaths,
      presetPaths,
      availablePathSlots,
      1,
    );
    const refImages = selectedPaths.length
      ? await loadReferenceImages(selectedPaths)
      : [];

    if (inlineReferenceImages.length > 0) {
      const remainingInlineSlots = Math.max(
        0,
        MAX_REFS_PER_REQUEST - refImages.length,
      );
      refImages.push(...inlineReferenceImages.slice(0, remainingInlineSlots));
    }

    if (model === "openai") {
      result = await generateWithOpenAI(prompt, size, refImages);
    } else if (model === "gemini") {
      // Resolve preset instructions if available
      let presetInstructions: string | undefined;
      if (preset) {
        const presetObj = getPresetByName(preset);
        if (presetObj?.instructions)
          presetInstructions = presetObj.instructions;
      }
      result = await generateWithGemini(prompt, refImages, presetInstructions);
    } else if (model === "flux") {
      result = await generateWithFlux(prompt, refImages);
    } else {
      res.status(400).json({ error: "Invalid model" });
      return;
    }

    // Save to project media if projectSlug provided
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

    // Return as data URL if not saved, or the saved path
    const dataUrl = `data:${result.mimeType};base64,${result.imageData.toString("base64")}`;

    const response: ImageGenResponse = {
      url: savedPath || dataUrl,
      model,
      prompt,
      savedPath,
    };

    res.json(response);
  } catch (err: any) {
    console.error("Image generation error:", err);
    res.status(500).json({ error: err.message || "Image generation failed" });
  }
};

export const getImageGenStatus: RequestHandler = (_req, res) => {
  const response: ImageGenStatusResponse = {
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    flux: !!process.env.FAL_KEY,
  };
  res.json(response);
};

// --- Preset CRUD endpoints ---

export const listPresets: RequestHandler = (_req, res) => {
  res.json(readPresetsFile());
};

export const createPreset: RequestHandler = (req, res) => {
  const { name, paths } = req.body;
  if (!name?.trim() || !Array.isArray(paths) || paths.length === 0) {
    res.status(400).json({ error: "Name and paths are required" });
    return;
  }
  const data = readPresetsFile();
  const newPreset: ImagePreset = {
    id: Date.now().toString(),
    name: name.trim(),
    paths,
    createdAt: Date.now(),
  };
  data.presets.push(newPreset);
  writePresetsFile(data);
  res.json(newPreset);
};

export const updatePresetHandler: RequestHandler = (req, res) => {
  const { id } = req.params;
  const updates = req.body as Partial<
    Pick<ImagePreset, "name" | "paths" | "instructions">
  >;
  const data = readPresetsFile();
  const idx = data.presets.findIndex((p) => p.id === id);
  if (idx === -1) {
    res.status(404).json({ error: "Preset not found" });
    return;
  }
  if (updates.name) data.presets[idx].name = updates.name.trim();
  if (updates.paths) data.presets[idx].paths = updates.paths;
  if (updates.instructions !== undefined)
    data.presets[idx].instructions = updates.instructions || undefined;
  writePresetsFile(data);
  res.json(data.presets[idx]);
};

export const deletePresetHandler: RequestHandler = (req, res) => {
  const { id } = req.params;
  const data = readPresetsFile();
  const idx = data.presets.findIndex((p) => p.id === id);
  if (idx === -1) {
    res.status(404).json({ error: "Preset not found" });
    return;
  }
  data.presets.splice(idx, 1);
  writePresetsFile(data);
  res.json({ success: true });
};

export const configureImageGen: RequestHandler = (req, res) => {
  const { provider, apiKey } = req.body;

  if (!provider || !apiKey) {
    res.status(400).json({ error: "Provider and API key are required" });
    return;
  }

  if (provider === "openai") {
    process.env.OPENAI_API_KEY = apiKey;
  } else if (provider === "gemini") {
    process.env.GEMINI_API_KEY = apiKey;
  } else if (provider === "flux") {
    process.env.FAL_KEY = apiKey;
  } else {
    res.status(400).json({ error: "Invalid provider" });
    return;
  }

  res.json({ success: true, provider });
};
