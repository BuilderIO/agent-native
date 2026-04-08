import { defineAction } from "@agent-native/core";
import type { ImageGenResponse } from "@shared/api";
import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";

interface ReferenceImage {
  data: string; // base64
  mimeType: string;
}

async function urlToReferenceImage(
  url: string,
): Promise<ReferenceImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = contentType.split(";")[0].trim();
    return { data: buffer.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

function dataUrlToReferenceImage(dataUrl: string): ReferenceImage | null {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;
  return { data: match[2], mimeType: match[1] };
}

export default defineAction({
  description:
    "Generate an image using Gemini with optional reference images for style matching.",
  parameters: {
    prompt: { type: "string", description: "Image description (required)" },
    model: { type: "string", description: "Model name (default: gemini)" },
  },
  run: async (args) => {
    const prompt = args.prompt;
    if (!prompt?.trim()) {
      throw new Error("Prompt is required");
    }

    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "Gemini API key not configured. Set GEMINI_API_KEY environment variable.",
      );
    }

    // Import generateWithGemini from the handlers
    const { generateWithGemini } =
      await import("../server/handlers/image-gen.js");

    const refImages: ReferenceImage[] = [];

    // Load default style reference images
    console.log(
      `[ImageGen] Loading ${DEFAULT_STYLE_REFERENCE_URLS.length} reference image(s)...`,
    );
    const results = await Promise.all(
      DEFAULT_STYLE_REFERENCE_URLS.map(urlToReferenceImage),
    );
    for (const r of results) {
      if (r) refImages.push(r);
    }

    const result = await generateWithGemini(prompt, refImages);

    const dataUrl = `data:${result.mimeType};base64,${result.imageData.toString("base64")}`;

    const response: ImageGenResponse = {
      url: dataUrl,
      model: args.model || "gemini",
      prompt,
    };

    return response;
  },
});
