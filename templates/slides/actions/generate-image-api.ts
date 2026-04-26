import { defineAction } from "@agent-native/core";
import type { ImageGenResponse } from "@shared/api";
import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";
import { z } from "zod";

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
    "Generate an image using Gemini or OpenAI with optional reference images for style matching.",
  schema: z.object({
    prompt: z.string().optional().describe("Image description (required)"),
    model: z
      .string()
      .optional()
      .describe("Provider: 'gemini', 'openai', or 'auto' (default: auto)"),
  }),
  run: async (args) => {
    const prompt = args.prompt;
    if (!prompt?.trim()) {
      throw new Error("Prompt is required");
    }

    // Get the appropriate provider
    const { getProvider } =
      await import("../server/handlers/image-providers/index.js");
    const provider = getProvider(args.model || "auto");

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

    const result = await provider.generate(prompt, refImages);

    const dataUrl = `data:${result.mimeType};base64,${result.imageData.toString("base64")}`;

    const response: ImageGenResponse = {
      url: dataUrl,
      model: result.model,
      prompt,
    };

    return response;
  },
});
