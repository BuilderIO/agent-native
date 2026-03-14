import { parseArgs, loadEnv, fail } from "@agent-native/core";
import fs from "fs";
import path from "path";
import type { GenerationRecord, StyleProfile } from "@shared/types.js";

const BRAND_DIR = path.join(process.cwd(), "data", "brand");
const REFS_DIR = path.join(BRAND_DIR, "references");
const GENERATIONS_DIR = path.join(process.cwd(), "data", "generations");
const PROFILE_PATH = path.join(BRAND_DIR, "style-profile.json");

const MODELS = ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"];
const MAX_RETRIES = 3;
const CONCURRENCY_LIMIT = 4;

export default async function main(args: string[]) {
  loadEnv();

  const opts = parseArgs(args);
  const prompt = opts.prompt;
  if (!prompt) fail("--prompt is required");

  const variations = parseInt(opts.variations || "4", 10);
  const model = opts.model || "gemini-3-pro-image-preview";
  const referenceFilter = opts.references?.split(",") ?? null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) fail("GEMINI_API_KEY is required. Add it to your .env file.");

  // Load style profile
  let styleDescription = "";
  if (fs.existsSync(PROFILE_PATH)) {
    const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf-8")) as StyleProfile;
    if (profile.styleDescription) {
      styleDescription = `STYLE GUIDE:\n${profile.styleDescription}\n\nStyle attributes:\n` +
        Object.entries(profile.attributes || {})
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n");
    }
  }

  // Load reference images
  const refFiles = fs.existsSync(REFS_DIR)
    ? fs.readdirSync(REFS_DIR).filter((f) => !f.startsWith("."))
    : [];
  const selectedRefs = referenceFilter
    ? refFiles.filter((f) => referenceFilter.includes(f))
    : refFiles.slice(0, 5); // Default: first 5

  const refParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const file of selectedRefs) {
    const filePath = path.join(REFS_DIR, file);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(file).toLowerCase();
    const mimeType =
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" : "image/png";
    refParts.push({ inlineData: { mimeType, data: data.toString("base64") } });
  }

  // Build prompt
  const fullPrompt = [
    selectedRefs.length > 0
      ? `You are a style-matching image generator. Your #1 priority is to REPLICATE the exact visual style of the ${selectedRefs.length} reference images above.`
      : "",
    styleDescription,
    selectedRefs.length > 0
      ? `\nSTRICT RULES:\n- ONLY reproduce the visual style from references\n- Match color palette, texture, composition, lighting exactly\n- Apply the style to the subject below\n`
      : "",
    `\nSubject to depict: ${prompt}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  console.log(`Generating ${variations} variation(s) with model ${model}...`);
  console.log(`Using ${selectedRefs.length} reference image(s)`);
  console.log(`Style profile: ${styleDescription ? "yes" : "none"}`);

  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey });

  // Generate ID for this batch
  const id = `gen_${Date.now().toString(36)}`;
  fs.mkdirSync(GENERATIONS_DIR, { recursive: true });

  // Generate variations concurrently with concurrency limit
  const outputs: Array<{ filename: string; path: string }> = [];

  async function generateOne(index: number): Promise<{ filename: string; path: string } | null> {
    const modelsToTry = [model, ...MODELS.filter((m) => m !== model)];

    for (const modelName of modelsToTry) {
      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          const contents = [
            ...refParts,
            { text: fullPrompt + `\n\n(Variation ${index + 1} of ${variations} — create a unique interpretation)` },
          ];

          const response = await client.models.generateContent({
            model: modelName,
            contents,
            config: { responseModalities: ["TEXT", "IMAGE"] },
          });

          const parts = response.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              const buffer = Buffer.from(part.inlineData.data, "base64");
              const filename = `${id}_${index + 1}.png`;
              fs.writeFileSync(path.join(GENERATIONS_DIR, filename), buffer);
              console.log(`  ✓ Variation ${index + 1} generated`);
              return { filename, path: `generations/${filename}` };
            }
          }
        } catch (err: any) {
          const msg = err.message || "";
          const isOverload = msg.includes("429") || msg.includes("503") ||
            msg.includes("RESOURCE_EXHAUSTED") || msg.includes("overloaded");
          if (isOverload && retry < MAX_RETRIES - 1) {
            const delay = (retry + 1) * 3000;
            console.log(`  Retrying variation ${index + 1} in ${delay / 1000}s...`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          if (!isOverload) break; // Try next model
        }
      }
    }
    console.error(`  ✗ Failed to generate variation ${index + 1}`);
    return null;
  }

  // Run with concurrency limit
  const indices = Array.from({ length: variations }, (_, i) => i);
  const results: Array<{ filename: string; path: string } | null> = [];

  for (let i = 0; i < indices.length; i += CONCURRENCY_LIMIT) {
    const batch = indices.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.allSettled(batch.map(generateOne));
    for (const r of batchResults) {
      results.push(r.status === "fulfilled" ? r.value : null);
    }
  }

  for (const r of results) {
    if (r) outputs.push(r);
  }

  // Save generation record
  const record: GenerationRecord = {
    id,
    prompt,
    variationCount: variations,
    model,
    referenceImages: selectedRefs,
    styleProfileUsed: !!styleDescription,
    createdAt: new Date().toISOString(),
    outputs,
  };

  fs.writeFileSync(path.join(GENERATIONS_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  console.log(`\nGenerated ${outputs.length}/${variations} images. Record: data/generations/${id}.json`);
}
