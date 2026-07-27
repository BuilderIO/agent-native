import { defineAction } from "@agent-native/core";
import { uploadFile } from "@agent-native/core/file-upload";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import type { ImageGenResponse } from "@shared/api";
import { z } from "zod";

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
    const provider = await getProvider(args.model || "auto");

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
    const uploaded = await uploadFile({
      data: result.imageData,
      filename: `slides-generated-${Date.now()}.png`,
      mimeType: result.mimeType,
      ownerEmail: getRequestUserEmail() ?? undefined,
      recordAsset: false,
    });
    if (!uploaded?.url) {
      throw new Error(
        "File storage is not configured. Connect Builder.io or another upload provider before generating slide images.",
      );
    }

    const response: ImageGenResponse = {
      url: uploaded.url,
      model: result.model,
      prompt,
    };

    return response;
  },
});
