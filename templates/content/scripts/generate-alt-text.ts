import fs from "fs";
import path from "path";
import { loadEnv, parseArgs, camelCaseArgs, PROJECTS_DIR, fail } from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script generate-alt-text --image-path "..." --project-slug "..." [options]

Options:
  --image-path          Path or API URL to the image (required)
  --project-slug        Project slug to resolve the image path (required)
  --context             Optional text context (e.g. surrounding article content)`);
    return;
  }

  const { imagePath, projectSlug, context: articleContext } = opts;

  if (!imagePath) fail("--image-path is required");
  if (!projectSlug) fail("--project-slug is required");
  if (!process.env.GEMINI_API_KEY) fail("GEMINI_API_KEY not set");

  // Resolve the actual disk path. 
  // It could be an API path like: /api/projects/alice/my-project/media/file.jpg
  // Or absolute HTTP url, or relative.
  let fileName = path.basename(imagePath);
  // strip query params just in case
  fileName = fileName.split('?')[0];

  const fullPath = path.join(PROJECTS_DIR, projectSlug, "media", fileName);
  
  if (!fs.existsSync(fullPath)) {
    fail(`Image not found on disk at: ${fullPath}`);
  }

  const data = fs.readFileSync(fullPath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : 
                   ext === ".webp" ? "image/webp" : 
                   ext === ".gif" ? "image/gif" : 
                   "image/jpeg";

  console.log(`Analyzing image: ${fileName}`);

  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = [
    "You are an expert accessibility specialist.",
    "Generate concise, descriptive alt text for this image.",
    "The alt text should be to the point, usually 1-2 sentences. Do not start with 'Image of' or 'Picture of'.",
    articleContext ? `\nUse this surrounding article content for context to make the alt text more relevant:\n\n${articleContext}` : "",
  ].filter(Boolean).join("\n");

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType,
            data: data.toString("base64"),
          },
        },
        prompt
      ],
    });

    const altText = response.text?.trim() || "";
    if (!altText) {
      fail("Gemini returned an empty response.");
    }

    console.log("\n--- Generated Alt Text ---");
    console.log(altText);
    console.log("--------------------------\n");

  } catch (e: any) {
    fail(`Failed to generate alt text: ${e.message}`);
  }
}
