import { loadEnv, fail } from "@agent-native/core";
import fs from "fs";
import path from "path";

const BRAND_DIR = path.join(process.cwd(), "data", "brand");
const REFS_DIR = path.join(BRAND_DIR, "references");
const PROFILE_PATH = path.join(BRAND_DIR, "style-profile.json");

export default async function main(args: string[]) {
  loadEnv();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) fail("GEMINI_API_KEY is required. Add it to your .env file.");

  // Load all reference images
  if (!fs.existsSync(REFS_DIR)) fail("No references directory found at data/brand/references/");
  const imageFiles = fs.readdirSync(REFS_DIR).filter((f) => !f.startsWith("."));
  if (imageFiles.length === 0) fail("No reference images found. Upload some first.");

  console.log(`Analyzing ${imageFiles.length} reference image(s)...`);

  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey });

  // Build content parts: all images + analysis prompt
  const contents: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

  for (const file of imageFiles) {
    const filePath = path.join(REFS_DIR, file);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(file).toLowerCase();
    const mimeType =
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      ext === ".svg" ? "image/svg+xml" : "image/png";

    contents.push({
      inlineData: { mimeType, data: data.toString("base64") },
    });
  }

  contents.push({
    text: `Analyze these ${imageFiles.length} brand reference images and extract a comprehensive style profile.

Return a JSON object with this exact structure:
{
  "styleDescription": "A 2-3 sentence overall description of the visual style",
  "attributes": {
    "colorPalette": "Describe the dominant colors and how they're used",
    "texture": "Describe textures, gradients, flatness, grain, etc.",
    "mood": "Describe the emotional tone and feeling",
    "composition": "Describe layout patterns, spacing, alignment",
    "lighting": "Describe lighting style, shadows, contrast"
  }
}

Be specific and concrete. Reference actual colors, techniques, and patterns you observe. This will be used to guide future image generation to match this style.

Return ONLY the JSON object, no markdown formatting.`,
  });

  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: { responseMimeType: "application/json" },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) fail("No response from Gemini");

  const analysis = JSON.parse(text!);

  const profile = {
    analyzedAt: new Date().toISOString(),
    referenceCount: imageFiles.length,
    styleDescription: analysis.styleDescription,
    attributes: analysis.attributes,
  };

  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
  console.log("Style profile saved to data/brand/style-profile.json");
  console.log(`\nStyle: ${profile.styleDescription}`);
}
