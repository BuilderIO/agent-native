import fs from "fs";
import path from "path";
import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

export const generateAltText = defineEventHandler(async (event: H3Event) => {
  try {
    const {
      imagePath,
      projectSlug,
      context: articleContext,
    } = await readBody(event);

    if (!imagePath) {
      setResponseStatus(event, 400);
      return { error: "imagePath is required" };
    }
    if (!projectSlug) {
      setResponseStatus(event, 400);
      return { error: "projectSlug is required" };
    }
    if (!process.env.GEMINI_API_KEY) {
      setResponseStatus(event, 400);
      return { error: "Gemini API key not configured" };
    }

    // Resolve the actual disk path.
    // It could be an API path like: /api/projects/alice/my-project/media/file.jpg
    let fileName = path.basename(imagePath);
    fileName = fileName.split("?")[0];

    const fullPath = path.join(PROJECTS_DIR, projectSlug, "media", fileName);

    if (!fs.existsSync(fullPath)) {
      setResponseStatus(event, 400);
      return { error: `Image not found on disk at: ${fullPath}` };
    }

    const data = fs.readFileSync(fullPath);
    const ext = path.extname(fileName).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";

    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = [
      "You are an expert accessibility specialist.",
      "Generate concise, descriptive alt text for this image.",
      "The alt text should be to the point, usually 1-2 sentences. Do not start with 'Image of' or 'Picture of'.",
      articleContext
        ? `\nUse this surrounding article content for context to make the alt text more relevant:\n\n${articleContext}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType,
            data: data.toString("base64"),
          },
        },
        prompt,
      ],
    });

    const altText = response.text?.trim() || "";
    if (!altText) {
      setResponseStatus(event, 500);
      return { error: "Gemini returned an empty response" };
    }

    return { alt: altText };
  } catch (err: any) {
    console.error("Alt text generation error:", err);
    setResponseStatus(event, 500);
    return { error: err.message || "Alt text generation failed" };
  }
});
