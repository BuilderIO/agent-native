import fs from "fs";
import path from "path";
import type { RequestHandler } from "express";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

export const generateAltText: RequestHandler = async (req, res) => {
  try {
    const { imagePath, projectSlug, context: articleContext } = req.body;

    if (!imagePath) {
      res.status(400).json({ error: "imagePath is required" });
      return;
    }
    if (!projectSlug) {
      res.status(400).json({ error: "projectSlug is required" });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(400).json({ error: "Gemini API key not configured" });
      return;
    }

    // Resolve the actual disk path.
    // It could be an API path like: /api/projects/alice/my-project/media/file.jpg
    let fileName = path.basename(imagePath);
    fileName = fileName.split("?")[0];

    const fullPath = path.join(PROJECTS_DIR, projectSlug, "media", fileName);

    if (!fs.existsSync(fullPath)) {
      res
        .status(400)
        .json({ error: `Image not found on disk at: ${fullPath}` });
      return;
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
      res.status(500).json({ error: "Gemini returned an empty response" });
      return;
    }

    res.json({ alt: altText });
  } catch (err: any) {
    console.error("Alt text generation error:", err);
    res
      .status(500)
      .json({ error: err.message || "Alt text generation failed" });
  }
};
